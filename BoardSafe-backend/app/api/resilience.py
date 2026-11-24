from datetime import timedelta
from fastapi import APIRouter,Depends,HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session
from app.db import get_db,now_utc
from app.models import User,RiskZone,RainReading,Report,RiskAssessment,ResponseAsset,ResponseDecision
from app.schemas import RiskZoneIn,ResponseAssetIn,ResourceAction
from app.security import require_roles
from app.services import must,resource,record
from app.domain.geo import within_radius
from app.domain.rules import compute_risk
from app.integrations.open_meteo import forecast_24h,WeatherProviderError

router=APIRouter(tags=["Resiliencia territorial y decisiones institucionales"])

@router.post("/risk/zones",status_code=201)
def zone_create(body:RiskZoneIn,db:Session=Depends(get_db),user:User=Depends(require_roles("authority","inspector"))):
    z=RiskZone(**body.model_dump());db.add(z);db.flush();record(db,user.id,"risk.zone_created",z)
    db.commit();return resource(z)

@router.get("/risk/zones")
def zone_list(db:Session=Depends(get_db)):
    return [resource(z) for z in db.scalars(select(RiskZone).limit(300)).all()]

@router.post("/risk/zones/{id}/assess")
def assess(id:str,db:Session=Depends(get_db),user:User=Depends(require_roles("inspector","authority"))):
    zone=must(db,RiskZone,id)
    # NOTE: only observed precipitation; never mix forecasts into actual measurements.
    since=now_utc()-timedelta(hours=72)
    readings=db.scalars(select(RainReading).where(RainReading.kind=="observation",RainReading.observed_at>=since)).all()
    nearby=[r for r in readings if within_radius(r.lon,r.lat,zone.lon,zone.lat,zone.radius_m)]
    # Prevent station oversampling: use latest observation per source+period reference;
    # do NOT sum overlapping independent products, which would inflate exposure.
    by_source={}
    for r in nearby:
        key=(r.source,r.source_ref)
        if key not in by_source or r.observed_at>by_source[key].observed_at:by_source[key]=r
    # Conservative maximum from different sources, not their sum. Real validated hydrology needed for production warnings.
    rain_mm=max((r.mm for r in by_source.values()),default=0)
    reports=db.scalars(select(Report).where(Report.status=="verified",Report.created_at>=since)).all()
    count=sum(1 for r in reports if within_radius(r.lon,r.lat,zone.lon,zone.lat,zone.radius_m))
    score,category,reasons=compute_risk(zone.susceptibility,zone.critical_access,rain_mm,count)
    result=RiskAssessment(zone_id=zone.id,score=score,category=category,reasons=reasons)
    db.add(result);db.flush()
    record(db,user.id,"risk.assessment_completed",result,public_payload={"zone_id":zone.id,"category":category,"score":score,"kind":"inspection_priority_not_probability"})
    db.commit();return {**resource(result),"methodology":"risk-v1: regla heurística de prioridad de inspección; NO probabilidad de huaico","reading_count":len(by_source)}

@router.get("/risk/assessments")
def assessments(db:Session=Depends(get_db),user:User=Depends(require_roles("inspector","authority","dispatcher"))):
    return [resource(a) for a in db.scalars(select(RiskAssessment).order_by(RiskAssessment.evaluated_at.desc()).limit(200)).all()]

@router.post("/resources",status_code=201)
def asset_create(body:ResponseAssetIn,db:Session=Depends(get_db),user:User=Depends(require_roles("authority"))):
    if db.scalar(select(ResponseAsset).where(ResponseAsset.code==body.code)):
        raise HTTPException(409,"Código de recurso duplicado")
    a=ResponseAsset(**body.model_dump());db.add(a);db.flush();record(db,user.id,"resource.registered",a)
    db.commit();return resource(a)

@router.get("/resources")
def assets(db:Session=Depends(get_db),user:User=Depends(require_roles("inspector","authority","dispatcher"))):
    return [resource(a) for a in db.scalars(select(ResponseAsset).limit(200)).all()]

@router.post("/resources/{id}/decision",status_code=201)
def decide(id:str,body:ResourceAction,db:Session=Depends(get_db),user:User=Depends(require_roles("authority"))):
    asset=must(db,ResponseAsset,id);zone=must(db,RiskZone,body.zone_id)
    transitions={"prepare":{"available","prepared"},"deploy":{"prepared"},"stand_down":{"prepared","deployed"}}
    if asset.state not in transitions[body.action]:
        raise HTTPException(409,f"La acción {body.action} no es válida desde {asset.state}")
    # No auto-positioning near hazards. External real-world deployment needs field check.
    new_state={"prepare":"prepared","deploy":"deployed","stand_down":"available"}[body.action]
    asset.state=new_state
    decision=ResponseDecision(asset_id=id,zone_id=zone.id,action=body.action,approved_by=user.id,reason=body.reason)
    db.add(decision);db.flush()
    record(db,user.id,"resource.decision_approved",decision,detail={"reason":body.reason},public_payload={"asset_id":id,"zone_id":zone.id,"action":body.action})
    db.commit();return {"decision":resource(decision),"asset_state":asset.state,"requires_field_execution":True}


@router.post("/risk/zones/{id}/refresh-forecast")
def refresh_forecast(id:str,db:Session=Depends(get_db),user:User=Depends(require_roles("inspector","authority"))):
    zone=must(db,RiskZone,id)
    try:data=forecast_24h(zone.lat,zone.lon)
    except WeatherProviderError as exc:raise HTTPException(503,str(exc)) from exc
    reading=RainReading(**data)
    db.add(reading);db.flush()
    record(db,user.id,"weather.forecast_imported",reading,public_payload={"reading_id":reading.id,"kind":"forecast","source":"Open-Meteo"})
    db.commit();return {**resource(reading),"disclaimer":"Pronóstico de modelo, no observación ni alerta oficial"}

@router.post("/risk/zones/{id}/outlook")
def outlook(id:str,db:Session=Depends(get_db),user:User=Depends(require_roles("inspector","authority"))):
    zone=must(db,RiskZone,id)
    since=now_utc()-timedelta(hours=3)
    forecasts=db.scalars(select(RainReading).where(RainReading.kind=="forecast",RainReading.observed_at>=since)).all()
    data=[r for r in forecasts if within_radius(r.lon,r.lat,zone.lon,zone.lat,zone.radius_m)]
    if not data:raise HTTPException(409,"No hay pronóstico vigente. Importe datos o actualice un proveedor autorizado")
    freshest=max(data,key=lambda r:r.created_at)
    score,category,reasons=compute_risk(zone.susceptibility,zone.critical_access,freshest.mm,0)
    result=RiskAssessment(zone_id=zone.id,score=score,category=category,reasons=reasons+[
        f"Pronóstico: {freshest.source}, periodo {freshest.period_hours} h; puede cambiar", "No equivale a probabilidad de huaico"] ,rule_version="outlook-v1")
    db.add(result);db.flush()
    record(db,user.id,"risk.outlook_generated",result,public_payload={"zone_id":zone.id,"category":category,"kind":"forecast_based_inspection_priority"})
    db.commit();return {**resource(result),"source":freshest.source,"data_kind":"forecast","status":"decision_support_only"}

@router.get("/resources/recommend/{zone_id}")
def recommend(zone_id:str,db:Session=Depends(get_db),user:User=Depends(require_roles("inspector","authority"))):
    zone=must(db,RiskZone,zone_id)
    candidates=db.scalars(select(ResponseAsset).where(ResponseAsset.state.in_(["available","prepared"]))).all()
    from app.domain.geo import meters_between
    options=sorted(([{"asset_id":a.id,"code":a.code,"type":a.asset_type,"distance_straight_m":round(meters_between((a.lon,a.lat),(zone.lon,zone.lat))),"status":a.state} for a in candidates]),key=lambda a:a["distance_straight_m"])
    return {"zone_id":zone_id,"options":options[:20],"status":"unverified_candidates", "warning":"La distancia en línea recta NO es tiempo de respuesta ni ruta segura; inspector debe confirmar sitio, carretera y movilización"}
