"use client";
import { useState } from "react";
import { CoordinateFields, Field } from "@/components/FormControls";
import { buttonClass } from "@/components/controls";

export interface ZoneBody { name: string; lat: number; lon: number; radius_m: number; susceptibility: number; critical_access: boolean; source: string; source_version: string }
export function ZoneForm({ busy, pickedCoords, onCreate }: { busy: boolean; pickedCoords: { lat: number; lon: number } | null; onCreate: (body: ZoneBody) => Promise<boolean> }) {
  const [name, setName] = useState(""); const [lat, setLat] = useState(""); const [lon, setLon] = useState("");
  const [radius, setRadius] = useState("500"); const [susceptibility, setSusceptibility] = useState("0");
  const [critical, setCritical] = useState(false); const [source, setSource] = useState(""); const [version, setVersion] = useState("");
  return <details><summary className="cursor-pointer font-semibold">Registrar zona de inspección</summary>
    <form className="mt-3 space-y-3" onSubmit={async (event) => {
      event.preventDefault(); if (await onCreate({ name, lat: Number(lat), lon: Number(lon), radius_m: Number(radius), susceptibility: Number(susceptibility), critical_access: critical, source, source_version: version })) setName("");
    }}>
      <Field id="zone-name" label="Nombre de zona" required minLength={3} maxLength={150} value={name} onChange={(e) => setName(e.target.value)} />
      {pickedCoords && <button type="button" className={buttonClass} onClick={() => { setLat(String(pickedCoords.lat)); setLon(String(pickedCoords.lon)); }}>Usar punto del mapa para zona</button>}
      <CoordinateFields prefix="zona" lat={lat} lon={lon} onLat={setLat} onLon={setLon} />
      <Field id="zone-radius" label="Radio de zona (metros)" type="number" min={20} max={200000} required value={radius} onChange={(e) => setRadius(e.target.value)} />
      <Field id="zone-susceptibility" label="Susceptibilidad de la fuente (0–5)" type="number" min={0} max={5} required value={susceptibility} onChange={(e) => setSusceptibility(e.target.value)} />
      <Field id="zone-source" label="Fuente verificable de la zona" minLength={3} maxLength={180} required value={source} onChange={(e) => setSource(e.target.value)} />
      <Field id="zone-version" label="Versión de la fuente" minLength={1} maxLength={120} required value={version} onChange={(e) => setVersion(e.target.value)} />
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={critical} onChange={(e) => setCritical(e.target.checked)} />Acceso crítico documentado</label>
      <button className={buttonClass} disabled={busy}>Registrar zona</button>
    </form>
  </details>;
}
