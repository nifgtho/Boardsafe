from datetime import datetime
from sqlalchemy import select
from sqlalchemy.orm import Session
from fastapi import HTTPException
from fastapi.encoders import jsonable_encoder
from app.models import AuditLog, DomainEvent, RoadRestriction, RoutePlan, Assistance
from app.db import now_utc
from app.domain.rules import route_blockers

def must(db: Session, cls, ident: str):
    item = db.get(cls, ident)
    if not item:
        raise HTTPException(status_code=404, detail="No se encontró el recurso solicitado")
    return item

def resource(obj, exclude=None):
    """Serialize SQLAlchemy scalar columns; prevent incidental relationship leakage."""
    data = {c.name: getattr(obj,c.name) for c in obj.__table__.columns if c.name not in (exclude or set())}
    return jsonable_encoder(data)

def record(db: Session, actor_id: str | None, action: str, entity, *, detail=None, public_payload=None):
    """Transactionally persist audit + outbox in the same DB transaction as the mutation."""
    db.add(AuditLog(actor_id=actor_id, action=action, resource_type=entity.__tablename__, resource_id=entity.id, detail=detail or {}))
    db.add(DomainEvent(event_type=action, resource_id=entity.id, payload=public_payload or {"resource_type":entity.__tablename__,"resource_id":entity.id}))

def active_closures(db: Session):
    return db.scalars(select(RoadRestriction).where(RoadRestriction.status=="closed")).all()

def invalidate_routes_for_restriction(db: Session, restriction):
    """Fail closed: invalidate affected verified plans and existing assistance offers."""
    routes = db.scalars(select(RoutePlan).where(RoutePlan.status=="verified")).all()
    changed=[]
    for route in routes:
        if route_blockers(route.geometry, [restriction]):
            route.status = "revoked"
            changed.append(route.id)
            record(db, restriction.confirmed_by, "route.revoked_after_closure", route, public_payload={"route_id":route.id,"reason":"closure"})
            requests = db.scalars(select(Assistance).where(Assistance.route_id==route.id, Assistance.state.in_(["offered","accepted","onboard"]))).all()
            for req in requests:
                req.state = "interrupted" if req.state == "onboard" else "waiting_safe"
                record(db, restriction.confirmed_by, "assistance.route_interrupted", req, public_payload={"request_id":req.id,"status":req.state})
    return changed

def safety_lock(db: Session):
    """Serialize high-impact decisions across workers on PostgreSQL (single advisory lock)."""
    from sqlalchemy import text
    if db.get_bind().dialect.name == "postgresql":
        db.execute(text("SELECT pg_advisory_xact_lock(739145)"))
