import { parseApiUtcDate } from "@/lib/dates";
import type { AssistanceRecord, AssistanceStatus, RoutePlanRecord, StopRecord, SupportOption } from "@/types/boardsafe";

export const JOURNEY_LABELS: Record<AssistanceStatus, string> = {
  requested: "Solicitada", offered: "Unidad asignada", accepted: "Aceptada por conductor",
  onboard: "Viaje en curso", completed: "Completada", waiting_safe: "En espera segura",
  interrupted: "Viaje interrumpido", cancelled: "Cancelada", expired: "Solicitud vencida",
  unable_to_serve: "Sin cobertura verificada",
};

export const SUPPORT_LABELS: Record<SupportOption, string> = {
  ramp: "Rampa", audio: "Guía por audio", text: "Indicaciones en texto", boarding_help: "Apoyo de abordaje",
};

export function routeState(route: RoutePlanRecord): string {
  if (route.status !== "verified") return route.status;
  const expires = route.expires_at ? parseApiUtcDate(route.expires_at).getTime() : NaN;
  if (!Number.isFinite(expires) || expires <= Date.now()) return "expired";
  return route.valid_now === true ? "verified" : "blocked";
}

export const ROUTE_LABELS: Record<string, string> = {
  candidate: "Candidata: requiere inspección", verified: "Verificada y vigente",
  revoked: "Revocada", blocked: "Bloqueada o sin habilitación", expired: "Verificación vencida",
};

function distanceMetres(a: [number, number], b: [number, number]): number {
  const radians = (value: number) => value * Math.PI / 180;
  const dLat = radians(b[1] - a[1]);
  const dLon = radians(b[0] - a[0]);
  const q = Math.sin(dLat / 2) ** 2 + Math.cos(radians(a[1])) * Math.cos(radians(b[1])) * Math.sin(dLon / 2) ** 2;
  return 6371008.8 * 2 * Math.atan2(Math.sqrt(q), Math.sqrt(Math.max(0, 1 - q)));
}

/** Narrow the selector to nearby endpoints. Server still decides eligibility. */
export function routesForRequest(routes: RoutePlanRecord[], request: AssistanceRecord, stop?: StopRecord) {
  return routes.filter((route) => {
    const destinationMatches = distanceMetres(route.destination, [request.destination_lon, request.destination_lat]) <= 600;
    return destinationMatches && (request.state === "interrupted" || (stop && distanceMetres(route.origin, [stop.lon, stop.lat]) <= 600));
  });
}

export { fieldClass as journeyField, buttonClass as journeyButton } from "@/components/controls";
