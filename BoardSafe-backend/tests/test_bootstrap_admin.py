from pathlib import Path

import pytest
from pydantic import SecretStr
from sqlalchemy import func, select
from sqlalchemy.orm import sessionmaker

from app.bootstrap import admin_credentials, ensure_admin, migrate_and_bootstrap
from app.config import get_settings
from app.db import SessionLocal, build_engine
from app.models import AuditLog, User
from app.security import password_verify

PASSWORD = "Bootstrap-tests-only-password-1924"


def test_admin_created_once_without_password_reset_or_secret_in_audit(client):
    credentials = admin_credentials("  ADMIN@boardsafe.test ", PASSWORD)
    assert ensure_admin(credentials) == "created"
    assert ensure_admin(admin_credentials("admin@boardsafe.test", "Another-tests-only-password")) == "existing"
    with SessionLocal() as db:
        assert db.scalar(select(func.count(User.id))) == 1
        user = db.scalar(select(User))
        assert user.role == "admin" and user.active
        assert user.email == "admin@boardsafe.test"
        assert user.password_hash != PASSWORD
        assert password_verify(PASSWORD, user.password_hash)
        assert not password_verify("Another-tests-only-password", user.password_hash)
        logs = db.scalars(select(AuditLog)).all()
        assert len(logs) == 1 and logs[0].action == "user.admin_bootstrapped"
        assert PASSWORD not in str(logs[0].detail)
    login = client.post("/api/v1/auth/login", json={"email": "admin@boardsafe.test", "password": PASSWORD})
    assert login.status_code == 200
    assert client.get("/api/v1/auth/staff", headers={"Authorization": "Bearer " + login.json()["access_token"]}).status_code == 200


@pytest.mark.parametrize("role,active", [("passenger", True), ("admin", False)])
def test_bootstrap_never_promotes_or_reactivates_an_existing_account(actor, role, active):
    existing = actor(role, email="existing@boardsafe.test")
    with SessionLocal() as db:
        user = db.get(User, existing["id"])
        user.active = active
        original_hash = user.password_hash
        db.commit()
    with pytest.raises(ValueError, match="administrador activo"):
        ensure_admin(admin_credentials(existing["email"], PASSWORD))
    with SessionLocal() as db:
        user = db.get(User, existing["id"])
        assert (user.role, user.active, user.password_hash) == (role, active, original_hash)


@pytest.mark.parametrize("email,password", [("", PASSWORD), ("admin@boardsafe.test", "short"), ("invalid-email", PASSWORD)])
def test_bad_bootstrap_credentials_do_not_expose_password(email, password):
    with pytest.raises(ValueError) as error:
        admin_credentials(email, password)
    assert password not in str(error.value)
    assert admin_credentials("", "") is None


def test_migration_entrypoint_creates_admin_after_schema_and_preserves_it(monkeypatch, tmp_path):
    import app.bootstrap as bootstrap
    settings = get_settings()
    monkeypatch.setattr(settings, "database_url", f"sqlite:///{tmp_path}/migrated.sqlite")
    monkeypatch.setattr(settings, "bootstrap_admin_email", "migration@boardsafe.test")
    monkeypatch.setattr(settings, "bootstrap_admin_password", SecretStr(PASSWORD))
    engine = build_engine(settings.database_url)
    factory = sessionmaker(bind=engine)
    original_ensure = bootstrap.ensure_admin
    monkeypatch.setattr(bootstrap, "ensure_admin", lambda account: original_ensure(account, factory))
    try:
        assert migrate_and_bootstrap() == "created"
        assert migrate_and_bootstrap() == "existing"
        with factory() as db:
            assert db.scalar(select(func.count(User.id))) == 1
            assert password_verify(PASSWORD, db.scalar(select(User)).password_hash)
    finally:
        engine.dispose()


def test_invalid_config_is_rejected_before_migrations(monkeypatch, tmp_path):
    database = tmp_path / "must-not-exist.sqlite"
    settings = get_settings()
    monkeypatch.setattr(settings, "database_url", f"sqlite:///{database}")
    monkeypatch.setattr(settings, "bootstrap_admin_email", "admin@boardsafe.test")
    monkeypatch.setattr(settings, "bootstrap_admin_password", SecretStr("bad"))
    with pytest.raises(ValueError):
        migrate_and_bootstrap()
    assert not Path(database).exists()


def test_failed_schema_migration_does_not_create_an_account(monkeypatch):
    from alembic import command
    import app.bootstrap as bootstrap
    settings = get_settings()
    monkeypatch.setattr(settings, "bootstrap_admin_email", "migration@boardsafe.test")
    monkeypatch.setattr(settings, "bootstrap_admin_password", SecretStr(PASSWORD))
    def fail(*args, **kwargs):
        raise RuntimeError("migration fixture failure")
    def unexpected_bootstrap(account):
        pytest.fail("Bootstrap ran before schema migration succeeded")
    monkeypatch.setattr(command, "upgrade", fail)
    monkeypatch.setattr(bootstrap, "ensure_admin", unexpected_bootstrap)
    with pytest.raises(RuntimeError, match="migration fixture failure"):
        migrate_and_bootstrap()
