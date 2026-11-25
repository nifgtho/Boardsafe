"use client";

import { useCallback, useState } from "react";
import { ApiError } from "@/components/ApiError";
import { buttonClass } from "@/components/controls";
import { usePollingResource } from "@/hooks/usePollingResource";
import { useApiAction } from "@/hooks/useApiAction";
import { apiRequest } from "@/lib/api";
import { parseApiUtcDate } from "@/lib/dates";
import type { RainReadingRecord, ResourceRecommendations, ResponseAssetRecord, RiskAssessmentRecord, RiskZoneRecord, UserRole } from "@/types/boardsafe";
import { ZoneForm } from "./ZoneForm";
import { ResourcePanel } from "./ResourcePanel";

export function RiskPanel({ token, role, refreshTrigger, pickedCoords, onDataChanged }: { token: string; role: UserRole; refreshTrigger: number; pickedCoords: { lat: number; lon: number } | null; onDataChanged: () => void }) {
  const canInspect = ["inspector", "authority", "admin"].includes(role);
  const canManage = ["authority", "admin"].includes(role);
  const load = useCallback(async (signal: AbortSignal) => {
    const [zones, assessments, assets, weather] = await Promise.all([
      apiRequest<RiskZoneRecord[]>("/risk/zones", { token, signal }),
      apiRequest<RiskAssessmentRecord[]>("/risk/assessments", { token, signal }),
      apiRequest<ResponseAssetRecord[]>("/resources", { token, signal }),
      apiRequest<RainReadingRecord[]>("/weather/readings", { token, signal }),
    ]);
    return { zones, assessments, assets, weather };
  }, [token]);
  const { data, error, loading, refresh } = usePollingResource(load, refreshTrigger, 30000);
  const changed = () => { refresh(); onDataChanged(); };
  const action = useApiAction(token, changed);
  const [recommendations, setRecommendations] = useState<ResourceRecommendations | null>(null);
  return <section aria-label="Riesgo y recursos" className="space-y-4 rounded-2xl border border-slate-700 bg-slate-900 p-5">
    <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-bold">Riesgo y recursos</h2><button className={buttonClass} disabled={loading || action.busy} onClick={refresh}>Actualizar riesgo y recursos</button></div>
    <p className="rounded-lg bg-amber-950 p-3 text-sm text-amber-100">risk-v1 es un índice heurístico de prioridad de inspección. No es una probabilidad de deslizamiento ni una alerta oficial.</p>
    <ApiError error={error} /><ApiError error={action.error} />
    {action.feedback && <p role="status" className="text-sm text-teal-200">{action.feedback}</p>}
    {canInspect && <ZoneForm busy={action.busy} pickedCoords={pickedCoords} onCreate={async (body) => !!await action.run("/risk/zones", body, "Zona registrada con su fuente y versión.")} />}
    {data?.zones.map((zone) => <article key={zone.id} className="space-y-3 rounded-lg border border-slate-700 bg-slate-950 p-3">
      <h3 className="font-semibold">{zone.name}</h3><p className="text-sm text-slate-300">Fuente: {zone.source} · {zone.source_version} · Radio {zone.radius_m} m · Susceptibilidad {zone.susceptibility}/5</p>
      {canInspect && <div className="flex flex-wrap gap-2">
        <button className={buttonClass} disabled={action.busy} onClick={() => action.run(`/risk/zones/${zone.id}/assess`, undefined, "Evaluación heurística registrada con observaciones disponibles.")}>Evaluar prioridad observada</button>
        <button className={buttonClass} disabled={action.busy} onClick={() => action.run(`/risk/zones/${zone.id}/refresh-forecast`, undefined, "Pronóstico importado. No constituye una observación ni una alerta oficial.")}>Actualizar pronóstico autorizado</button>
        <button className={buttonClass} disabled={action.busy} onClick={() => action.run(`/risk/zones/${zone.id}/outlook`, undefined, "Perspectiva basada en pronóstico registrada; requiere revisión humana.")}>Evaluar perspectiva de pronóstico</button>
        <button className={buttonClass} disabled={action.busy} onClick={async () => {
          const result = await action.run<ResourceRecommendations>(`/resources/recommend/${zone.id}`, undefined, "Candidatos sin ruta ni disponibilidad de campo verificada.", "GET");
          if (result) setRecommendations(result);
        }}>Consultar recursos candidatos</button>
      </div>}
      <details><summary className="cursor-pointer text-sm">Historial de evaluaciones de zona</summary><ol className="mt-2 max-h-72 space-y-3 overflow-auto">
        {data.assessments.filter((a) => a.zone_id === zone.id).map((assessment) => <li key={assessment.id} className="text-sm"><p className="font-semibold">{assessment.rule_version === "outlook-v1" ? "Perspectiva de pronóstico" : "Prioridad con observaciones"} · Índice {assessment.score} · {assessment.category}</p><time dateTime={assessment.evaluated_at}>{parseApiUtcDate(assessment.evaluated_at).toLocaleString()}</time><ul className="list-disc pl-5">{assessment.reasons.map((reason, i) => <li key={i}>{reason}</li>)}</ul></li>)}
        {!data.assessments.some((a) => a.zone_id === zone.id) && <li className="text-sm">Sin evaluaciones registradas.</li>}
      </ol></details>
    </article>)}
    {data && !data.zones.length && <p className="text-sm">No hay zonas registradas.</p>}
    {recommendations && <aside className="rounded-lg border border-amber-700 p-3 text-sm" aria-label="Recursos candidatos"><p className="font-semibold">Candidatos para {data?.zones.find((z) => z.id === recommendations.zone_id)?.name ?? recommendations.zone_id}</p><p>{recommendations.warning}</p><ul className="mt-2 list-disc pl-5">{recommendations.options.map((option) => <li key={option.asset_id}>{option.code}: distancia recta {option.distance_straight_m} m; no es tiempo de respuesta.</li>)}</ul>{!recommendations.options.length && <p>Sin candidatos disponibles.</p>}</aside>}
    <ResourcePanel assets={data?.assets ?? []} zones={data?.zones ?? []} canManage={canManage} busy={action.busy}
      onCreate={async (body) => !!await action.run("/resources", body, "Recurso registrado.")}
      onDecide={async (id, body) => !!await action.run(`/resources/${id}/decision`, body, "Decisión firmada. Requiere ejecución y comprobación de campo.")} />
    <details><summary className="cursor-pointer font-semibold">Datos meteorológicos ({data?.weather.length ?? 0} recientes)</summary><ul className="mt-2 max-h-64 space-y-2 overflow-auto text-sm">{data?.weather.map((reading) => <li key={reading.id} className="rounded-lg bg-slate-950 p-2"><strong>{reading.kind === "forecast" ? "Pronóstico" : "Observación"}</strong>: {reading.mm} mm / {reading.period_hours} h · {reading.source} · {reading.source_ref}<br /><time dateTime={reading.observed_at}>{parseApiUtcDate(reading.observed_at).toLocaleString()}</time></li>)}</ul></details>
  </section>;
}
