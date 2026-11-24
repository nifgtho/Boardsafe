from datetime import datetime, timezone
from sqlalchemy import create_engine, event
from sqlalchemy.orm import DeclarativeBase, sessionmaker
from app.config import get_settings

def now_utc() -> datetime:
    """UTC naive in database for identical SQLite/PostgreSQL behavior; API emits explicit Z."""
    return datetime.now(timezone.utc).replace(tzinfo=None)

class Base(DeclarativeBase):
    pass

def build_engine(url: str):
    kwargs = {"pool_pre_ping": True}
    if url.startswith("sqlite"):
        kwargs["connect_args"] = {"check_same_thread": False}
    engine = create_engine(url, **kwargs)
    if url.startswith("sqlite"):
        @event.listens_for(engine, "connect")
        def enable_foreign_keys(connection, _):
            cursor = connection.cursor()
            cursor.execute("PRAGMA foreign_keys=ON")
            cursor.close()
    return engine

engine = build_engine(get_settings().database_url)
SessionLocal = sessionmaker(bind=engine, expire_on_commit=False, autoflush=False)

def get_db():
    with SessionLocal() as db:
        yield db
