"use client";

import { useState } from "react";
import { buttonClass, fieldClass } from "@/components/controls";
import type { ReportKind, ReportRecord } from "@/types/boardsafe";

export const REPORT_KINDS: Record<ReportKind, string> = {
  debris: "Material sobre la vía", landslide: "Deslizamiento", flood: "Inundación",
  rain: "Lluvia", blocked_bay: "Bahía obstruida", accessibility: "Accesibilidad",
  road_damage: "Daño vial", other: "Otro",
};
const STATES = { pending: "Pendiente de revisión", verified: "Corroborado", rejected: "Rechazado" };

export interface ReportBody { kind: ReportKind; description: string; lat: number; lon: number }

function ReviewForm({ report, busy, onReview }: { report: ReportRecord; busy: boolean; onReview: (id: string, status: "verified" | "rejected", reason: string) => Promise<void> }) {
  const [reason, setReason] = useState("");
  const [status, setStatus] = useState<"verified" | "rejected">("verified");
  return <form className="space-y-2 border-t border-slate-700 pt-3" onSubmit={async (event) => {
    event.preventDefault(); await onReview(report.id, status, reason);
  }}>
    <label className="block text-sm" htmlFor={`review-reason-${report.id}`}>Motivo de revisión
      <textarea id={`review-reason-${report.id}`} required minLength={10} maxLength={800} value={reason} onChange={(event) => setReason(event.target.value)} className={fieldClass} />
    </label>
    <label className="block text-sm" htmlFor={`review-status-${report.id}`}>Resultado de revisión
      <select id={`review-status-${report.id}`} value={status} onChange={(event) => setStatus(event.target.value as typeof status)} className={fieldClass}>
        <option value="verified">Corroborado mediante inspección</option><option value="rejected">Rechazado</option>
      </select>
    </label>
    <button type="submit" disabled={busy} className={buttonClass}>Guardar revisión del reporte</button>
  </form>;
}

interface Props {
  reports: ReportRecord[];
  canSubmit: boolean;
  canReview: boolean;
  busy: boolean;
  pickedCoords: { lat: number; lon: number } | null;
  onCreate: (body: ReportBody) => Promise<boolean>;
  onReview: (id: string, status: "verified" | "rejected", reason: string) => Promise<void>;
}

export function ReportsPanel({ reports, canSubmit, canReview, busy, pickedCoords, onCreate, onReview }: Props) {
  const [kind, setKind] = useState<ReportKind>("road_damage");
  const [description, setDescription] = useState("");
  const [lat, setLat] = useState(pickedCoords ? String(pickedCoords.lat) : "");
  const [lon, setLon] = useState(pickedCoords ? String(pickedCoords.lon) : "");
  const [previousPoint, setPreviousPoint] = useState(pickedCoords);
  if (pickedCoords !== previousPoint) {
    setPreviousPoint(pickedCoords);
    if (pickedCoords) { setLat(String(pickedCoords.lat)); setLon(String(pickedCoords.lon)); }
  }
  return <div className="space-y-4">
    <p className="text-sm text-slate-300">Un reporte solicita revisión. Nunca cierra una vía automáticamente.</p>
    {canSubmit && <form className="space-y-3 rounded-xl border border-slate-700 p-3" onSubmit={async (event) => {
      event.preventDefault();
      if (!lat.trim() || !lon.trim()) return;
      if (await onCreate({ kind, description, lat: Number(lat), lon: Number(lon) })) setDescription("");
    }}>
      <label className="block text-sm" htmlFor="report-kind">Tipo de reporte
        <select id="report-kind" value={kind} onChange={(event) => setKind(event.target.value as ReportKind)} className={fieldClass}>
          {Object.entries(REPORT_KINDS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </label>
      <label className="block text-sm" htmlFor="report-description">Descripción del reporte
        <textarea id="report-description" required minLength={10} maxLength={1500} value={description} onChange={(event) => setDescription(event.target.value)} className={fieldClass} />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className="text-sm" htmlFor="report-lat">Latitud del reporte<input id="report-lat" type="number" step="any" min={-90} max={90} required value={lat} onChange={(event) => setLat(event.target.value)} className={fieldClass} /></label>
        <label className="text-sm" htmlFor="report-lon">Longitud del reporte<input id="report-lon" type="number" step="any" min={-180} max={180} required value={lon} onChange={(event) => setLon(event.target.value)} className={fieldClass} /></label>
      </div>
      <p className="text-sm text-slate-300">Puedes seleccionar un punto en el mapa. Describe hechos observables, sin datos personales ni diagnósticos.</p>
      <button type="submit" disabled={busy} className={buttonClass}>Enviar reporte</button>
    </form>}
    {reports.length === 0 && <p className="text-sm text-slate-300">No hay reportes disponibles para tu cuenta.</p>}
    {reports.map((report) => <article key={report.id} className="space-y-2 rounded-xl border border-slate-700 bg-slate-950 p-3">
      <h3 className="font-semibold">{REPORT_KINDS[report.kind]}</h3>
      <p className="text-sm">{report.description}</p>
      <p className="text-sm text-slate-300" aria-live="polite">{STATES[report.status]} · {report.lat}, {report.lon}</p>
      {canReview && report.status === "pending" && <ReviewForm report={report} busy={busy} onReview={onReview} />}
    </article>)}
  </div>;
}
