"use client";

import { useCallback, useState } from "react";
import { ApiError } from "@/components/ApiError";
import { Field, SelectField } from "@/components/FormControls";
import { buttonClass } from "@/components/controls";
import { usePollingResource } from "@/hooks/usePollingResource";
import { useApiAction } from "@/hooks/useApiAction";
import { apiRequest } from "@/lib/api";
import type { EdgeNodeRecord, StopRecord, VehicleRecord } from "@/types/boardsafe";

export function EdgeNodesPanel({ token, refreshTrigger, onDataChanged }: { token: string; refreshTrigger: number; onDataChanged: () => void }) {
  const load = useCallback(async (signal: AbortSignal) => {
    const [nodes, stops, vehicles] = await Promise.all([
      apiRequest<EdgeNodeRecord[]>("/edge/nodes", { token, signal }),
      apiRequest<StopRecord[]>("/stops", { token, signal }), apiRequest<VehicleRecord[]>("/vehicles", { token, signal }),
    ]); return { nodes, stops, vehicles };
  }, [token]);
  const { data, error, loading, refresh } = usePollingResource(load, refreshTrigger, 30000);
  const action = useApiAction(token, () => { refresh(); onDataChanged(); });
  const [kind, setKind] = useState<"totem" | "camera">("totem"); const [target, setTarget] = useState<"stop" | "vehicle">("stop");
  const [code, setCode] = useState(""); const [targetId, setTargetId] = useState("");
  const [secret, setSecret] = useState<{ id: string; node_secret: string } | null>(null);
  return <section aria-label="Nodos Edge y tótem" className="space-y-4 rounded-2xl border border-slate-700 bg-slate-900 p-5">
    <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-bold">Nodos Edge y tótem</h2><button className={buttonClass} disabled={loading || action.busy} onClick={refresh}>Actualizar nodos</button></div><ApiError error={error} /><ApiError error={action.error} />
    {action.feedback && <p role="status" className="text-sm text-teal-200">{action.feedback}</p>}
    {secret && <aside className="space-y-2 rounded-lg border border-amber-600 bg-amber-950 p-3 text-sm" aria-label="Secreto del nodo recién creado"><p className="font-bold">Secreto mostrado una sola vez. Guárdalo en el servidor autorizado; no lo compartas por Git ni capturas.</p><p className="break-all">Nodo: {secret.id}</p><label className="block">Secreto privado del nodo<input type="password" readOnly autoComplete="off" value={secret.node_secret} className="mt-1 w-full bg-slate-950 p-2" onFocus={(e) => e.target.select()} /></label><button className={buttonClass} onClick={() => setSecret(null)}>Ya guardé el secreto; ocultar</button></aside>}
    <form autoComplete="off" className="space-y-3" onSubmit={async (e) => {
      e.preventDefault(); if (secret) return;
      const result = await action.run<{ id: string; node_secret: string }>("/edge/nodes", { kind, code, ...(target === "stop" ? { stop_id: targetId } : { vehicle_id: targetId }) }, "Nodo provisionado. Configura su secreto solo en el servidor/dispositivo.");
      if (result) { setSecret(result); setCode(""); }
    }}>
      <Field id="node-code" label="Código del nodo" required minLength={3} maxLength={100} value={code} onChange={(e) => setCode(e.target.value)} />
      <SelectField id="node-kind" label="Tipo de nodo" value={kind} onChange={(e) => { setKind(e.target.value as typeof kind); setTarget("stop"); setTargetId(""); }}><option value="totem">Tótem</option><option value="camera">Cámara (metadatos)</option></SelectField>
      {kind === "camera" && <SelectField id="node-target-kind" label="Asociar cámara a" value={target} onChange={(e) => { setTarget(e.target.value as typeof target); setTargetId(""); }}><option value="stop">Paradero</option><option value="vehicle">Vehículo</option></SelectField>}
      <SelectField id="node-target" label={target === "stop" ? "Paradero del nodo" : "Vehículo del nodo"} value={targetId} required onChange={(e) => setTargetId(e.target.value)}><option value="">Seleccionar</option>{target === "stop" ? data?.stops.map((s) => <option key={s.id} value={s.id}>{s.code} · {s.name}</option>) : data?.vehicles.map((v) => <option key={v.id} value={v.id}>{v.code}</option>)}</SelectField>
      <button className={buttonClass} disabled={action.busy || !!secret || !targetId}>Provisionar nodo</button>
    </form>
    <ul className="space-y-2 text-sm">{data?.nodes.map((node) => <li className="rounded-lg bg-slate-950 p-3" key={node.id}><p className="font-semibold">{node.code} · {node.kind} · {node.enabled ? "Habilitado" : "Deshabilitado"}</p><p className="break-all">{node.id}</p><p>{node.last_seen_at ? `Última lectura: ${node.last_seen_at}` : "Sin lecturas registradas"}</p></li>)}</ul>
  </section>;
}
