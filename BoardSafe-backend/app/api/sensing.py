"""Restricted device metadata and verified external hydrometeorological ingestion."""
import secrets
from datetime import timezone, timedelta
from fastapi import APIRouter,Depends,HTTPException,Header
from sqlalchemy import select
from sqlalchemy.orm import Session
from app.config import get_settings
from app.db import get_db,now_utc
from app.models import User,EdgeNode,EdgeEvent,Stop,Vehicle,RainReading
from app.schemas import EdgeNodeIn,EdgeSignal,RainIn
from app.security import require_roles,hash_node_secret,secure_equals
from app.services import must,resource,record,safety_lock

router=APIRouter(tags=["Sensores y observaciones"])

@router.post("/edge/nodes",status_code=201)
def create_edge_node(body:EdgeNodeIn,db:Session=Depends(get_db),user:User=Depends(require_roles("admin"))):
    if db.scalar(select(EdgeNode).where(EdgeNode.code==body.code)):
        raise HTTPException(409,"Nodo duplicado")
    if body.kind=="totem" and not body.stop_id:raise HTTPException(422,"El tótem necesita un paradero")
    if body.stop_id:must(db,Stop,body.stop_id)
    if body.vehicle_id:must(db,Vehicle,body.vehicle_id)
    secret=secrets.token_urlsafe(40)
    n=EdgeNode(**body.model_dump(),secret_hash=hash_node_secret(secret))
    db.add(n);db.flush();record(db,user.id,"edge.node_registered",n)
    db.commit()
    return {"id":n.id,"code":n.code,"node_secret":secret,"warning":"Este secreto solo se muestra una vez"}

@router.post("/edge/nodes/{id}/signals",status_code=202)
def ingest_edge(id:str,body:EdgeSignal,x_node_key:str=Header(default=""),db:Session=Depends(get_db)):
    safety_lock(db)
    node=must(db,EdgeNode,id)
    if not node.enabled or node.kind != "camera" or not x_node_key or not secure_equals(node.secret_hash,hash_node_secret(x_node_key)):
        raise HTTPException(401,"Nodo no autorizado")
    observed=body.observed_at.replace(tzinfo=None)
    if abs((now_utc()-observed).total_seconds())>120:
        raise HTTPException(422,"La lectura del sensor está fuera de la ventana permitida")
    if body.confidence < 0.55:
        raise HTTPException(422,"Confianza del evento insuficiente")
    if body.event_type.startswith("bay_") and not node.stop_id:raise HTTPException(422,"Este nodo no observa un paradero")
    if body.event_type.startswith("space_") and not node.vehicle_id:raise HTTPException(422,"Este nodo no observa un vehículo")
    e=EdgeEvent(node_id=id,event_type=body.event_type,confidence=body.confidence,observed_at=observed)
    db.add(e);node.last_seen_at=now_utc()
    if node.stop_id:
        stop=must(db,Stop,node.stop_id)
        if body.event_type=="bay_obstruction":
            stop.bay_status="blocked";stop.bay_checked_at=observed;stop.bay_source="edge_observed"
        elif body.event_type in {"bay_no_obstruction","node_fault"}:
            # Absence of a detection is not verification of a safe bay.
            stop.bay_status="unknown";stop.bay_checked_at=observed;stop.bay_source="edge_unconfirmed"
    if node.vehicle_id:
        vehicle=must(db,Vehicle,node.vehicle_id)
        if body.event_type=="space_occupied":vehicle.accessible_spaces_free=0;vehicle.state_checked_at=observed
        elif body.event_type in {"space_no_obstruction","node_fault"}:vehicle.accessible_spaces_free=None;vehicle.state_checked_at=observed
    db.flush();record(db,None,"edge.signal_received",e,public_payload={"node_id":id,"event_type":body.event_type,"confidence":body.confidence})
    db.commit();return {"id":e.id,"accepted":True,"note":"Observación operativa, no decisión de seguridad certificada"}

@router.post("/weather/readings",status_code=201)
def ingest_rain(body:RainIn,x_ingest_token:str=Header(default=""),db:Session=Depends(get_db)):
    s=get_settings()
    if not s.ingest_token or not secure_equals(x_ingest_token,s.ingest_token):
        raise HTTPException(401,"Origen meteorológico no autorizado")
    observed=body.observed_at.replace(tzinfo=None)
    if body.kind=="observation" and observed>now_utc()+timedelta(minutes=5):
        raise HTTPException(422,"Una observación no puede estar en el futuro")
    if observed>now_utc()+timedelta(days=8):raise HTTPException(422,"Fecha fuera de rango")
    r=RainReading(**{**body.model_dump(exclude={"observed_at"}),"observed_at":observed})
    db.add(r);db.flush()
    record(db,None,"weather.reading_ingested",r,public_payload={"reading_id":r.id,"kind":r.kind,"source":r.source})
    db.commit();return resource(r)

@router.get("/weather/readings")
def list_weather(db:Session=Depends(get_db),user:User=Depends(require_roles("inspector","authority","dispatcher"))):
    return [resource(r) for r in db.scalars(select(RainReading).order_by(RainReading.observed_at.desc()).limit(200)).all()]
