from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session
from app.config import get_settings
from app.db import get_db,now_utc
from app.models import User,Stop,Vehicle
from app.schemas import StopIn,StopBay,VehicleIn,VehicleCheck
from app.security import require_roles
from app.services import must,resource,record,safety_lock
from app.domain.rules import is_fresh

router=APIRouter(tags=["Operación de transporte"])

@router.get("/stops")
def list_stops(db:Session=Depends(get_db)):
    return [{**resource(s),"bay_effective_status":s.bay_status if is_fresh(s.bay_checked_at,get_settings().bay_staleness_seconds) else "unknown"} for s in db.scalars(select(Stop).order_by(Stop.name).limit(500)).all()]

@router.post("/stops",status_code=201)
def create_stop(body:StopIn,db:Session=Depends(get_db),user:User=Depends(require_roles("dispatcher","authority"))):
    if db.scalar(select(Stop).where(Stop.code==body.code)):
        raise HTTPException(409,"Código de paradero duplicado")
    obj=Stop(**body.model_dump());db.add(obj);db.flush();record(db,user.id,"stop.created",obj)
    db.commit();return resource(obj)

@router.patch("/stops/{id}/bay")
def check_bay(id:str,body:StopBay,db:Session=Depends(get_db),user:User=Depends(require_roles("dispatcher","inspector"))):
    safety_lock(db)
    stop=must(db,Stop,id)
    stop.bay_status=body.status;stop.bay_checked_at=now_utc();stop.bay_source="manual"
    record(db,user.id,"stop.bay_verified",stop,detail={"status":body.status,"note":body.note},public_payload={"stop_id":stop.id,"bay_status":body.status})
    db.commit();return resource(stop)

@router.get("/vehicles")
def list_vehicles(db:Session=Depends(get_db),user:User=Depends(require_roles("dispatcher","driver","inspector","authority"))):
    rows = db.scalars(select(Vehicle).order_by(Vehicle.code).limit(500)).all()
    if user.role == "driver":
        rows=[v for v in rows if v.driver_id == user.id]
    return [{**resource(v),"state_fresh":is_fresh(v.state_checked_at,get_settings().vehicle_staleness_seconds)} for v in rows]

@router.post("/vehicles",status_code=201)
def create_vehicle(body:VehicleIn,db:Session=Depends(get_db),user:User=Depends(require_roles("dispatcher"))):
    if db.scalar(select(Vehicle).where(Vehicle.code==body.code)):
        raise HTTPException(409,"Vehículo duplicado")
    if body.driver_id:
        driver=must(db,User,body.driver_id)
        if driver.role!="driver": raise HTTPException(422,"El conductor debe tener rol driver")
    v=Vehicle(**body.model_dump());db.add(v);db.flush();record(db,user.id,"vehicle.created",v)
    db.commit();return resource(v)

@router.patch("/vehicles/{id}/status")
def vehicle_status(id:str,body:VehicleCheck,db:Session=Depends(get_db),user:User=Depends(require_roles("driver","dispatcher"))):
    safety_lock(db)
    v=must(db,Vehicle,id)
    if user.role=="driver" and v.driver_id!=user.id:
        raise HTTPException(403,"No tiene asignado este vehículo")
    if body.accessible_spaces_free > v.accessible_spaces_total:
        raise HTTPException(422,"Las plazas libres superan la capacidad instalada")
    v.accessible_spaces_free=body.accessible_spaces_free
    v.ramp_ok=body.ramp_ok;v.state_checked_at=now_utc()
    if body.at_lat is not None:
        v.at_lat=body.at_lat;v.at_lon=body.at_lon
    record(db,user.id,"vehicle.status_confirmed",v,public_payload={"vehicle_id":v.id,"status":"updated"})
    db.commit();return resource(v)
