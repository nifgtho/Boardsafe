import hashlib
import hmac
import secrets
from datetime import timedelta
from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError, VerificationError
import jwt
from fastapi import Depends, HTTPException
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.orm import Session
from app.config import get_settings
from app.db import get_db, now_utc
from app.models import User, RevokedToken

ph = PasswordHasher(time_cost=2, memory_cost=65536, parallelism=2)
bearer = HTTPBearer(auto_error=False)

def password_hash(password: str):
    return ph.hash(password)

def password_verify(password: str, hashed: str):
    try:
        return ph.verify(hashed, password)
    except (VerifyMismatchError, VerificationError):
        return False

def create_access_token(user: User):
    settings = get_settings()
    now = now_utc()
    payload = {"sub": user.id, "role": user.role, "iss": "boardsafe", "iat": now, "exp": now + timedelta(minutes=settings.access_token_minutes), "jti": secrets.token_hex(12)}
    return jwt.encode(payload, settings.jwt_secret, algorithm="HS256")

def decode_token(token: str):
    try:
        return jwt.decode(token, get_settings().jwt_secret, algorithms=["HS256"], issuer="boardsafe", options={"require": ["sub", "exp", "iat", "iss"]})
    except jwt.PyJWTError:
        raise HTTPException(status_code=401, detail="Sesión inválida o expirada")

def get_current_user(auth: HTTPAuthorizationCredentials | None = Depends(bearer), db: Session = Depends(get_db)) -> User:
    if not auth or auth.scheme.lower() != "bearer":
        raise HTTPException(status_code=401, detail="Inicie sesión")
    claims = decode_token(auth.credentials)
    if claims.get("jti") and db.get(RevokedToken, claims["jti"]):
        raise HTTPException(status_code=401, detail="La sesión se cerró")
    user = db.get(User, claims["sub"])
    if not user or not user.active or user.role != claims.get("role"):
        raise HTTPException(status_code=401, detail="La sesión ya no es válida")
    return user

def require_roles(*allowed: str):
    def check(user: User = Depends(get_current_user)) -> User:
        if user.role not in allowed and user.role != "admin":
            raise HTTPException(status_code=403, detail="No tiene permisos para esta operación")
        return user
    return check

def hash_node_secret(secret: str) -> str:
    return hmac.new(get_settings().jwt_secret.encode(), secret.encode(), hashlib.sha256).hexdigest()

def secure_equals(a, b):
    return hmac.compare_digest(a, b)
