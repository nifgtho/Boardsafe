"use client";

import { useCallback, useState } from "react";
import { buttonClass } from "@/components/controls";
import { apiRequest } from "@/lib/api";
import { usePollingResource } from "@/hooks/usePollingResource";
import { ApiError } from "@/components/ApiError";
import type { ReportRecord, RoadRestrictionRecord, UserRole } from "@/types/boardsafe";
import { ReportsPanel } from "./ReportsPanel";
import { RoadRestrictionsPanel } from "./RoadRestrictionsPanel";

interface Props {
  token: string; role: UserRole; refreshTrigger: number;
  pickedCoords: { lat: number; lon: number } | null;
  roadPoints: [number, number][]; drawingRoad: boolean;
  onRoadPointsChange: (points: [number, number][]) => void;
  onDrawingRoadChange: (drawing: boolean) => void;
  onDataChanged: () => void;
}

export function ResiliencePanel(props: Props) {
  const { token, role, refreshTrigger, onDataChanged } = props;
  const load = useCallback(async (signal: AbortSignal) => {
    const [reports, roads] = await Promise.all([
      apiRequest<ReportRecord[]>("/reports", { token, signal }),
      apiRequest<RoadRestrictionRecord[]>("/roads/restrictions", { token, signal }),
    ]);
    return { reports, roads };
  }, [token]);
  const { data, error: loadError, loading, refresh } = usePollingResource(load, refreshTrigger);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [feedback, setFeedback] = useState("");
  async function mutate<T>(path: string, body: unknown, method: "POST" | "PATCH" = "POST"): Promise<T | null> {
    setBusy(true); setError(null); setFeedback("");
    try {
      const result = await apiRequest<T>(path, { token, method, body });
      refresh(); onDataChanged(); return result;
    } catch (failure) { setError(failure); refresh(); return null; }
    finally { setBusy(false); }
  }
  return <section aria-label="Reportes y vías" className="space-y-4 rounded-2xl border border-slate-700 bg-slate-900 p-5 text-slate-100">
    <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-bold">Reportes y vías</h2><button type="button" disabled={loading || busy} className={buttonClass} onClick={refresh}>Actualizar reportes y vías</button></div>
    <ApiError error={error} /><ApiError error={loadError} />
    {feedback && <p role="status" className="rounded-lg bg-teal-950 p-3 text-sm text-teal-100">{feedback}</p>}
    <ReportsPanel reports={data?.reports ?? []} busy={busy} pickedCoords={props.pickedCoords}
      canSubmit={["passenger", "driver", "admin"].includes(role)} canReview={["inspector", "authority", "admin"].includes(role)}
      onCreate={async (body) => {
        const result = await mutate<ReportRecord>("/reports", body);
        if (result) setFeedback("Reporte recibido y pendiente de revisión. No se ha cerrado ninguna vía.");
        return result !== null;
      }} onReview={async (id, status, reason) => {
        if (await mutate(`/reports/${id}/review`, { status, reason })) setFeedback("Revisión registrada. Un reporte corroborado tampoco cierra una vía automáticamente.");
      }} />
    <RoadRestrictionsPanel roads={data?.roads ?? []} reports={data?.reports ?? []} busy={busy}
      canManage={["authority", "admin"].includes(role)} points={props.roadPoints} drawing={props.drawingRoad}
      onPointsChange={props.onRoadPointsChange} onDrawingChange={props.onDrawingRoadChange}
      onCreate={async (body) => {
        const result = await mutate<RoadRestrictionRecord & { routes_revoked?: string[] }>("/roads/restrictions", body);
        if (result) setFeedback(`Restricción registrada. Rutas revocadas: ${result.routes_revoked?.length ?? 0}. Los viajes afectados se actualizarán según su estado.`);
        return result !== null;
      }} onChange={async (id, status, confirmation_note) => {
        if (await mutate(`/roads/restrictions/${id}`, { status, confirmation_note }, "PATCH")) setFeedback("Estado vial actualizado. Las rutas revocadas necesitan una nueva verificación antes de reutilizarse.");
      }} />
  </section>;
}
