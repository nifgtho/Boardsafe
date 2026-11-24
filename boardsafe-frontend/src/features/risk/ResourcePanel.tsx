"use client";
import { useState } from "react";
import { CoordinateFields, Field, SelectField } from "@/components/FormControls";
import { buttonClass, fieldClass } from "@/components/controls";
import type { AssetType, ResponseAssetRecord, RiskZoneRecord } from "@/types/boardsafe";

export interface AssetBody { code: string; asset_type: AssetType; lat: number; lon: number }
export interface DecisionBody { zone_id: string; action: "prepare" | "deploy" | "stand_down"; reason: string }
const STATES: Record<string, string> = { available: "Disponible", prepared: "Preparado", deployed: "Desplegado" };
function DecisionForm({ asset, zones, busy, onDecide }: { asset: ResponseAssetRecord; zones: RiskZoneRecord[]; busy: boolean; onDecide: (id: string, body: DecisionBody) => Promise<boolean> }) {
  const [zone, setZone] = useState(""); const [action, setAction] = useState<DecisionBody["action"]>("prepare"); const [reason, setReason] = useState("");
  const options: DecisionBody["action"][] = asset.state === "available" ? ["prepare"] : asset.state === "prepared" ? ["prepare", "deploy", "stand_down"] : ["stand_down"];
  const effectiveAction = options.includes(action) ? action : options[0];
  return <form className="mt-3 space-y-2" onSubmit={async (e) => { e.preventDefault(); if (await onDecide(asset.id, { zone_id: zone, action: effectiveAction, reason })) setReason(""); }}>
    <SelectField id={`asset-zone-${asset.id}`} label="Zona de la decisión" required value={zone} onChange={(e) => setZone(e.target.value)}><option value="">Seleccionar zona</option>{zones.map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}</SelectField>
    <SelectField id={`asset-action-${asset.id}`} label="Acción del recurso" value={effectiveAction} onChange={(e) => setAction(e.target.value as DecisionBody["action"])}>{options.map((option) => <option key={option} value={option}>{{ prepare: "Preparar", deploy: "Desplegar", stand_down: "Desmovilizar" }[option]}</option>)}</SelectField>
    <label htmlFor={`asset-reason-${asset.id}`} className="block text-sm">Justificación de la decisión<textarea id={`asset-reason-${asset.id}`} required minLength={12} maxLength={1200} value={reason} onChange={(e) => setReason(e.target.value)} className={fieldClass} /></label>
    <button className={buttonClass} disabled={busy || !zone}>Firmar decisión del recurso</button>
  </form>;
}
export function ResourcePanel({ assets, zones, canManage, busy, onCreate, onDecide }: { assets: ResponseAssetRecord[]; zones: RiskZoneRecord[]; canManage: boolean; busy: boolean; onCreate: (body: AssetBody) => Promise<boolean>; onDecide: (id: string, body: DecisionBody) => Promise<boolean> }) {
  const [code, setCode] = useState(""); const [type, setType] = useState<AssetType>("brigade"); const [lat, setLat] = useState(""); const [lon, setLon] = useState("");
  return <div className="space-y-3"><h3 className="font-semibold">Recursos de respuesta</h3>
    <p className="text-sm text-slate-300">Las decisiones requieren ejecución y confirmación de campo; el sistema no moviliza unidades automáticamente.</p>
    {canManage && <details><summary className="cursor-pointer">Registrar recurso</summary><form className="mt-3 space-y-3" onSubmit={async (e) => { e.preventDefault(); if (await onCreate({ code, asset_type: type, lat: Number(lat), lon: Number(lon) })) setCode(""); }}>
      <Field id="asset-code" label="Código del recurso" required minLength={3} maxLength={70} value={code} onChange={(e) => setCode(e.target.value)} />
      <SelectField id="asset-type" label="Tipo de recurso" value={type} onChange={(e) => setType(e.target.value as AssetType)}><option value="brigade">Brigada</option><option value="excavator">Excavadora</option><option value="truck">Camión</option><option value="other">Otro</option></SelectField>
      <CoordinateFields prefix="recurso" lat={lat} lon={lon} onLat={setLat} onLon={setLon} />
      <button className={buttonClass} disabled={busy}>Guardar recurso</button>
    </form></details>}
    {assets.map((asset) => <article key={asset.id} className="rounded-lg border border-slate-700 p-3"><p className="font-semibold">{asset.code} · {STATES[asset.state] ?? asset.state}</p>{canManage && <DecisionForm asset={asset} zones={zones} busy={busy} onDecide={onDecide} />}</article>)}
    {!assets.length && <p className="text-sm">No hay recursos registrados.</p>}
  </div>;
}
