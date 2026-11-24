"""Consent-based no-account accessible totem. No official disability card required."""
import secrets
from datetime import timedelta
from fastapi import APIRouter,Depends,HTTPException,Header
from sqlalchemy import select
from sqlalchemy.orm import Session
from app.db import get_db,now_utc
from app.models import Assistance,KioskTicket,EdgeNode
from app.schemas import KioskAssistance, TrackingToken
from app.security import hash_node_secret,secure_equals
from app.services import must,record

router=APIRouter(prefix="/kiosk",tags=["Tótem accesible (sin cuenta ni carnet)"])

def auth_kiosk(db,node_id,key):
    node=must(db,EdgeNode,node_id)
    if node.kind!="totem" or not node.enabled or not key or not secure_equals(node.secret_hash,hash_node_secret(key)):
        raise HTTPException(401,"Tótem no autorizado")
    return node

@router.post("/{node_id}/requests",status_code=201)
def kiosk_request(node_id:str,body:KioskAssistance,x_node_key:str=Header(default=""),db:Session=Depends(get_db)):
    node=auth_kiosk(db,node_id,x_node_key)
    ticket_secret=secrets.token_urlsafe(32)
    a=Assistance(passenger_id=None,stop_id=node.stop_id,destination_lat=body.destination_lat,destination_lon=body.destination_lon,
        support=body.support,consent_operational=True,expires_at=now_utc()+timedelta(hours=4),state="requested")
    db.add(a);db.flush()
    ticket=KioskTicket(assistance_id=a.id,secret_hash=hash_node_secret(ticket_secret),expires_at=a.expires_at)
    db.add(ticket)
    record(db,None,"assistance.kiosk_requested",a,public_payload={"assistance_id":a.id,"stop_id":node.stop_id,"status":"requested"})
    db.commit()
    return {"request_id":a.id,"tracking_token":ticket_secret,"expires_at":a.expires_at.isoformat()+"Z",
        "instruction":"Conserve el código de seguimiento de forma privada. No se requiere un carnet de discapacidad."}

@router.post("/tracking")
def kiosk_tracking(body:TrackingToken,db:Session=Depends(get_db)):
    token=body.token
    if len(token)<30:raise HTTPException(401,"Código temporal inválido")
    t=db.scalar(select(KioskTicket).where(KioskTicket.secret_hash==hash_node_secret(token)))
    if not t or t.expires_at<now_utc():raise HTTPException(401,"Código temporal inválido o caducado")
    a=must(db,Assistance,t.assistance_id)
    return {"request_id":a.id,"state":a.state,"stop_id":a.stop_id,"support":a.support,"vehicle_assigned":bool(a.vehicle_id),"expires_at":a.expires_at.isoformat()+"Z"}

@router.post("/complete")
def kiosk_complete(body:TrackingToken,db:Session=Depends(get_db)):
    token=body.token
    if len(token)<30:raise HTTPException(401,"Código temporal inválido")
    t=db.scalar(select(KioskTicket).where(KioskTicket.secret_hash==hash_node_secret(token)))
    if not t or t.expires_at<now_utc():raise HTTPException(401,"Código temporal inválido o caducado")
    a=must(db,Assistance,t.assistance_id)
    if a.state!="onboard":raise HTTPException(409,"El viaje aún no está confirmado como iniciado")
    a.state="completed";record(db,None,"assistance.kiosk_completed",a,public_payload={"assistance_id":a.id,"status":"completed"})
    db.delete(t);db.commit();return {"request_id":a.id,"state":a.state}
