"""Maintenance worker. Run as separate service, one scheduler instance at a time."""
import argparse
import time
from datetime import timedelta
from sqlalchemy import select,delete
from app.db import SessionLocal,now_utc
from app.models import Assistance,EdgeEvent,KioskTicket,RevokedToken
from app.services import record

ACTIVE_REQUESTS={"requested","offered","accepted","waiting_safe"}

def maintenance_once():
    expired=0;removed=0
    with SessionLocal() as db:
        for a in db.scalars(select(Assistance).where(Assistance.expires_at<now_utc(),Assistance.state.in_(ACTIVE_REQUESTS))).all():
            a.state="expired";a.support=[];a.consent_operational=False
            record(db,None,"assistance.expired",a,public_payload={"assistance_id":a.id,"status":"expired"})
            expired+=1
        # Device metadata minimization. No raw video is ever stored by this app.
        result=db.execute(delete(EdgeEvent).where(EdgeEvent.received_at<now_utc()-timedelta(days=7)))
        removed=result.rowcount or 0
        db.execute(delete(KioskTicket).where(KioskTicket.expires_at<now_utc()))
        db.execute(delete(RevokedToken).where(RevokedToken.expires_at<now_utc()))
        db.commit()
    return {"expired":expired,"old_edge_events_deleted":removed}




def refresh_forecast_watches(max_zones=5):
    """Optional model forecast ingestion with authority-oriented WATCH events, never official warnings.

    Execute at most hourly, only when BOARDSAFE_OPEN_METEO_ENABLED=true and after
    the deployment operator has confirmed the provider's applicable license.
    """
    from app.config import get_settings
    from app.integrations.open_meteo import forecast_24h
    from app.models import RiskZone,RainReading,RiskAssessment
    from app.domain.rules import compute_risk
    if not get_settings().open_meteo_enabled:return {"disabled":True}
    processed=0;new_watches=0;errors=[]
    with SessionLocal() as db:
        # Least-recently-evaluated zones first; fair rotation when the provider has quotas.
        candidates=db.scalars(select(RiskZone).limit(5000)).all()
        latest={}
        for assessment in db.scalars(select(RiskAssessment).where(RiskAssessment.rule_version=="outlook-v1")).all():
            latest[assessment.zone_id]=max(assessment.evaluated_at, latest.get(assessment.zone_id, assessment.evaluated_at))
        zones=sorted(candidates,key=lambda z:latest.get(z.id) or now_utc().replace(year=2000))[:max_zones]
        for zone in zones:
            try:
                forecast=forecast_24h(zone.lat,zone.lon)
                previous=db.scalar(select(RiskAssessment).where(RiskAssessment.zone_id==zone.id,RiskAssessment.rule_version=="outlook-v1").order_by(RiskAssessment.evaluated_at.desc()).limit(1))
                reading=RainReading(**forecast)
                db.add(reading)
                score,category,reasons=compute_risk(zone.susceptibility,zone.critical_access,forecast["mm"],0)
                assessment=RiskAssessment(zone_id=zone.id,score=score,category=category,
                    reasons=reasons+["Pronóstico modelado, no alerta oficial"],rule_version="outlook-v1")
                db.add(assessment);db.flush()
                if category=="high" and (not previous or previous.category!="high"):
                    record(db,None,"risk.watch_recommended",assessment,public_payload={
                        "zone_id":zone.id,"category":category,"data_kind":"forecast",
                        "action":"human_inspection_required","official_warning":False})
                    new_watches+=1
                db.commit();processed+=1
            except Exception as exc:
                db.rollback()
                errors.append({"zone_id":zone.id,"error_type":type(exc).__name__})
    return {"processed_zones":processed,"new_watch_recommendations":new_watches,"errors":errors}


if __name__=="__main__":
    parser=argparse.ArgumentParser()
    parser.add_argument("--once",action="store_true")
    parser.add_argument("--interval",type=int,default=60)
    args=parser.parse_args()
    if args.once:
        print(maintenance_once())
        print(refresh_forecast_watches())
    else:
        next_forecast=0
        while True:
            try:
                print(maintenance_once(),flush=True)
                if time.monotonic()>=next_forecast:
                    print(refresh_forecast_watches(),flush=True)
                    next_forecast=time.monotonic()+3600
            except Exception as exc:print(f"Maintenance error: {type(exc).__name__}",flush=True)
            time.sleep(max(30,args.interval))
