from datetime import timedelta
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, func
from sqlalchemy.orm import Session
from app.db import get_db,now_utc
from app.models import User,Report
from app.schemas import ReportIn,ReportReview
from app.security import get_current_user,require_roles
from app.services import must,resource,record

router=APIRouter(prefix="/reports",tags=["Reportes ciudadanos y de transportistas"])

@router.post("",status_code=201)
def create_report(body:ReportIn,db:Session=Depends(get_db),user:User=Depends(get_current_user)):
    # Durable, per-identity rate limitation (additional IP rate limiting at reverse proxy is required).
    since=now_utc()-timedelta(minutes=10)
    count=db.scalar(select(func.count(Report.id)).where(Report.author_id==user.id,Report.created_at>=since))
    if count >= 5:
        raise HTTPException(429,"Ha alcanzado el límite de 5 reportes en 10 minutos")
    r=Report(**body.model_dump(),author_id=user.id,status="pending")
    db.add(r);db.flush();record(db,user.id,"report.submitted",r,public_payload={"report_id":r.id,"kind":r.kind,"status":"pending"})
    db.commit();return resource(r)

@router.get("")
def list_reports(status:str|None=None,db:Session=Depends(get_db),user:User=Depends(get_current_user)):
    query=select(Report)
    if user.role not in {"dispatcher","inspector","authority","admin"}:
        query=query.where(Report.author_id==user.id)
    if status:
        if status not in {"pending","verified","rejected"}:raise HTTPException(422,"Estado desconocido")
        query=query.where(Report.status==status)
    return [resource(r) for r in db.scalars(query.order_by(Report.created_at.desc()).limit(300)).all()]

@router.post("/{id}/review")
def review(id:str,body:ReportReview,db:Session=Depends(get_db),user:User=Depends(require_roles("inspector","authority"))):
    r=must(db,Report,id)
    if r.status!="pending":raise HTTPException(409,"Este reporte ya se revisó")
    r.status=body.status;r.verified_by=user.id;r.reviewed_at=now_utc()
    record(db,user.id,"report.reviewed",r,detail={"status":r.status,"reason":body.reason},public_payload={"report_id":r.id,"status":r.status})
    db.commit();return resource(r)
