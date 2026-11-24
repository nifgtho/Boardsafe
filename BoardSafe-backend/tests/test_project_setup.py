from pathlib import Path
import stat

from alembic import command
from alembic.config import Config
import pytest
from sqlalchemy import func, select, text
from sqlalchemy.orm import sessionmaker

from app.config import get_settings
from app.db import SessionLocal, build_engine
from app.demo import DEMO_EMAIL, seed_demo
from app.models import Stop, User, Vehicle


def test_demo_is_repeatable_and_does_not_claim_field_verification(monkeypatch, tmp_path):
    monkeypatch.setattr(get_settings(), "environment", "development")
    credentials = tmp_path / "demo.txt"
    first = seed_demo(credentials)
    original_file = credentials.read_text()
    second = seed_demo(credentials)
    assert first["created"] == ["driver", "stop", "vehicle"]
    assert second["created"] == []
    assert first["driver_id"] == second["driver_id"]
    assert credentials.read_text() == original_file
    assert stat.S_IMODE(credentials.stat().st_mode) == 0o600
    assert "Contraseña:" in original_file
    with SessionLocal() as db:
        assert db.scalar(select(func.count(User.id))) == 1
        stop = db.scalar(select(Stop))
        vehicle = db.scalar(select(Vehicle))
        assert stop.name.startswith("[DEMO]") and stop.bay_status == "unknown"
        assert stop.bay_checked_at is None and not stop.wheelchair_accessible
        assert vehicle.driver_id == first["driver_id"]
        assert vehicle.ramp_ok is None and vehicle.accessible_spaces_free is None
        assert vehicle.state_checked_at is None


@pytest.mark.parametrize("environment", ["test", "production"])
def test_demo_refuses_other_environments(monkeypatch, tmp_path, environment):
    monkeypatch.setattr(get_settings(), "environment", environment)
    path = tmp_path / "credentials.txt"
    with pytest.raises(ValueError, match="development"):
        seed_demo(path)
    assert not path.exists()


def test_demo_does_not_take_over_an_existing_account(monkeypatch, tmp_path, actor):
    user = actor("passenger", email=DEMO_EMAIL)
    monkeypatch.setattr(get_settings(), "environment", "development")
    with pytest.raises(ValueError, match="otro rol"):
        seed_demo(tmp_path / "credentials.txt")
    with SessionLocal() as db:
        assert db.get(User, user["id"]).role == "passenger"
        assert db.scalar(select(func.count(Stop.id))) == 0
        assert db.scalar(select(func.count(Vehicle.id))) == 0


def test_only_admin_can_list_staff_without_credential_fields(client, actor):
    admin = actor("admin")
    driver = actor("driver")
    passenger = actor("passenger")
    response = client.get("/api/v1/auth/staff", headers=admin["headers"])
    assert response.status_code == 200
    rows = response.json()
    assert {row["id"] for row in rows} == {admin["id"], driver["id"]}
    assert all(set(row) == {"id", "email", "role", "active"} for row in rows)
    assert client.get("/api/v1/auth/staff", headers=passenger["headers"]).status_code == 403
    assert client.get("/api/v1/auth/staff").status_code == 401


def test_readiness_requires_schema_and_current_migration(client, monkeypatch, tmp_path):
    import app.main as main
    url = f"sqlite:///{tmp_path}/readiness.sqlite"
    engine = build_engine(url)
    monkeypatch.setattr(main, "SessionLocal", sessionmaker(bind=engine))
    monkeypatch.setattr(get_settings(), "database_url", url)
    try:
        missing = client.get("/health/ready")
        assert missing.status_code == 503
        assert missing.json()["database"] == "connected"
        assert missing.json()["schema"] == "pending_migrations"
        backend = Path(__file__).resolve().parents[1]
        config = Config(str(backend / "alembic.ini"))
        config.set_main_option("script_location", str(backend / "migrations"))
        command.upgrade(config, "head")
        ready = client.get("/health/ready")
        assert ready.status_code == 200
        assert ready.json()["schema"] == "current"
        with engine.begin() as connection:
            connection.execute(text("UPDATE alembic_version SET version_num='0001_initial_schema'"))
        assert client.get("/health/ready").status_code == 503
    finally:
        engine.dispose()
