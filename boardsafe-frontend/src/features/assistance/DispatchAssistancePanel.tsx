"use client";

import { useState } from "react";
import { apiRequest, BoardSafeError } from "@/lib/api";
import type { AssistanceRecord, RoutePlanRecord, StopRecord, UserRole, VehicleRecord } from "@/types/boardsafe";
import { useJourneyData } from "./useJourneyData";
import { DriverAssistancePanel } from "./DriverAssistancePanel";
import { RouteVerificationPanel } from "./RouteVerificationPanel";
import { ApiError } from "@/components/ApiError";
import { JOURNEY_LABELS, SUPPORT_LABELS, journeyButton, journeyField, ROUTE_LABELS, routesForRequest, routeState } from "./journeys";

interface Props {
  token: string;
  role: UserRole;
  refreshTrigger: number;
  onDataChanged: () => void;
  onPreviewRoute: (id: string) => void;
  onRoutesChanged: (routes: RoutePlanRecord[]) => void;
}

interface AssignmentProps {
  request: AssistanceRecord;
  stop?: StopRecord;
  vehicles: VehicleRecord[];
  routes: RoutePlanRecord[];
  busy: boolean;
  onAssign: (id: string, vehicleId: string, routeId: string, recover: boolean) => Promise<void>;
}

function AssignmentForm({ request, stop, vehicles, routes, busy, onAssign }: AssignmentProps) {
  const [vehicleId, setVehicleId] = useState(request.vehicle_id ?? "");
  const [routeId, setRouteId] = useState("");
  const recover = request.state === "interrupted";
  const options = routesForRequest(routes, request, stop).filter((route) => routeState(route) === "verified");
  return <form className="space-y-3" onSubmit={async (event) => {
    event.preventDefault();
    await onAssign(request.id, recover ? request.vehicle_id ?? "" : vehicleId, routeId, recover);
  }}>
    <label htmlFor={`assign-vehicle-${request.id}`} className="block text-sm">Unidad con conductor
      <select id={`assign-vehicle-${request.id}`} required disabled={recover} value={recover ? request.vehicle_id ?? "" : vehicleId} onChange={(event) => setVehicleId(event.target.value)} className={journeyField}>
        <option value="">Selecciona una unidad</option>
        {vehicles.map((vehicle) => <option key={vehicle.id} value={vehicle.id} disabled={!vehicle.driver_id}>
          {vehicle.code} · {vehicle.driver_id ? vehicle.state_fresh ? "estado vigente" : "requiere confirmación" : "sin conductor"}
        </option>)}
      </select>
    </label>
    <label htmlFor={`assign-route-${request.id}`} className="block text-sm">Ruta verificada para este destino
      <select id={`assign-route-${request.id}`} required value={routeId} onChange={(event) => setRouteId(event.target.value)} className={journeyField}>
        <option value="">{options.length ? "Selecciona una ruta vigente" : "Primero planifica e inspecciona una ruta"}</option>
        {options.map((route) => <option key={route.id} value={route.id}>{route.id.slice(0, 8)} · {(route.distance_m / 1000).toFixed(2)} km</option>)}
      </select>
    </label>
    {recover && <p className="text-sm text-amber-200">La recuperación mantiene la unidad actual. Un transbordo requiere un procedimiento adicional.</p>}
    <button type="submit" disabled={busy || !routeId || !options.some((route) => route.id === routeId) || !(recover ? request.vehicle_id : vehicleId)} className={journeyButton}>
      {recover ? "Recuperar viaje con alternativa" : "Asignar unidad y ruta"}
    </button>
  </form>;
}

export function DispatchAssistancePanel({ token, role, refreshTrigger, onDataChanged, onPreviewRoute, onRoutesChanged }: Props) {
  const { data, error: loadError, loading, refresh } = useJourneyData(token, role, refreshTrigger, onRoutesChanged);
  const [tab, setTab] = useState<"requests" | "routes">(role === "inspector" || role === "authority" ? "routes" : "requests");
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<unknown>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const canDispatch = role === "dispatcher" || role === "admin";
  const canVerify = ["inspector", "authority", "admin"].includes(role);
  const requests = data?.requests ?? [];
  const routes = data?.routes ?? [];
  const stops = data?.stops ?? [];
  const vehicles = data?.vehicles ?? [];
  const active = requests.filter((request) => !["completed", "cancelled", "expired", "unable_to_serve"].includes(request.state));

  async function perform(key: string, path: string, body: unknown, message: string) {
    setBusy(key);
    setActionError(null);
    setFeedback(null);
    try {
      const result = await apiRequest<unknown>(path, { method: "POST", token, body });
      setFeedback(message);
      refresh();
      onDataChanged();
      return result;
    } catch (failure) {
      setActionError(failure);
      refresh();
      return null;
    } finally {
      setBusy(null);
    }
  }

  async function plan(request: AssistanceRecord) {
    const stop = stops.find((item) => item.id === request.stop_id);
    const vehicle = vehicles.find((item) => item.id === request.vehicle_id);
    const recovering = request.state === "interrupted";
    const originLat = recovering ? vehicle?.at_lat : stop?.lat;
    const originLon = recovering ? vehicle?.at_lon : stop?.lon;
    if (originLat == null || originLon == null) {
      setActionError(new BoardSafeError(422, "Falta un origen confirmado para planificar.", [], recovering ? "El conductor debe actualizar la ubicación de la unidad." : "Revisa el paradero de la solicitud."));
      return;
    }
    const result = await perform(`plan-${request.id}`, "/routes/plan", {
      origin_lat: originLat, origin_lon: originLon,
      destination_lat: request.destination_lat, destination_lon: request.destination_lon,
    }, "Alternativas calculadas. Un inspector o autoridad debe verificarlas antes de asignarlas.");
    if (Array.isArray(result) && result.length > 0) {
      const first = result[0] as RoutePlanRecord;
      onPreviewRoute(first.id);
      setTab("routes");
    }
  }

  async function assign(id: string, vehicleId: string, routeId: string, recover: boolean) {
    await perform(`assign-${id}`, `/assistance/${id}/${recover ? "recover" : "offer"}`, { vehicle_id: vehicleId, route_id: routeId }, recover ? "Continuidad recuperada con una alternativa verificada." : "Servicio ofrecido al conductor. Falta su aceptación y la confirmación del abordaje.");
  }

  return <section aria-label={role === "driver" ? "Servicios del conductor" : "Despacho y rutas"} className="space-y-4 rounded-2xl border border-slate-700 bg-slate-900 p-5 text-slate-100">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h2 className="text-lg font-bold">{role === "driver" ? "Mis servicios asignados" : "Despacho y rutas"}</h2>
        <p className="text-sm text-slate-300">Actualización cada 10 segundos mientras la página está visible.</p>
      </div>
      <button type="button" className={journeyButton} disabled={loading || !!busy} onClick={refresh}>{loading ? "Actualizando…" : "Actualizar"}</button>
    </div>
    <ApiError error={actionError} />
    <ApiError error={loadError} />
    {feedback && <p role="status" className="rounded-lg border border-teal-700 bg-teal-950 p-3 text-sm text-teal-100">{feedback}</p>}
    {role === "driver" ? <DriverAssistancePanel requests={requests} routes={routes} stops={stops} busy={!!busy} onPreview={onPreviewRoute} onAction={async (id, action) => {
      const messages = { accept: "Servicio aceptado. Comprueba el vehículo y la bahía antes de abordar.", board: "Abordaje confirmado por el servidor. Viaje en curso.", complete: "Viaje finalizado." };
      await perform(`${action}-${id}`, `/assistance/${id}/${action}`, undefined, messages[action]);
    }} /> : <>
      <div className="flex gap-2" aria-label="Vistas de coordinación">
        <button type="button" aria-pressed={tab === "requests"} className={tab === "requests" ? journeyButton : `${journeyButton} bg-slate-700`} onClick={() => setTab("requests")}>Solicitudes ({active.length})</button>
        <button type="button" aria-pressed={tab === "routes"} className={tab === "routes" ? journeyButton : `${journeyButton} bg-slate-700`} onClick={() => setTab("routes")}>Rutas ({routes.length})</button>
      </div>
      {tab === "routes" ? <RouteVerificationPanel routes={routes} canVerify={canVerify} busy={!!busy} onPreview={onPreviewRoute} onVerify={async (id, note, minutes) => {
        await perform(`verify-${id}`, `/routes/${id}/verify`, { note, valid_minutes: minutes }, "Verificación registrada con vigencia limitada. Despacho ya puede revisar su asignación.");
      }} /> : <div className="space-y-4">
        {!loading && !loadError && active.length === 0 && <p className="rounded-xl border border-slate-700 p-4 text-sm text-slate-300">Aún no hay solicitudes activas. Un pasajero puede solicitar asistencia después de registrar los paraderos reales.</p>}
        {active.map((request) => {
          const stop = stops.find((item) => item.id === request.stop_id);
          const route = routes.find((item) => item.id === request.route_id);
          const canAssign = canDispatch && ["requested", "waiting_safe", "offered", "interrupted"].includes(request.state);
          return <article key={request.id} className="space-y-3 rounded-xl border border-slate-700 bg-slate-950 p-4">
            <h3 className="text-base font-semibold">{stop?.name ?? "Paradero"} · solicitud {request.id.slice(0, 8)}</h3>
            <p className="text-sm" aria-live="polite">{JOURNEY_LABELS[request.state]}</p>
            <p className="text-sm text-slate-300">Apoyos: {request.support.map((support) => SUPPORT_LABELS[support]).join(", ")}</p>
            {route && <p className="text-sm text-slate-300">Ruta actual: {ROUTE_LABELS[routeState(route)]}</p>}
            {["waiting_safe", "interrupted"].includes(request.state) && <p role="status" className="rounded-lg bg-amber-950 p-3 text-sm text-amber-100">Coordina una alternativa inspeccionada y comunica los siguientes pasos al pasajero.</p>}
            <div className="flex flex-wrap gap-2">
              {(canDispatch || canVerify) && <button type="button" disabled={!!busy} className={journeyButton} onClick={() => void plan(request)}>Calcular alternativas viales</button>}
              {route && <button type="button" className={journeyButton} onClick={() => onPreviewRoute(route.id)}>Ver ruta actual</button>}
              {canDispatch && ["requested", "offered", "accepted", "waiting_safe"].includes(request.state) && <button type="button" disabled={!!busy} className={`${journeyButton} bg-rose-800 hover:bg-rose-700`} onClick={() => void perform(`cancel-${request.id}`, `/assistance/${request.id}/cancel`, undefined, "Solicitud cancelada.")}>Cancelar solicitud</button>}
            </div>
            {canAssign && <AssignmentForm request={request} stop={stop} routes={routes} vehicles={vehicles} busy={!!busy} onAssign={assign} />}
          </article>;
        })}
      </div>}
    </>}
  </section>;
}
