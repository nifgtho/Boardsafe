from contextlib import asynccontextmanager
from pathlib import Path
from alembic.script import ScriptDirectory
from fastapi import FastAPI,Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import inspect,text
from sqlalchemy.exc import IntegrityError
from app.config import get_settings
from app.db import Base,SessionLocal
from app.api import auth,operations,reports,roads,assistance,sensing,resilience,map_events,kiosk

@asynccontextmanager
async def lifespan(app:FastAPI):
    # Migrations are intentionally explicit: alembic upgrade head BEFORE starting the API.
    yield

app=FastAPI(title="BoardSafe API",version="1.0.0",description="Continuidad de viajes accesibles, transporte digital y resiliencia territorial. Retos WFEO 1,3,4.",lifespan=lifespan)
s=get_settings()
app.add_middleware(CORSMiddleware,allow_origins=s.allowed_origins,allow_credentials=False,allow_methods=["GET","POST","PATCH","DELETE"],allow_headers=["Authorization","Content-Type","X-Node-Key","X-Ingest-Token"])

@app.middleware("http")
async def common_headers(request:Request,call_next):
    response=await call_next(request)
    response.headers["X-Content-Type-Options"]="nosniff"
    response.headers["X-Frame-Options"]="DENY"
    response.headers["Referrer-Policy"]="no-referrer"
    response.headers["Cache-Control"]="no-store"
    return response

@app.exception_handler(IntegrityError)
async def integrity_error_handler(request:Request,exc:IntegrityError):
    return JSONResponse(status_code=409,content={"detail":"Conflicto de integridad o referencia inexistente"})

@app.get("/health/live",tags=["Salud"])
def live():return {"status":"alive","service":"boardsafe"}

@app.get("/health/ready",tags=["Salud"])
def ready():
    database_connected=False
    try:
        with SessionLocal() as db:
            db.execute(text("SELECT 1"))
            database_connected=True
            tables=set(inspect(db.connection()).get_table_names())
            if not set(Base.metadata.tables).issubset(tables) or "alembic_version" not in tables:
                return JSONResponse(status_code=503,content={"status":"unavailable","database":"connected","schema":"pending_migrations"})
            expected=set(ScriptDirectory(str(Path(__file__).resolve().parent.parent / "migrations")).get_heads())
            actual=set(db.execute(text("SELECT version_num FROM alembic_version")).scalars())
            if actual!=expected:
                return JSONResponse(status_code=503,content={"status":"unavailable","database":"connected","schema":"pending_migrations"})
        return {"status":"ready","database":"connected","schema":"current","routing_configured":bool(get_settings().osrm_base_url)}
    except Exception:
        return JSONResponse(status_code=503,content={"status":"unavailable","database":"connected" if database_connected else "unavailable","schema":"unavailable"})

for router in [auth.router,operations.router,reports.router,roads.router,assistance.router,sensing.router,resilience.router,map_events.router,kiosk.router]:
    app.include_router(router,prefix="/api/v1")
