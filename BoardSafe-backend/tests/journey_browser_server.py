"""Isolated browser fixture. Never imports or seeds the operational database."""
import argparse
import json
import os
from pathlib import Path
import secrets
import subprocess
import sys
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


class RoutingFixture(BaseHTTPRequestHandler):
    calls = 0

    def do_GET(self):
        type(self).calls += 1
        coordinates = ([[-76.24, -9.93], [-76.235, -9.93], [-76.23, -9.92]]
                       if type(self).calls == 1 else
                       [[-76.24, -9.93], [-76.24, -9.914], [-76.23, -9.914], [-76.23, -9.92]])
        body = json.dumps({"code": "Ok", "routes": [{
            "geometry": {"type": "LineString", "coordinates": coordinates},
            "distance": 2200, "duration": 550,
        }]}).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", required=True, type=int)
    args = parser.parse_args()
    password = os.environ.get("BOARDSAFE_E2E_PASSWORD")
    if not password or len(password) < 12:
        raise SystemExit("A temporary BOARDSAFE_E2E_PASSWORD is required")
    backend = Path(__file__).resolve().parents[1]
    sys.path.insert(0, str(backend))
    router = ThreadingHTTPServer(("127.0.0.1", 0), RoutingFixture)
    threading.Thread(target=router.serve_forever, daemon=True).start()
    external_database = os.environ.get("BOARDSAFE_E2E_DATABASE_URL")
    if external_database:
        from sqlalchemy import create_engine, inspect
        from sqlalchemy.engine import make_url
        parsed = make_url(external_database)
        if parsed.drivername != "postgresql+psycopg" or parsed.database != "boardsafe_browser_test" or parsed.host not in {"127.0.0.1", "localhost"} or os.environ.get("BOARDSAFE_E2E_ALLOW_POSTGRES") != "1":
            raise SystemExit("PostgreSQL de navegador requiere el perfil aislado autorizado")
        check_engine = create_engine(external_database)
        try:
            if "users" in inspect(check_engine).get_table_names():
                raise SystemExit("La base de navegador debe ser nueva; no se reutilizan datos existentes")
        finally:
            check_engine.dispose()
    with tempfile.TemporaryDirectory(prefix="boardsafe-browser-") as directory:
        os.environ.update({
            "BOARDSAFE_DATABASE_URL": external_database or f"sqlite:///{directory}/test.sqlite",
            "BOARDSAFE_ENVIRONMENT": "test",
            "BOARDSAFE_BOOTSTRAP_ADMIN_EMAIL": "",
            "BOARDSAFE_BOOTSTRAP_ADMIN_PASSWORD": "",
            "BOARDSAFE_JWT_SECRET": secrets.token_hex(32),
            "BOARDSAFE_INGEST_TOKEN": secrets.token_hex(32),
            "BOARDSAFE_OSRM_BASE_URL": f"http://127.0.0.1:{router.server_port}",
            "BOARDSAFE_PUBLIC_OSRM_ALLOWED": "false",
            "BOARDSAFE_OPEN_METEO_ENABLED": "false",
            "BOARDSAFE_CORS_ORIGINS": os.environ.get("BOARDSAFE_E2E_WEB_ORIGIN", "http://127.0.0.1:3000,http://localhost:3000"),
        })
        subprocess.run([sys.executable, "-m", "alembic", "upgrade", "head"], cwd=backend, check=True, capture_output=True)
        from app.db import SessionLocal
        from app.models import User
        from app.security import password_hash
        with SessionLocal() as db:
            for role in ("admin", "dispatcher", "driver", "inspector", "authority", "passenger"):
                db.add(User(email=f"{role}@boardsafe.test", password_hash=password_hash(password), role=role))
            db.commit()
        import uvicorn
        from app.main import app
        try:
            uvicorn.run(app, host="127.0.0.1", port=args.port, log_level="warning")
        finally:
            router.shutdown()
            router.server_close()


if __name__ == "__main__":
    main()
