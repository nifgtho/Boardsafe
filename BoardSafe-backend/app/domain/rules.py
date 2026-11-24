"""Pure domain policy. No ML guesses, no medical inference, fail closed on stale data."""
from datetime import timedelta
from app.db import now_utc
from app.domain.geo import near_route, meters_between

TERMINAL = {"completed", "cancelled", "expired", "unable_to_serve"}
SUPPORT_ALLOWED = {"ramp", "audio", "text", "boarding_help"}

def is_fresh(dt, seconds: int) -> bool:
    return bool(dt and 0 <= (now_utc()-dt).total_seconds() <= seconds)

def active_restrictions(restrictions):
    return [r for r in restrictions if r.status == "closed" and (r.expires_at is None or r.expires_at > now_utc())]

def route_blockers(geometry: dict, restrictions):
    return [r.id for r in active_restrictions(restrictions) if near_route(geometry, r.geometry)]

def route_valid(route, restrictions):
    return bool(route and route.status == "verified" and route.expires_at and route.expires_at > now_utc() and not route_blockers(route.geometry, restrictions))

def offer_eligibility(request, stop, vehicle, route, restrictions, stale_seconds):
    reasons=[]
    if request.expires_at <= now_utc(): reasons.append("La solicitud ha caducado")
    if request.state not in {"requested", "waiting_safe", "offered"}: reasons.append("La solicitud no admite asignación")
    if not route_valid(route, restrictions): reasons.append("La ruta no está verificada, ha vencido o está cerrada")
    if route and meters_between((stop.lon,stop.lat), route.origin) > 600: reasons.append("La ruta no inicia cerca del paradero")
    if route and meters_between((request.destination_lon,request.destination_lat), route.destination) > 600: reasons.append("La ruta no llega al destino solicitado")
    if not is_fresh(vehicle.state_checked_at, stale_seconds): reasons.append("La información del vehículo está desactualizada")
    if "ramp" in request.support:
        if vehicle.accessible_spaces_free is None or vehicle.accessible_spaces_free <= 0: reasons.append("No hay plaza accesible confirmada")
        if vehicle.ramp_ok is not True: reasons.append("La rampa no está confirmada como operativa")
    return reasons

def boarding_eligibility(request, stop, vehicle, route, restrictions, stale_seconds):
    reasons = offer_eligibility_recheck(request, stop, vehicle, route, restrictions, stale_seconds)
    if request.state != "accepted": reasons.append("La asistencia debe estar aceptada por el conductor")
    if stop.bay_status != "clear" or not is_fresh(stop.bay_checked_at, stale_seconds):
        reasons.append("El acceso del paradero no está confirmado como despejado")
    return reasons

def offer_eligibility_recheck(request, stop, vehicle, route, restrictions, stale_seconds):
    reasons=[]
    if request.expires_at <= now_utc(): reasons.append("La solicitud ha caducado")
    if not route_valid(route, restrictions): reasons.append("Ruta cerrada, sin verificar o caducada")
    if not is_fresh(vehicle.state_checked_at, stale_seconds): reasons.append("Estado del vehículo desactualizado")
    if "ramp" in request.support and (vehicle.accessible_spaces_free is None or vehicle.accessible_spaces_free == 0 or vehicle.ramp_ok is not True):
        reasons.append("No hay rampa y plaza accesible confirmadas")
    return reasons

def compute_risk(susceptibility: int, critical_access: bool, rain_mm: float, verified_reports: int):
    """Rule-based inspection PRIORITY only, not probability, forecasting or official alert."""
    score = min(100, susceptibility*12 + min(30, rain_mm/4) + min(15, verified_reports*5) + (10 if critical_access else 0))
    category = "high" if score >= 70 else "medium" if score >= 40 else "low"
    reasons = [f"Susceptibilidad geológica {susceptibility}/5", f"Precipitación observada acumulada considerada: {rain_mm:.1f} mm", f"Reportes corroborados próximos: {verified_reports}"]
    if critical_access: reasons.append("Posible afectación a un servicio esencial")
    return int(round(score)), category, reasons
