from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session
from app.db import get_db,now_utc
from app.models import User,RoadRestriction,Report,RoutePlan
from app.schemas import RestrictionIn,RestrictionChange,RoutingRequest,RouteVerification
from app.security import require_roles,get_current_user
from app.services import must,resource,record,active_closures,invalidate_routes_for_restriction,safety_lock
from app.domain.rules import route_blockers,route_valid
from app.domain.geo import near_route
from app.integrations.osrm import fetch_routes,RoutingUnavailable

router=APIRouter(tags=["Restricciones y enrutamiento"])

@router.get("/roads/restrictions")
def list_restrictions(db:Session=Depends(get_db)):
    return [resource(r) for r in db.scalars(select(RoadRestriction).order_by(RoadRestriction.confirmed_at.desc()).limit(500)).all()]

@router.post("/roads/restrictions",status_code=201)
def close_road(body:RestrictionIn,db:Session=Depends(get_db),user:User=Depends(require_roles("authority"))):
    safety_lock(db)
    if body.expires_at and body.expires_at.replace(tzinfo=None)<=now_utc():
        raise HTTPException(422,"La restricción debe tener vigencia futura")
    if body.source_report_id:
        rep=must(db,Report,body.source_report_id)
        if rep.status!="verified":raise HTTPException(409,"El reporte debe haber sido corroborado")
    restriction=RoadRestriction(name=body.name,geometry=body.geometry.model_dump(),status=body.status,
       source_report_id=body.source_report_id,confirmed_by=user.id,confirmation_note=body.confirmation_note,
       expires_at=body.expires_at.replace(tzinfo=None) if body.expires_at else None)
    db.add(restriction);db.flush()
    changed=invalidate_routes_for_restriction(db,restriction) if restriction.status=="closed" else []
    record(db,user.id,"road.restriction_confirmed",restriction,detail={"note":body.confirmation_note,"revoked_routes":changed},public_payload={"restriction_id":restriction.id,"status":restriction.status,"revoked_count":len(changed)})
    db.commit();return {**resource(restriction),"routes_revoked":changed}

@router.patch("/roads/restrictions/{id}")
def change_road(id:str,body:RestrictionChange,db:Session=Depends(get_db),user:User=Depends(require_roles("authority"))):
    safety_lock(db)
    r=must(db,RoadRestriction,id)
    if r.status==body.status:
        raise HTTPException(409,"No hay cambio de estado")
    r.status=body.status;r.confirmed_by=user.id;r.confirmation_note=body.confirmation_note;r.confirmed_at=now_utc()
    changed=invalidate_routes_for_restriction(db,r) if body.status=="closed" else []
    record(db,user.id,"road.status_changed",r,detail={"note":body.confirmation_note,"revoked_routes":changed},public_payload={"restriction_id":r.id,"status":r.status})
    db.commit();return {**resource(r),"routes_revoked":changed}

@router.post("/routes/plan",status_code=201)
def plan(body:RoutingRequest,db:Session=Depends(get_db),user:User=Depends(require_roles("dispatcher","inspector","authority"))):
    """Real OSRM alternatives, no synthetic geometry and no automatic safety certification."""
    try:
        results=fetch_routes((body.origin_lon,body.origin_lat),(body.destination_lon,body.destination_lat))
    except RoutingUnavailable as exc:
        raise HTTPException(503,str(exc)) from exc
    closures=active_closures(db);out=[]
    for row in results:
        blockers=route_blockers(row["geometry"],closures)
        route=RoutePlan(requested_by=user.id,origin=[body.origin_lon,body.origin_lat],destination=[body.destination_lon,body.destination_lat],
              geometry=row["geometry"],distance_m=row["distance_m"],duration_s=row["duration_s"],status="blocked" if blockers else "candidate")
        db.add(route);db.flush()
        record(db,user.id,"route.candidate_created",route,public_payload={"route_id":route.id,"status":route.status})
        out.append({**resource(route),"blockers":blockers,"eligible":False,"explanation":"Cruza una restricción confirmada" if blockers else "Requiere verificación humana"})
    db.commit();return out

@router.get("/routes")
def list_routes(db:Session=Depends(get_db),user:User=Depends(require_roles("dispatcher","driver","inspector","authority"))):
    closures=active_closures(db)
    return [{**resource(r),"valid_now":route_valid(r,closures),"blockers":route_blockers(r.geometry,closures)} for r in db.scalars(select(RoutePlan).order_by(RoutePlan.created_at.desc()).limit(150)).all()]

@router.post("/routes/{id}/verify")
def verify_route(id:str,body:RouteVerification,db:Session=Depends(get_db),user:User=Depends(require_roles("inspector","authority"))):
    safety_lock(db)
    r=must(db,RoutePlan,id)
    if r.status not in {"candidate","blocked","revoked","expired"}:
        raise HTTPException(409,"Esta ruta ya está verificada")
    blockers=route_blockers(r.geometry,active_closures(db))
    if blockers:raise HTTPException(409,detail={"message":"La ruta cruza un cierre confirmado","blockers":blockers})
    from datetime import timedelta
    r.status="verified";r.verified_by=user.id;r.verified_at=now_utc();r.expires_at=now_utc()+timedelta(minutes=body.valid_minutes);r.verification_note=body.note
    record(db,user.id,"route.verified",r,detail={"note":body.note,"valid_minutes":body.valid_minutes},public_payload={"route_id":r.id,"status":"verified"})
    db.commit();return {**resource(r),"valid_now":True}
