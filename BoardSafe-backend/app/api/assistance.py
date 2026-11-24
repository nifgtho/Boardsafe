from datetime import timedelta
from fastapi import APIRouter,Depends,HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session
from app.config import get_settings
from app.db import get_db,now_utc
from app.models import User,Stop,Vehicle,RoutePlan,Assistance
from app.schemas import AssistanceIn,AssistanceOffer
from app.security import get_current_user,require_roles
from app.services import must,resource,record,active_closures,safety_lock
from app.domain.rules import offer_eligibility,boarding_eligibility,route_valid,TERMINAL

router=APIRouter(prefix="/assistance",tags=["Continuidad de viajes accesibles"])

def authorized_request(u,req):
    if u.role in {"passenger"} and req.passenger_id!=u.id:
        raise HTTPException(403,"No puede consultar solicitudes ajenas")
    if u.role == "driver" and req.vehicle_id is None:
        raise HTTPException(403,"No tiene esta solicitud asignada")

@router.post("",status_code=201)
def request_assistance(body:AssistanceIn,db:Session=Depends(get_db),user:User=Depends(get_current_user)):
    if user.role!="passenger" and user.role!="admin":raise HTTPException(403,"Use una cuenta de pasajero")
    stop=must(db,Stop,body.stop_id)
    a=Assistance(passenger_id=user.id,stop_id=stop.id,destination_lat=body.destination_lat,
       destination_lon=body.destination_lon,support=body.support,consent_operational=True,
       expires_at=now_utc()+timedelta(hours=4),state="requested")
    db.add(a);db.flush()
    record(db,user.id,"assistance.requested",a,public_payload={"assistance_id":a.id,"stop_id":a.stop_id,"status":"requested"})
    db.commit();return resource(a)

@router.get("")
def list_assistance(db:Session=Depends(get_db),user:User=Depends(get_current_user)):
    q=select(Assistance)
    if user.role=="passenger":q=q.where(Assistance.passenger_id==user.id)
    if user.role=="driver":
        vehicle_ids=db.scalars(select(Vehicle.id).where(Vehicle.driver_id==user.id)).all()
        if not vehicle_ids:return []
        q=q.where(Assistance.vehicle_id.in_(vehicle_ids))
    return [resource(a,exclude={"consent_operational","passenger_id"} if user.role in {"driver","dispatcher","inspector","authority"} else set()) for a in db.scalars(q.order_by(Assistance.created_at.desc()).limit(250)).all()]

@router.get("/{id}")
def get_assistance(id:str,db:Session=Depends(get_db),user:User=Depends(get_current_user)):
    a=must(db,Assistance,id);authorized_request(user,a)
    if user.role=="driver":
        vehicle=must(db,Vehicle,a.vehicle_id)
        if vehicle.driver_id!=user.id:raise HTTPException(403,"No es su vehículo")
    return resource(a,exclude={"passenger_id","consent_operational"} if user.role not in {"passenger","admin"} else set())

@router.post("/{id}/offer")
def offer(id:str,body:AssistanceOffer,db:Session=Depends(get_db),user:User=Depends(require_roles("dispatcher"))):
    safety_lock(db)
    a=must(db,Assistance,id);v=must(db,Vehicle,body.vehicle_id);r=must(db,RoutePlan,body.route_id);stop=must(db,Stop,a.stop_id)
    errors=offer_eligibility(a,stop,v,r,active_closures(db),get_settings().vehicle_staleness_seconds)
    if "ramp" in a.support:
        # Do not promise more accessible spaces than the driver has confirmed.
        concurrent=db.scalars(select(Assistance).where(Assistance.vehicle_id==v.id,Assistance.state.in_(["offered","accepted"]),Assistance.id!=a.id)).all()
        occupied_reservations=sum(1 for existing in concurrent if "ramp" in existing.support)
        if v.accessible_spaces_free is not None and occupied_reservations>=v.accessible_spaces_free:
            errors.append("La plaza accesible ya está comprometida para otra solicitud")
    if errors:
        record(db,user.id,"assistance.offer_denied",a,detail={"reasons":errors},public_payload={"assistance_id":a.id,"decision":"rejected"})
        db.commit()
        raise HTTPException(409,detail={"message":"No es posible ofrecer el viaje todavía","reasons":errors})
    a.vehicle_id=v.id;a.route_id=r.id;a.state="offered"
    record(db,user.id,"assistance.offered",a,public_payload={"assistance_id":a.id,"vehicle_id":v.id,"status":"offered"})
    db.commit();return resource(a)

@router.post("/{id}/accept")
def accept(id:str,db:Session=Depends(get_db),user:User=Depends(require_roles("driver"))):
    safety_lock(db)
    a=must(db,Assistance,id)
    if a.state!="offered":raise HTTPException(409,"No hay una oferta pendiente")
    v=must(db,Vehicle,a.vehicle_id)
    if v.driver_id!=user.id:raise HTTPException(403,"Esta solicitud pertenece a otro conductor")
    r=must(db,RoutePlan,a.route_id)
    if not route_valid(r,active_closures(db)):
        a.state="waiting_safe";record(db,user.id,"assistance.waiting_safe",a)
        db.commit();raise HTTPException(409,"Ruta ya no habilitada; solicitud en espera segura")
    a.state="accepted";record(db,user.id,"assistance.accepted",a,public_payload={"assistance_id":a.id,"status":"accepted"})
    db.commit();return resource(a,exclude={"passenger_id","consent_operational"})

@router.post("/{id}/board")
def board(id:str,db:Session=Depends(get_db),user:User=Depends(require_roles("driver"))):
    safety_lock(db)
    a=must(db,Assistance,id)
    if not a.vehicle_id or not a.route_id:raise HTTPException(409,"La solicitud no tiene servicio asignado")
    v=must(db,Vehicle,a.vehicle_id)
    if v.driver_id!=user.id:raise HTTPException(403,"No es su vehículo")
    stop=must(db,Stop,a.stop_id);r=must(db,RoutePlan,a.route_id)
    errors=boarding_eligibility(a,stop,v,r,active_closures(db),get_settings().bay_staleness_seconds)
    # Vehicle and bay staleness policy may differ: independently enforce vehicle freshness.
    from app.domain.rules import is_fresh
    if not is_fresh(v.state_checked_at,get_settings().vehicle_staleness_seconds):
        if "Estado del vehículo desactualizado" not in errors:errors.append("Estado del vehículo desactualizado")
    if errors:
        record(db,user.id,"assistance.boarding_denied",a,detail={"reasons":errors},public_payload={"assistance_id":a.id,"decision":"rejected"})
        db.commit()
        raise HTTPException(409,detail={"message":"No se permite confirmar el abordaje","reasons":errors})
    a.state="onboard"
    if "ramp" in a.support and v.accessible_spaces_free is not None:
        v.accessible_spaces_free-=1
    record(db,user.id,"assistance.boarded",a,public_payload={"assistance_id":a.id,"status":"onboard"})
    db.commit();return resource(a,exclude={"passenger_id","consent_operational"})

@router.post("/{id}/complete")
def complete(id:str,db:Session=Depends(get_db),user:User=Depends(get_current_user)):
    safety_lock(db)
    a=must(db,Assistance,id)
    if user.role=="passenger":
        if a.passenger_id!=user.id:raise HTTPException(403,"No es su viaje")
    elif user.role=="driver":
        if not a.vehicle_id or must(db,Vehicle,a.vehicle_id).driver_id != user.id:raise HTTPException(403,"No es su viaje")
    elif user.role not in {"dispatcher","admin"}:raise HTTPException(403,"Acción no permitida")
    if a.state!="onboard":raise HTTPException(409,"El viaje debe estar en curso")
    a.state="completed";record(db,user.id,"assistance.completed",a,public_payload={"assistance_id":a.id,"status":"completed"})
    db.commit();return {"id":a.id,"state":a.state}

@router.post("/{id}/recover")
def recover(id:str,body:AssistanceOffer,db:Session=Depends(get_db),user:User=Depends(require_roles("dispatcher"))):
    """Reassign an interrupted onboard journey to a verified alternative; keep passenger protected."""
    safety_lock(db)
    a=must(db,Assistance,id)
    if a.state!="interrupted":raise HTTPException(409,"Solo viajes interrumpidos en curso pueden recuperarse")
    route=must(db,RoutePlan,body.route_id)
    vehicle=must(db,Vehicle,body.vehicle_id)
    if a.vehicle_id!=vehicle.id:raise HTTPException(409,"La continuidad en otro vehículo requiere un procedimiento de transbordo")
    if not route_valid(route,active_closures(db)):
        raise HTTPException(409,"La alternativa no se ha verificado")
    if not route.geometry or not route.origin or not route.destination:
        raise HTTPException(409,"La ruta no tiene geometría verificable")
    from app.domain.geo import meters_between
    if meters_between((a.destination_lon,a.destination_lat),route.destination)>600:
        raise HTTPException(409,"La alternativa no conduce al destino solicitado")
    a.route_id=route.id;a.state="onboard"
    record(db,user.id,"assistance.recovered",a,public_payload={"assistance_id":a.id,"status":"onboard","route_id":route.id})
    db.commit();return resource(a,exclude={"passenger_id","consent_operational"})

@router.post("/{id}/cancel")
def cancel(id:str,db:Session=Depends(get_db),user:User=Depends(get_current_user)):
    a=must(db,Assistance,id)
    if user.role=="passenger":
        if a.passenger_id!=user.id:raise HTTPException(403,"No es su solicitud")
    elif user.role not in {"dispatcher","admin"}:raise HTTPException(403,"No puede cancelar esta solicitud")
    if a.state in TERMINAL or a.state=="onboard":raise HTTPException(409,"No puede cancelar este viaje en su estado actual")
    a.state="cancelled";record(db,user.id,"assistance.cancelled",a,public_payload={"assistance_id":a.id,"status":"cancelled"})
    db.commit();return {"id":a.id,"state":a.state}
