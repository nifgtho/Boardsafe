"use client";

import { useCallback } from "react";
import { apiRequest } from "@/lib/api";
import { parseApiUtcDate } from "@/lib/dates";
import { ApiError } from "@/components/ApiError";
import { buttonClass } from "@/components/controls";
import { usePollingResource } from "@/hooks/usePollingResource";
import type { EventConnection } from "@/hooks/useBoardSafeEvents";
import type { AuditLogRecord, ContinuityMetrics, UserRole } from "@/types/boardsafe";

const CONNECTION_LABELS: Record<EventConnection, string> = {
  inactive: "Sin conexión institucional", connecting: "Conectando eventos", connected: "Eventos conectados",
  reconnecting: "Reconectando y recuperando eventos", unavailable: "Eventos no disponibles; continúa la actualización periódica",
};
export function MonitoringPanel({ token, role, refreshTrigger, connection, lastEventId }: { token: string; role: UserRole; refreshTrigger: number; connection: EventConnection; lastEventId: number | null }) {
  const canAudit = role === "authority" || role === "admin";
  const load = useCallback(async (signal: AbortSignal) => {
    const [metrics, audit] = await Promise.all([
      apiRequest<ContinuityMetrics>("/metrics/continuity", { token, signal }),
      canAudit ? apiRequest<AuditLogRecord[]>("/audit?limit=100", { token, signal }) : Promise.resolve([]),
    ]);
    return { metrics, audit };
  }, [token, canAudit]);
  const { data, error, loading, refresh } = usePollingResource(load, refreshTrigger, 30000);
  return <section aria-label="Continuidad y auditoría" className="space-y-4 rounded-2xl border border-slate-700 bg-slate-900 p-5">
    <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-bold">Continuidad y auditoría</h2><button className={buttonClass} disabled={loading} onClick={refresh}>Actualizar continuidad</button></div>
    <p role="status" className="text-sm text-teal-200">{CONNECTION_LABELS[connection]}{lastEventId !== null && ` · Evento ${lastEventId}`}</p>
    <ApiError error={error} />
    {data && <>
      <dl className="grid grid-cols-2 gap-3 text-sm">
        {[["Solicitudes", data.metrics.requests], ["Completadas", data.metrics.completed], ["Pendientes según metodología", data.metrics.pending], ["Continuidad AJCR", data.metrics.ajcr_percent === null ? "Sin datos" : `${data.metrics.ajcr_percent}%`]].map(([label, value]) => <div key={label} className="rounded-lg bg-slate-950 p-3"><dt>{label}</dt><dd className="text-xl font-bold">{value}</dd></div>)}
      </dl>
      <p className="text-sm text-slate-300">{data.metrics.methodology}</p>
      {canAudit ? <details><summary className="cursor-pointer font-semibold">Acciones auditadas ({data.audit.length} recientes)</summary><ol className="mt-3 max-h-96 space-y-3 overflow-auto">
        {data.audit.map((entry) => <li key={entry.id} className="break-words rounded-lg bg-slate-950 p-3 text-sm">
          <p className="font-semibold">{entry.action}</p><time dateTime={entry.created_at}>{parseApiUtcDate(entry.created_at).toLocaleString()}</time>
          <p>Firma: {entry.actor_id ?? "Sistema / dispositivo"}</p><p>Recurso: {entry.resource_type} · {entry.resource_id}</p>
          {Object.keys(entry.detail).length > 0 && <pre className="mt-2 whitespace-pre-wrap text-xs">{JSON.stringify(entry.detail, null, 2)}</pre>}
        </li>)}
        {!data.audit.length && <li>No hay acciones auditadas.</li>}
      </ol></details> : <p className="text-sm text-slate-300">La auditoría detallada está reservada a autoridad y administración.</p>}
    </>}
  </section>;
}
