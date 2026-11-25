"use client";

import type { AssistanceRecord, RoutePlanRecord, StopRecord } from "@/types/boardsafe";
import { JOURNEY_LABELS, SUPPORT_LABELS, journeyButton, routeState, ROUTE_LABELS } from "./journeys";

interface Props {
  requests: AssistanceRecord[];
  routes: RoutePlanRecord[];
  stops: StopRecord[];
  busy: boolean;
  onAction: (id: string, action: "accept" | "board" | "complete") => Promise<void>;
  onPreview: (id: string) => void;
}

export function DriverAssistancePanel({ requests, routes, stops, busy, onAction, onPreview }: Props) {
  const active = requests.filter((request) => !["completed", "cancelled", "expired", "unable_to_serve"].includes(request.state));
  return <div className="space-y-3">
    <p className="text-sm text-slate-300">Solo aparecen servicios asignados a tus vehículos. Confirma antes la rampa, plazas y ubicación en el panel de vehículos.</p>
    {active.length === 0 && <p className="rounded-xl border border-slate-700 p-4 text-sm text-slate-300">No tienes viajes activos asignados.</p>}
    {active.map((request) => {
      const stop = stops.find((item) => item.id === request.stop_id);
      const route = routes.find((item) => item.id === request.route_id);
      return <article key={request.id} className="space-y-3 rounded-xl border border-slate-700 bg-slate-950 p-4">
        <h3 className="text-base font-semibold">{stop?.name ?? "Paradero asignado"}</h3>
        <p className="text-sm" aria-live="polite">{JOURNEY_LABELS[request.state]}</p>
        <p className="text-sm text-slate-300">Apoyos: {request.support.map((support) => SUPPORT_LABELS[support]).join(", ")}</p>
        {route && <p className="text-sm text-slate-300">Ruta: {ROUTE_LABELS[routeState(route)]}</p>}
        {["waiting_safe", "interrupted"].includes(request.state) && <p role="status" className="rounded-lg bg-amber-950 p-3 text-sm text-amber-100">Coordina con despacho una alternativa verificada. No continúes por una ruta revocada.</p>}
        <div className="flex flex-wrap gap-2">
          {route && <button type="button" className={journeyButton} onClick={() => onPreview(route.id)}>Ver ruta en mapa</button>}
          {request.state === "offered" && <button disabled={busy} type="button" className={journeyButton} onClick={() => void onAction(request.id, "accept")}>Aceptar servicio</button>}
          {request.state === "accepted" && <button disabled={busy} type="button" className={journeyButton} onClick={() => void onAction(request.id, "board")}>Confirmar abordaje seguro</button>}
          {request.state === "onboard" && <button disabled={busy} type="button" className={journeyButton} onClick={() => void onAction(request.id, "complete")}>Finalizar viaje</button>}
        </div>
      </article>;
    })}
  </div>;
}
