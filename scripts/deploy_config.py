"""Create/check deployment configuration without printing credentials (stdlib only)."""
import argparse
import os
from pathlib import Path
import re
import secrets
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[1]
SECRET_KEYS = ("DB_PASSWORD", "DB_APP_PASSWORD", "BOARDSAFE_JWT_SECRET", "BOARDSAFE_INGEST_TOKEN")


def read_values(path: Path) -> dict[str, str]:
    values = {}
    for number, line in enumerate(path.read_text().splitlines(), 1):
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        key, separator, value = line.partition("=")
        if not separator or not re.fullmatch(r"[A-Z][A-Z0-9_]*", key):
            raise ValueError(f"Línea de configuración inválida: {number}")
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        values[key] = value
    return values


def validate(values: dict[str, str], allow_local_http: bool = False) -> list[str]:
    errors = []
    for key in SECRET_KEYS:
        if not re.fullmatch(r"[0-9a-fA-F]{64,}", values.get(key, "")):
            errors.append(f"{key}: debe ser un secreto hexadecimal aleatorio de al menos 64 caracteres")
    if len({values.get(key) for key in SECRET_KEYS}) != len(SECRET_KEYS):
        errors.append("Los cuatro secretos deben ser independientes")
    origins = values.get("BOARDSAFE_CORS_ORIGINS", "").split(",")
    for origin in origins:
        origin = origin.strip()
        try:
            parsed = urlsplit(origin)
            parsed.port
        except ValueError:
            errors.append("BOARDSAFE_CORS_ORIGINS: origen o puerto inválido")
            break
        local = parsed.hostname in ("127.0.0.1", "localhost")
        scheme_ok = parsed.scheme == "https" or (allow_local_http and local and parsed.scheme == "http")
        if any(character.isspace() for character in origin) or not scheme_ok or not parsed.hostname or parsed.username or parsed.password or parsed.path or parsed.query or parsed.fragment or parsed.hostname.endswith("example.org"):
            errors.append("BOARDSAFE_CORS_ORIGINS: configura orígenes HTTPS exactos del despliegue")
            break
    routing = urlsplit(values.get("BOARDSAFE_OSRM_BASE_URL", ""))
    if routing.hostname == "router.project-osrm.org" or values.get("BOARDSAFE_PUBLIC_OSRM_ALLOWED") != "false":
        errors.append("OSRM público no está permitido en este perfil de despliegue")
    if not routing.hostname or routing.username or routing.password or routing.query or routing.fragment or not (routing.scheme == "https" or (routing.scheme == "http" and routing.hostname == "osrm")):
        errors.append("BOARDSAFE_OSRM_BASE_URL: usa el servicio osrm interno o un proveedor HTTPS")
    if values.get("BOARDSAFE_BIND_ADDRESS", "127.0.0.1") != "127.0.0.1":
        errors.append("El gateway de este perfil debe escuchar en 127.0.0.1 detrás del terminador TLS")
    try:
        if not 1 <= int(values.get("BOARDSAFE_HTTP_PORT", "8080")) <= 65535:
            raise ValueError()
    except ValueError:
        errors.append("BOARDSAFE_HTTP_PORT: puerto inválido")
    admin_email = values.get("BOARDSAFE_BOOTSTRAP_ADMIN_EMAIL", "")
    admin_password = values.get("BOARDSAFE_BOOTSTRAP_ADMIN_PASSWORD", "")
    if admin_email or admin_password:
        if not 5 <= len(admin_email) <= 320 or not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", admin_email):
            errors.append("BOARDSAFE_BOOTSTRAP_ADMIN_EMAIL: correo inválido")
        if not 12 <= len(admin_password.strip()) <= 256 or any(marker in admin_password.upper() for marker in ("REPLACE", "CHANGE_ME")):
            errors.append("BOARDSAFE_BOOTSTRAP_ADMIN_PASSWORD: configure una clave aleatoria de 12 a 256 caracteres")
        if admin_password in {values.get(key) for key in SECRET_KEYS}:
            errors.append("La contraseña del administrador debe ser independiente de los demás secretos")
    node_id = values.get("BOARDSAFE_KIOSK_NODE_ID", "")
    node_key = values.get("BOARDSAFE_KIOSK_NODE_KEY", "")
    if bool(node_id) != bool(node_key) or (node_key and len(node_key) < 30):
        errors.append("Tótem: configura juntos ID y clave privada válida, o deja ambos vacíos")
    return errors


def initialize(path: Path, origin: str, port: int = 8080, allow_local_http: bool = False, admin_email: str = "admin@gmail.com"):
    template = ROOT / "deploy/.env.example"
    values = read_values(template)
    values.update({key: secrets.token_hex(32) for key in SECRET_KEYS})
    values["BOARDSAFE_BOOTSTRAP_ADMIN_EMAIL"] = admin_email.strip().lower()
    values["BOARDSAFE_BOOTSTRAP_ADMIN_PASSWORD"] = secrets.token_urlsafe(32)
    values["BOARDSAFE_CORS_ORIGINS"] = origin
    values["BOARDSAFE_HTTP_PORT"] = str(port)
    errors = validate(values, allow_local_http)
    if errors:
        raise ValueError("; ".join(errors))
    lines = []
    for line in template.read_text().splitlines():
        key = line.partition("=")[0]
        lines.append(f"{key}={values[key]}" if key in values else line)
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, "w") as output:
        output.write("\n".join(lines) + "\n")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--file", type=Path, default=ROOT / "deploy/.env")
    parser.add_argument("--init", action="store_true")
    parser.add_argument("--origin")
    parser.add_argument("--admin-email", default="admin@gmail.com")
    parser.add_argument("--port", type=int, default=8080)
    parser.add_argument("--allow-local-http", action="store_true", help="Solo comprobaciones locales sin TLS")
    args = parser.parse_args()
    try:
        if args.init:
            if not args.origin:
                parser.error("--origin es obligatorio con --init")
            initialize(args.file, args.origin, args.port, args.allow_local_http, args.admin_email)
        problems = validate(read_values(args.file), args.allow_local_http)
        if problems:
            raise ValueError("; ".join(problems))
    except (OSError, ValueError) as error:
        # Error messages never contain configuration values.
        parser.exit(1, f"Configuración no válida: {error}\n")
    print("Configuración validada; no se imprimieron secretos. El proveedor OSRM y TLS requieren comprobación en vivo.")
