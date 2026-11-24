"use client";

import { useEffect, useState } from "react";
import { buttonClass, fieldClass } from "@/components/controls";
import { parseApiUtcDate } from "@/lib/dates";
import type { ReportRecord, RestrictionStatus, RoadRestrictionRecord } from "@/types/boardsafe";

export interface RestrictionBody {
  name: string;
  geometry: { type: "LineString"; coordinates: [number, number][] };
  status: "closed" | "restricted";
  confirmation_note: string;
  source_report_id?: string;
  expires_at?: string;
}

function ChangeStatus({ road, busy, onChange }: { road: RoadRestrictionRecord; busy: boolean; onChange: (id: string, status: RestrictionStatus, note: string) => Promise<void> }) {
  const [status, setStatus] = useState<RestrictionStatus>(road.status === "open" ? "closed" : "open");
  const [note, setNote] = useState("");
  return <form className="space-y-2 border-t border-slate-700 pt-3" onSubmit={async (event) => { event.preventDefault(); await onChange(road.id, status, note); }}>
    <label className="block text-sm" htmlFor={`road-status-${road.id}`}>Nuevo estado de la vía
      <select id={`road-status-${road.id}`} className={fieldClass} value={status} onChange={(event) => setStatus(event.target.value as RestrictionStatus)}>
        <option value="open">Abierta</option><option value="restricted">Restringida</option><option value="closed">Cerrada</option>
      </select>
    </label>
    <label className="block text-sm" htmlFor={`road-note-${road.id}`}>Justificación del cambio
      <textarea id={`road-note-${road.id}`} required minLength={12} maxLength={1000} className={fieldClass} value={note} onChange={(event) => setNote(event.target.value)} />
    </label>
    <button type="submit" disabled={busy || status === road.status} className={buttonClass}>Confirmar cambio de vía</button>
  </form>;
}

interface Props {
  roads: RoadRestrictionRecord[];
  reports: ReportRecord[];
  canManage: boolean;
  busy: boolean;
  points: [number, number][];
  drawing: boolean;
  onDrawingChange: (drawing: boolean) => void;
  onPointsChange: (points: [number, number][]) => void;
  onCreate: (body: RestrictionBody) => Promise<boolean>;
  onChange: (id: string, status: RestrictionStatus, note: string) => Promise<void>;
}

export function RoadRestrictionsPanel({ roads, reports, canManage, busy, points, drawing, onDrawingChange, onPointsChange, onCreate, onChange }: Props) {
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const [source, setSource] = useState("");
  const [status, setStatus] = useState<"closed" | "restricted">("closed");
  const [expires, setExpires] = useState("");
  const [pointLat, setPointLat] = useState("");
  const [pointLon, setPointLon] = useState("");
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 10000);
    return () => window.clearInterval(timer);
  }, []);
  return <div className="space-y-4">
    {canManage && <div className="space-y-3 rounded-xl border border-slate-700 p-3">
      <h3 className="font-semibold">Confirmar una restricción vial</h3>
      <p className="text-sm text-slate-300">Dibuja el tramo afectado o añade sus puntos con teclado. Se necesitan al menos dos puntos.</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" aria-pressed={drawing} className={buttonClass} onClick={() => onDrawingChange(!drawing)}>{drawing ? "Terminar dibujo de tramo" : "Dibujar tramo en mapa"}</button>
        <button type="button" disabled={!points.length} className={buttonClass} onClick={() => onPointsChange(points.slice(0, -1))}>Deshacer último punto</button>
        <button type="button" disabled={!points.length} className={buttonClass} onClick={() => onPointsChange([])}>Limpiar tramo</button>
      </div>
      <form className="space-y-2" onSubmit={(event) => {
        event.preventDefault();
        if (pointLat.trim() && pointLon.trim() && points.length < 5000) {
          onPointsChange([...points, [Number(pointLon), Number(pointLat)]]); setPointLat(""); setPointLon("");
        }
      }}>
        <div className="grid grid-cols-2 gap-3">
          <label className="text-sm" htmlFor="road-point-lat">Latitud del punto de vía<input id="road-point-lat" type="number" min={-90} max={90} step="any" required value={pointLat} onChange={(event) => setPointLat(event.target.value)} className={fieldClass} /></label>
          <label className="text-sm" htmlFor="road-point-lon">Longitud del punto de vía<input id="road-point-lon" type="number" min={-180} max={180} step="any" required value={pointLon} onChange={(event) => setPointLon(event.target.value)} className={fieldClass} /></label>
        </div>
        <button type="submit" disabled={points.length >= 5000} className={buttonClass}>Añadir punto al tramo</button>
      </form>
      <p role="status" className="text-sm text-amber-200">Tramo en borrador: {points.length} puntos. Aún no es una restricción confirmada.</p>
      <form className="space-y-3 border-t border-slate-700 pt-3" onSubmit={async (event) => {
        event.preventDefault();
        if (points.length < 2) return;
        const body: RestrictionBody = { name, confirmation_note: note, status, geometry: { type: "LineString", coordinates: points } };
        if (source) body.source_report_id = source;
        if (expires) body.expires_at = new Date(expires).toISOString();
        if (await onCreate(body)) { setName(""); setNote(""); setSource(""); onPointsChange([]); onDrawingChange(false); }
      }}>
        <label className="block text-sm" htmlFor="road-name">Nombre del tramo<input id="road-name" required minLength={3} maxLength={200} value={name} onChange={(event) => setName(event.target.value)} className={fieldClass} /></label>
        <label className="block text-sm" htmlFor="road-create-status">Estado confirmado<select id="road-create-status" value={status} onChange={(event) => setStatus(event.target.value as typeof status)} className={fieldClass}><option value="closed">Cerrada</option><option value="restricted">Restringida</option></select></label>
        <label className="block text-sm" htmlFor="road-source-report">Reporte corroborado de origen (opcional)<select id="road-source-report" value={source} onChange={(event) => setSource(event.target.value)} className={fieldClass}><option value="">Sin reporte asociado</option>{reports.filter((report) => report.status === "verified").map((report) => <option key={report.id} value={report.id}>{report.description.slice(0, 70)}</option>)}</select></label>
        <label className="block text-sm" htmlFor="road-confirmation">Evidencia de confirmación vial<textarea id="road-confirmation" minLength={12} maxLength={1000} required value={note} onChange={(event) => setNote(event.target.value)} className={fieldClass} /></label>
        <label className="block text-sm" htmlFor="road-expires">Vigencia hasta (opcional, hora local)<input id="road-expires" type="datetime-local" value={expires} onChange={(event) => setExpires(event.target.value)} className={fieldClass} /></label>
        <button type="submit" disabled={busy || points.length < 2} className={buttonClass}>Confirmar restricción vial</button>
        <p className="text-sm text-slate-300">Un cierre confirmado puede revocar rutas y detener viajes afectados. Registra la decisión únicamente con autorización.</p>
      </form>
    </div>}
    {roads.length === 0 && <p className="text-sm text-slate-300">No hay restricciones registradas.</p>}
    {roads.map((road) => {
      const expired = road.status !== "open" && road.expires_at && parseApiUtcDate(road.expires_at).getTime() <= now;
      return <article key={road.id} className="space-y-2 rounded-xl border border-slate-700 bg-slate-950 p-3">
        <h3 className="font-semibold">{road.name}</h3>
        <p className="text-sm" aria-live="polite">{expired ? "Vigencia vencida" : { open: "Abierta", closed: "Cerrada", restricted: "Restringida" }[road.status]}</p>
        <p className="text-sm text-slate-300">{road.confirmation_note}</p>
        {canManage && <ChangeStatus road={road} busy={busy} onChange={onChange} />}
      </article>;
    })}
  </div>;
}
