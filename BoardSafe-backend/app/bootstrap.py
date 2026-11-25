"""Idempotent administrator provisioning after schema migrations; no default password."""
from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from app.db import SessionLocal
from app.models import User
from app.schemas import Account
from app.security import password_hash
from app.services import record, safety_lock


def admin_credentials(email: str, password: str) -> Account | None:
    if not email and not password:
        return None
    try:
        return Account(email=email, password=password)
    except ValidationError:
        # Pydantic errors can include input values: never print a password in CLI logs.
        raise ValueError("Configure BOARDSAFE_BOOTSTRAP_ADMIN_EMAIL y una clave de 12 a 256 caracteres válida") from None


def ensure_admin(account: Account, session_factory=SessionLocal) -> str:
    """Create once; never promote, reactivate or reset an existing account."""
    try:
        with session_factory() as db:
            safety_lock(db)
            existing = db.scalar(select(User).where(User.email == account.email))
            if existing:
                if existing.role != "admin" or not existing.active:
                    raise ValueError("El correo de bootstrap pertenece a una cuenta que no es un administrador activo")
                return "existing"
            user = User(email=account.email, password_hash=password_hash(account.password), role="admin")
            db.add(user)
            db.flush()
            record(db, None, "user.admin_bootstrapped", user)
            db.commit()
            return "created"
    except IntegrityError:
        # A competing invocation may have created this account since the first lookup.
        with session_factory() as db:
            user = db.scalar(select(User).where(User.email == account.email))
            if user and user.role == "admin" and user.active:
                return "existing"
        raise ValueError("Conflicto al crear el administrador; revise la cuenta configurada") from None


def migrate_and_bootstrap() -> str:
    from pathlib import Path
    from alembic import command
    from alembic.config import Config
    from app.config import get_settings

    settings = get_settings()
    account = admin_credentials(settings.bootstrap_admin_email, settings.bootstrap_admin_password.get_secret_value())
    backend = Path(__file__).resolve().parents[1]
    config = Config(str(backend / "alembic.ini"))
    config.set_main_option("script_location", str(backend / "migrations"))
    command.upgrade(config, "head")
    return ensure_admin(account) if account else "disabled"
