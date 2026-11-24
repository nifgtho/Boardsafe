"""Actual HTTP routing against OSRM. Never creates synthetic straight-line routes."""
from urllib.parse import urlsplit
import httpx
from fastapi import HTTPException
from app.config import get_settings

class RoutingUnavailable(Exception):
    pass

def _configured_url():
    s = get_settings()
    base = s.osrm_base_url.rstrip("/")
    if not base:
        raise RoutingUnavailable("No hay servicio OSRM configurado. Consulte el manual de despliegue.")
    p = urlsplit(base)
    if p.scheme not in ("http", "https") or not p.hostname or p.username or p.password or p.query or p.fragment:
        raise RoutingUnavailable("BOARDSAFE_OSRM_BASE_URL no es válido")
    # Protect production from accidental SSRF via user-supplied URLs: URL never comes from request.
    if s.environment == "production" and p.scheme == "http" and p.hostname not in ("osrm", "localhost", "127.0.0.1"):
        raise RoutingUnavailable("OSRM externo debe usar HTTPS")
    if p.hostname == "router.project-osrm.org" and not s.public_osrm_allowed:
        raise RoutingUnavailable("El OSRM público está deshabilitado por defecto")
    return base

def fetch_routes(origin: tuple, destination: tuple):
    base = _configured_url()
    url = f"{base}/route/v1/driving/{origin[0]},{origin[1]};{destination[0]},{destination[1]}"
    try:
        with httpx.Client(timeout=get_settings().routing_timeout_seconds, follow_redirects=False) as client:
            resp = client.get(url, params={"alternatives":"true", "steps":"false", "overview":"full", "geometries":"geojson"})
            resp.raise_for_status()
            payload = resp.json()
    except (httpx.HTTPError, ValueError) as exc:
        raise RoutingUnavailable("No se pudo consultar el servicio de rutas") from exc
    if payload.get("code") != "Ok" or not payload.get("routes"):
        raise RoutingUnavailable("El proveedor no encontró rutas para el origen y destino")
    output=[]
    for route in payload["routes"][:5]:
        geometry = route.get("geometry")
        if not isinstance(geometry, dict) or geometry.get("type") != "LineString" or len(geometry.get("coordinates", [])) < 2:
            continue
        output.append({"geometry":geometry, "distance_m": float(route["distance"]), "duration_s": float(route["duration"])})
    if not output:
        raise RoutingUnavailable("OSRM no devolvió geometrías válidas")
    return output
