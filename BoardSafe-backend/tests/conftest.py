import os
import tempfile
from pathlib import Path

# Set DB before app.db is imported.
DB_FILE=Path(tempfile.gettempdir()) / f"boardsafe_tests_{os.getpid()}.sqlite"
os.environ["BOARDSAFE_DATABASE_URL"]=f"sqlite:///{DB_FILE}"
os.environ["BOARDSAFE_ENVIRONMENT"]="test"
os.environ["BOARDSAFE_JWT_SECRET"]="this-is-a-tests-only-secret-and-never-production"
os.environ["BOARDSAFE_INGEST_TOKEN"]="test-ingest-token-for-real-observations-123"

import pytest
from fastapi.testclient import TestClient
from app.db import engine,SessionLocal,Base
import app.models as m
from app.security import password_hash,create_access_token
from app.main import app

@pytest.fixture(autouse=True)
def database():
    Base.metadata.create_all(engine)
    with SessionLocal() as db:
        for table in reversed(Base.metadata.sorted_tables):
            db.execute(table.delete())
        db.commit()
    yield

@pytest.fixture
def client():
    with TestClient(app) as c:yield c

@pytest.fixture
def actor():
    def make(role="passenger", email=None):
        with SessionLocal() as db:
            u=m.User(email=email or f"{role}-{m.uid()}@boardsafe.test",password_hash=password_hash("VeryStrongPass123!"),role=role)
            db.add(u);db.commit();db.refresh(u)
            return {"id":u.id,"role":u.role,"headers":{"Authorization":"Bearer "+create_access_token(u)},"email":u.email}
    return make

@pytest.fixture
def network(client,actor):
    dispatch=actor("dispatcher");inspector=actor("inspector");authority=actor("authority");driver=actor("driver");passenger=actor("passenger")
    s=client.post("/api/v1/stops",headers=dispatch["headers"],json={"code":"S-01","name":"Paradero Centro", "lat":-9.93,"lon":-76.24,"wheelchair_accessible":True});assert s.status_code==201,s.text
    stop=s.json()
    v=client.post("/api/v1/vehicles",headers=dispatch["headers"],json={"code":"B-12","operator_name":"Operador autorizado", "driver_id":driver["id"],"accessible_spaces_total":1});assert v.status_code==201,v.text
    vehicle=v.json()
    route_geom={"type":"LineString","coordinates":[[-76.24,-9.93],[-76.235,-9.93],[-76.23,-9.92]]}
    with SessionLocal() as db:
        r=m.RoutePlan(requested_by=dispatch["id"],geometry=route_geom,origin=[-76.24,-9.93],destination=[-76.23,-9.92],distance_m=1600,duration_s=400,status="candidate")
        db.add(r);db.commit();db.refresh(r)
        route_id=r.id
    return {"passenger":passenger,"driver":driver,"dispatcher":dispatch,"inspector":inspector,"authority":authority,"stop":stop,"vehicle":vehicle,"route_id":route_id,"route_geom":route_geom}
