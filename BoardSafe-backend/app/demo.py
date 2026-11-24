"""Explicit, repeatable local demo provisioning; never runs at application startup."""
import os
from pathlib import Path
import secrets

from sqlalchemy import select

from app.config import get_settings
from app.db import SessionLocal
from app.models import Stop, User, Vehicle
from app.schemas import CreateStaff, StopIn, VehicleIn
from app.security import password_hash
from app.services import record

DEMO_EMAIL = "conductor.demo@boardsafe.test"
DEMO_STOP_CODE = "DEMO-S01"
DEMO_VEHICLE_CODE = "DEMO-V01"


def seed_demo(credentials_path: Path | None = None) -> dict:
    if get_settings().environment != "development":
        raise ValueError("La demostración solo se permite en development")
    credentials_path = credentials_path or Path(".demo-local.txt")
    created = []
    wrote_credentials = False
    password = None
    with SessionLocal() as db:
        if db.get_bind().dialect.name != "sqlite":
            raise ValueError("La demostración está limitada a SQLite local")
        try:
            driver = db.scalar(select(User).where(User.email == DEMO_EMAIL))
            if driver and (driver.role != "driver" or not driver.active):
                raise ValueError("La cuenta reservada DEMO existe con otro rol o está inactiva")
            if not driver:
                password = secrets.token_urlsafe(24)
                account = CreateStaff(email=DEMO_EMAIL, password=password, role="driver")
                driver = User(email=account.email, password_hash=password_hash(account.password), role=account.role)
                db.add(driver)
                db.flush()
                created.append("driver")
                record(db, None, "demo.driver_created", driver, detail={"demo": True})

            stop = db.scalar(select(Stop).where(Stop.code == DEMO_STOP_CODE))
            if stop and not stop.name.startswith("[DEMO]"):
                raise ValueError("El código de paradero DEMO está ocupado por un registro no identificado como prueba")
            if not stop:
                body = StopIn(code=DEMO_STOP_CODE, name="[DEMO] Paradero de pruebas — Huánuco",
                              lat=-9.9306, lon=-76.2422, wheelchair_accessible=False)
                stop = Stop(**body.model_dump())
                db.add(stop)
                db.flush()
                created.append("stop")
                record(db, None, "demo.stop_created", stop, detail={"demo": True, "field_verified": False})

            vehicle = db.scalar(select(Vehicle).where(Vehicle.code == DEMO_VEHICLE_CODE))
            if vehicle and (not vehicle.operator_name.startswith("[DEMO]") or vehicle.driver_id != driver.id):
                raise ValueError("El código de vehículo DEMO está ocupado por otra asignación")
            if not vehicle:
                body = VehicleIn(code=DEMO_VEHICLE_CODE, operator_name="[DEMO] Operador de pruebas",
                                 driver_id=driver.id, accessible_spaces_total=1)
                vehicle = Vehicle(**body.model_dump())
                db.add(vehicle)
                db.flush()
                created.append("vehicle")
                record(db, None, "demo.vehicle_created", vehicle, detail={"demo": True, "field_verified": False})

            if password:
                descriptor = os.open(credentials_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
                wrote_credentials = True
                with os.fdopen(descriptor, "w", encoding="utf-8") as output:
                    output.write(
                        "BOARDSAFE — ACCESO CONDUCTOR DE DEMOSTRACIÓN\n"
                        "URL: http://127.0.0.1:3000\n"
                        f"Correo: {driver.email}\nContraseña: {password}\n"
                        f"ID conductor: {driver.id}\nParadero: {stop.code}\nVehículo: {vehicle.code}\n\n"
                        "Datos ficticios identificados como DEMO, exclusivamente para pruebas locales.\n"
                        "Este archivo es privado. No subirlo a Git ni compartir su contraseña.\n"
                    )
            db.commit()
        except BaseException:
            db.rollback()
            if wrote_credentials:
                credentials_path.unlink(missing_ok=True)
            raise
        return {
            "demo": True, "created": created, "driver_email": driver.email,
            "driver_id": driver.id, "stop_code": stop.code, "vehicle_code": vehicle.code,
            "credentials_file": str(credentials_path), "credentials_available": credentials_path.is_file(),
        }
