from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session
from app.db import get_db
from app.models import User,RevokedToken
from app.schemas import Account, Login, CreateStaff
from app.security import password_hash, password_verify, create_access_token, get_current_user, require_roles, decode_token, bearer
from app.services import record

router = APIRouter(prefix="/auth", tags=["Autenticación"])

@router.post("/register", status_code=201)
def register(body: Account, db: Session = Depends(get_db)):
    if db.scalar(select(User).where(User.email==body.email)):
        raise HTTPException(409, "El correo ya está registrado")
    u=User(email=body.email,password_hash=password_hash(body.password),role="passenger")
    db.add(u); db.flush()
    record(db,u.id,"user.registered",u,public_payload={"user_id":u.id})
    db.commit()
    return {"id":u.id,"email":u.email,"role":u.role}

@router.post("/login")
def login(body: Login, db: Session=Depends(get_db)):
    user=db.scalar(select(User).where(User.email==body.email.strip().lower()))
    if not user or not user.active or not password_verify(body.password,user.password_hash):
        raise HTTPException(401,"Credenciales incorrectas")
    return {"access_token":create_access_token(user),"token_type":"bearer", "expires_in":get_token_expiry()}

def get_token_expiry():
    from app.config import get_settings
    return get_settings().access_token_minutes*60

@router.get("/me")
def me(user:User=Depends(get_current_user)):
    return {"id":user.id,"email":user.email,"role":user.role,"active":user.active}

@router.post("/staff", status_code=201)
def create_staff(body:CreateStaff,db:Session=Depends(get_db),admin:User=Depends(require_roles("admin"))):
    if db.scalar(select(User).where(User.email==body.email)):
        raise HTTPException(409,"El correo ya existe")
    u=User(email=body.email,password_hash=password_hash(body.password),role=body.role)
    db.add(u);db.flush();record(db,admin.id,"user.staff_created",u,detail={"role":u.role})
    db.commit()
    return {"id":u.id,"email":u.email,"role":u.role}


@router.post("/logout")
def logout(auth=Depends(bearer),user:User=Depends(get_current_user),db:Session=Depends(get_db)):
    """Invalidate current JWT jti until natural expiration."""
    from datetime import datetime,timezone
    claims=decode_token(auth.credentials)
    expires=datetime.fromtimestamp(claims["exp"],tz=timezone.utc).replace(tzinfo=None)
    db.add(RevokedToken(jti=claims["jti"],expires_at=expires))
    db.commit()
    return {"session":"revoked"}
