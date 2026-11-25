"""Full browser journey + pg_dump/pg_restore in a disposable loopback-only PostGIS.

Requires an already built frontend, backend .venv, Chromium and Docker.
Never reads the operational .env or database. Deletes only its randomly named container.
"""
import json
import os
from pathlib import Path
import secrets
import shutil
import socket
import subprocess
import tempfile
import time
import urllib.request

ROOT = Path(__file__).resolve().parents[1]


def free_port():
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        return listener.getsockname()[1]


def main():
    artifact = ROOT / "boardsafe-frontend/.next/standalone/server.js"
    if not artifact.is_file():
        raise SystemExit("Ejecuta npm --prefix boardsafe-frontend run build primero")
    name = "boardsafe-pg-verify-" + secrets.token_hex(6)
    password = secrets.token_hex(32)
    database = "boardsafe_browser_test"
    owner = "boardsafe_test_owner"
    db_port, web_port = free_port(), free_port()
    environment = {**os.environ, "POSTGRES_PASSWORD": password}
    web = None
    created = False

    def docker(*arguments, input=None):
        result = subprocess.run(["docker", *arguments], input=input, capture_output=True, env=environment)
        if result.returncode:
            raise RuntimeError("Operación Docker de prueba fallida: " + result.stderr.decode(errors="replace").replace(password, "[redacted]")[:1000])
        return result.stdout

    def sql(db, query):
        return docker("exec", name, "psql", "-U", owner, "-d", db, "-At", "-c", query).decode().strip()

    try:
        docker("run", "-d", "--name", name, "-e", "POSTGRES_PASSWORD", "-e", f"POSTGRES_USER={owner}", "-e", f"POSTGRES_DB={database}", "-p", f"127.0.0.1:{db_port}:5432", "postgis/postgis:16-3.4")
        created = True
        for _ in range(60):
            result = subprocess.run(["docker", "exec", name, "pg_isready", "-h", "127.0.0.1", "-U", owner, "-d", database], capture_output=True)
            if result.returncode == 0:
                # pg_isready also succeeds during the entrypoint's temporary local server.
                try:
                    with socket.create_connection(("127.0.0.1", db_port), timeout=1):
                        break
                except OSError:
                    pass
            time.sleep(1)
        else:
            raise RuntimeError("PostGIS de prueba no quedó disponible")
        with tempfile.TemporaryFile() as web_log:
            web = subprocess.Popen([shutil.which("node") or "node", str(artifact)], cwd=artifact.parent, env={**os.environ, "PORT": str(web_port), "HOSTNAME": "127.0.0.1", "NODE_ENV": "production"}, stdout=web_log, stderr=web_log)
            origin = f"http://127.0.0.1:{web_port}"
            for _ in range(60):
                try:
                    with urllib.request.urlopen(origin, timeout=2) as response:
                        if response.status == 200:
                            break
                except Exception:
                    if web.poll() is not None:
                        raise RuntimeError("Frontend de prueba terminó antes del recorrido")
                    time.sleep(1)
            else:
                raise RuntimeError("Frontend de prueba no quedó disponible")
            run = subprocess.run([shutil.which("npm") or "npm", "run", "test:journeys"], cwd=ROOT / "boardsafe-frontend", env={
                **os.environ, "BOARDSAFE_E2E_WEB_URL": origin, "BOARDSAFE_E2E_ALLOW_POSTGRES": "1",
                "BOARDSAFE_E2E_DATABASE_URL": f"postgresql+psycopg://{owner}:{password}@127.0.0.1:{db_port}/{database}",
            }, capture_output=True, text=True, timeout=300)
            print(run.stdout.replace(password, "[redacted]"), end="")
            if run.returncode:
                print(run.stderr.replace(password, "[redacted]"))
                raise RuntimeError("Recorrido PostgreSQL no aprobado")
        tables = ("users", "stops", "vehicles", "assistances", "route_plans", "reports", "road_restrictions", "risk_zones", "risk_assessments", "response_assets", "response_decisions", "audit_log", "domain_events", "edge_nodes")
        query = "SELECT json_build_object(" + ",".join(f"'{table}', (SELECT count(*) FROM {table})" for table in tables) + ")"
        before = json.loads(sql(database, query))
        assert int(sql(database, "SELECT count(*) FROM assistances WHERE state='completed'")) == 2
        assert before["response_decisions"] == 3 and before["edge_nodes"] == 1
        dump = docker("exec", name, "pg_dump", "-U", owner, "-d", database, "-Fc")
        docker("exec", name, "createdb", "-U", owner, "boardsafe_restore_test")
        docker("exec", "-i", name, "pg_restore", "-U", owner, "-d", "boardsafe_restore_test", "--exit-on-error", input=dump)
        after = json.loads(sql("boardsafe_restore_test", query))
        assert before == after
        assert sql("boardsafe_restore_test", "SELECT version_num FROM alembic_version") == "0002_postgis_indexes"
        assert sql("boardsafe_restore_test", "SELECT PostGIS_Version()")
        print("PostgreSQL/PostGIS: dos viajes completos, riesgo/recursos y trazabilidad aprobados. Backup/restauración coinciden en 14 tablas y revisión Alembic.")
    finally:
        if web and web.poll() is None:
            web.terminate()
            try:
                web.wait(timeout=10)
            except subprocess.TimeoutExpired:
                web.kill()
        if created:
            subprocess.run(["docker", "rm", "-fv", name], capture_output=True)


if __name__ == "__main__":
    main()
