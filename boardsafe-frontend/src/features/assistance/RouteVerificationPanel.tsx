"use client";

import { useState } from "react";
import type { RoutePlanRecord } from "@/types/boardsafe";
import { journeyButton, journeyField, ROUTE_LABELS, routeState } from "./journeys";

interface Props {
  routes: RoutePlanRecord[];
  canVerify: boolean;
  busy: boolean;
  onPreview: (id: string) => void;
  onVerify: (id: string, note: string, minutes: number) => Promise<void>;
}

function RouteCard({ route, canVerify, busy, onPreview, onVerify }: Omit<Props, "routes"> & { route: RoutePlanRecord }) {
  const [note, setNote] = useState("");
  const [minutes, setMinutes] = useState(60);
  const state = routeState(route);
  return (
    <article className="space-y-3 rounded-xl border border-slate-700 bg-slate-950 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-base font-semibold">Ruta {route.id.slice(0, 8)}</h3>
          <p className={state === "verified" ? "text-sm text-teal-300" : "text-sm text-amber-200"}>{ROUTE_LABELS[state] ?? state}</p>
          <p className="text-sm text-slate-300">{(route.distance_m / 1000).toFixed(2)} km · cálculo vial, sin promesa de llegada</p>
        </div>
        <button type="button" className={journeyButton} onClick={() => onPreview(route.id)}>Ver en mapa</button>
      </div>
      {route.blockers && route.blockers.length > 0 && <p className="text-sm text-rose-200">Cruza {route.blockers.length} restricción(es) confirmada(s).</p>}
      {canVerify && state !== "verified" && <form className="space-y-3 border-t border-slate-700 pt-3" onSubmit={async (event) => {
        event.preventDefault();
        await onVerify(route.id, note, minutes);
      }}>
        <label className="block text-sm" htmlFor={`verify-note-${route.id}`}>Evidencia de inspección
          <textarea id={`verify-note-${route.id}`} required minLength={12} maxLength={1200} value={note} onChange={(event) => setNote(event.target.value)} className={journeyField} />
        </label>
        <label className="block text-sm" htmlFor={`verify-minutes-${route.id}`}>Vigencia en minutos (1 a 1440)
          <input id={`verify-minutes-${route.id}`} type="number" min={1} max={1440} step={1} required value={minutes} onChange={(event) => setMinutes(Number(event.target.value))} className={journeyField} />
        </label>
        <button type="submit" disabled={busy} className={journeyButton}>{state === "expired" ? "Renovar verificación" : "Firmar verificación"}</button>
        <p className="text-sm text-slate-300">Confirma únicamente tras la inspección correspondiente. El servidor comprobará los cierres activos.</p>
      </form>}
    </article>
  );
}

export function RouteVerificationPanel(props: Props) {
  return <div className="space-y-3">
    {props.routes.length === 0 && <p className="rounded-xl border border-slate-700 p-4 text-sm text-slate-300">Aún no hay rutas. Planifica una alternativa desde una solicitud de asistencia.</p>}
    {props.routes.map((route) => <RouteCard key={route.id} {...props} route={route} />)}
  </div>;
}
