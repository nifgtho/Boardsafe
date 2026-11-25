import asyncio
from datetime import datetime, timezone
from fastapi import APIRouter,Depends,HTTPException,WebSocket,WebSocketDisconnect,Query
from sqlalchemy import select,func
from sqlalchemy.orm import Session
from app.db import get_db,SessionLocal,now_utc
from app.config import get_settings
from app.models import Stop,Vehicle,User,Report,Assistance,RoadRestriction,RiskZone,RiskAssessment,ResponseAsset,DomainEvent,AuditLog
from app.security import get_current_user,require_roles,decode_token,get_token_user
from app.services import resource
from app.domain.rules import is_fresh

router=APIRouter(tags=["Mapa y eventos"])

def coordinates_visible(lat,lon,bbox):
    if not bbox:return True
    return bbox[0] <= lon <= bbox[2] and bbox[1] <= lat <= bbox[3]

@router.get("/map/features")
def feature_collection(bbox:str|None=None,db:Session=Depends(get_db),user:User=Depends(get_current_user)):
    """Actual stored geospatial features. Compatible with MapLibre GeoJSON source."""
    bounds=None
    if bbox:
        try:
            p=[float(x.strip()) for x in bbox.split(",")]
            if len(p)!=4 or p[0]<-180 or p[2]>180 or p[1]<-90 or p[3]>90 or p[0]>p[2] or p[1]>p[3]:raise ValueError()
            bounds=p
        except ValueError:raise HTTPException(422,"bbox debe ser minLon,minLat,maxLon,maxLat")
    features=[]
    for s in db.scalars(select(Stop).limit(2000)).all():
        if coordinates_visible(s.lat,s.lon,bounds):
            features.append({"type":"Feature","id":s.id,"geometry":{"type":"Point","coordinates":[s.lon,s.lat]},"properties":{"kind":"stop","name":s.name,"code":s.code,"wheelchair_accessible":s.wheelchair_accessible,"bay_status":s.bay_status if is_fresh(s.bay_checked_at,get_settings().bay_staleness_seconds) else "unknown"}})
    for z in db.scalars(select(RiskZone).limit(2000)).all():
        if coordinates_visible(z.lat,z.lon,bounds):
            latest=db.scalar(select(RiskAssessment).where(RiskAssessment.zone_id==z.id).order_by(RiskAssessment.evaluated_at.desc()).limit(1))
            features.append({"type":"Feature","id":z.id,"geometry":{"type":"Point","coordinates":[z.lon,z.lat]},"properties":{"kind":"risk_zone","name":z.name,"radius_m":z.radius_m,"susceptibility":z.susceptibility,"source":z.source,"source_version":z.source_version,"latest_priority":latest.category if latest else "not_evaluated","latest_score":latest.score if latest else None,"priority_method":latest.rule_version if latest else None}})
    if user.role in {"dispatcher","inspector","authority","admin"}:
        for report in db.scalars(select(Report).where(Report.status=="verified").order_by(Report.created_at.desc()).limit(2000)).all():
            if coordinates_visible(report.lat,report.lon,bounds):
                features.append({"type":"Feature","id":report.id,"geometry":{"type":"Point","coordinates":[report.lon,report.lat]},"properties":{"kind":"verified_report","report_kind":report.kind,"status":"verified","verified_at":report.reviewed_at.isoformat()+"Z" if report.reviewed_at else None}})
        for asset in db.scalars(select(ResponseAsset).limit(1000)).all():
            if coordinates_visible(asset.lat,asset.lon,bounds):
                features.append({"type":"Feature","id":asset.id,"geometry":{"type":"Point","coordinates":[asset.lon,asset.lat]},"properties":{"kind":"response_asset","type":asset.asset_type,"code":asset.code,"status":asset.state}})
    for road in db.scalars(select(RoadRestriction).limit(2000)).all():
        if not bounds or any(coordinates_visible(p[1],p[0],bounds) for p in road.geometry.get("coordinates",[])):
            features.append({"type":"Feature","id":road.id,"geometry":road.geometry,"properties":{"kind":"road_restriction","name":road.name,"status":"open_expired" if road.expires_at and road.expires_at <= now_utc() and road.status!="open" else road.status,"confirmed_at":road.confirmed_at.isoformat()+"Z"}})
    if user.role in {"dispatcher","driver","inspector","authority","admin"}:
        vehicles=db.scalars(select(Vehicle).limit(2000)).all()
        for v in vehicles:
            if v.at_lat is not None and v.at_lon is not None and coordinates_visible(v.at_lat,v.at_lon,bounds):
                if user.role=="driver" and v.driver_id!=user.id:continue
                features.append({"type":"Feature","id":v.id,"geometry":{"type":"Point","coordinates":[v.at_lon,v.at_lat]},"properties":{"kind":"vehicle","code":v.code,"fresh":is_fresh(v.state_checked_at,get_settings().vehicle_staleness_seconds)}})
    return {"type":"FeatureCollection","features":features,"metadata":{"crs":"EPSG:4326","safety_notice":"La red OSM es cartografía base, no prueba de transitabilidad ni accesibilidad verificadas"}}

@router.get("/events")
def list_events(since_id:int=Query(default=0,ge=0),limit:int=Query(default=100,ge=1,le=500),db:Session=Depends(get_db),user:User=Depends(require_roles("dispatcher","inspector","authority"))):
    rows=db.scalars(select(DomainEvent).where(DomainEvent.id>since_id).order_by(DomainEvent.id).limit(limit)).all()
    return [resource(e) for e in rows]

@router.get("/audit")
def audit(limit:int=Query(default=100,ge=1,le=500),db:Session=Depends(get_db),user:User=Depends(require_roles("authority","admin"))):
    rows=db.scalars(select(AuditLog).order_by(AuditLog.id.desc()).limit(limit)).all()
    return [resource(e) for e in rows]

@router.get("/metrics/continuity")
def metrics(db:Session=Depends(get_db),user:User=Depends(require_roles("dispatcher","authority","inspector"))):
    total=db.scalar(select(func.count(Assistance.id))) or 0
    complete=db.scalar(select(func.count(Assistance.id)).where(Assistance.state=="completed")) or 0
    pending=db.scalar(select(func.count(Assistance.id)).where(Assistance.state.in_(["requested","offered","accepted","waiting_safe","onboard"]))) or 0
    return {"requests":total,"completed":complete,"pending":pending,"ajcr_percent":round(100*complete/total,2) if total else None,"methodology":"Solicitudes completadas / solicitudes registradas. Incluye cancelaciones en denominador; no mide impacto causal."}

@router.websocket("/ws/events")
async def event_socket(ws:WebSocket):
    """DB-backed near-real-time events across processes. First frame MUST be a bearer JWT."""
    await ws.accept()
    try:
        token=await asyncio.wait_for(ws.receive_text(), timeout=10)
        claims=decode_token(token)
        with SessionLocal() as db:
            u=get_token_user(token,db)
            if u.role not in {"dispatcher","inspector","authority","admin"}:
                await ws.close(code=1008);return
            last=db.scalar(select(func.max(DomainEvent.id))) or 0
        await ws.send_json({"type":"connected","poll_seconds":get_settings().event_poll_seconds})
        # On reconnect clients should use GET /events?since_id=... to recover missed messages.
        while True:
            await asyncio.sleep(get_settings().event_poll_seconds)
            with SessionLocal() as db:
                u=get_token_user(token,db)
                if claims["exp"]<=datetime.now(timezone.utc).timestamp() or u.role not in {"dispatcher","inspector","authority","admin"}:
                    await ws.close(code=1008);return
                rows=db.scalars(select(DomainEvent).where(DomainEvent.id>last).order_by(DomainEvent.id).limit(200)).all()
                for e in rows:
                    # A token may be revoked while a batch is being sent.
                    db.expire_all()
                    u=get_token_user(token,db)
                    if claims["exp"]<=datetime.now(timezone.utc).timestamp() or u.role not in {"dispatcher","inspector","authority","admin"}:
                        await ws.close(code=1008);return
                    await ws.send_json({"type":"event","event":resource(e)})
                    last=e.id
    except (WebSocketDisconnect, asyncio.TimeoutError, RuntimeError):
        try:await ws.close()
        except RuntimeError:pass
    except HTTPException:
        await ws.close(code=1008)
