import { useEffect, useRef, useState } from "react";
import { apiRequest } from "@/lib/api";
import { searchPlaces, type Destination } from "@/lib/placeSearch";
import type { StopRecord } from "@/types/boardsafe";
import { buttonClass, fieldClass } from "@/components/controls";

interface Props {
  destination: Destination | null;
  onChange: (destination: Destination | null) => void;
}

const normalize = (text: string) => text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();

export function DestinationPicker({ destination, onChange }: Props) {
  const [query, setQuery] = useState("");
  const [stops, setStops] = useState<Destination[]>([]);
  const [stopStatus, setStopStatus] = useState("Cargando paraderos…");
  const [places, setPlaces] = useState<Destination[]>([]);
  const [notice, setNotice] = useState("");
  const search = useRef<AbortController | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    apiRequest<StopRecord[]>("/stops", { signal: controller.signal }).then((rows) => {
      setStops(rows.map((s) => ({ id: s.id, title: s.name, subtitle: `Paradero · ${s.code}`, lat: s.lat, lon: s.lon })));
      setStopStatus("");
    }).catch(() => {
      if (!controller.signal.aborted) setStopStatus("No se pudieron cargar los paraderos. Puedes buscar el lugar por su nombre.");
    });
    return () => { controller.abort(); search.current?.abort(); };
  }, []);

  function resetSearch() {
    search.current?.abort();
    setNotice("");
    setPlaces([]);
  }

  async function lookup() {
    resetSearch();
    const controller = new AbortController();
    search.current = controller;
    setNotice("Buscando lugares…");
    try {
      const found = await searchPlaces(query.trim(), undefined, controller.signal);
      if (controller.signal.aborted) return;
      setPlaces(found);
      setNotice(found.length ? "Elige el destino y comprueba la localidad." : "Sin coincidencias. Prueba con la calle y la ciudad.");
    } catch {
      if (!controller.signal.aborted) setNotice("El buscador no está disponible. Elige un paradero o pide ayuda al personal.");
    }
  }

  const matches = stops.filter((stop) => normalize(stop.title + " " + stop.subtitle).includes(normalize(query))).slice(0, 6);
  return <fieldset className="space-y-3 rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
    <legend className="px-1 text-lg font-bold">¿A dónde te diriges?</legend>
    {destination ? <div className="space-y-3">
      <p role="status">Destino elegido <strong className="block text-teal-300">{destination.title}</strong><span className="block text-sm">{destination.subtitle}</span></p>
      <button type="button" className={buttonClass} onClick={() => onChange(null)}>Cambiar destino</button>
    </div> : <>
      <label htmlFor="kiosk-destination" className="block font-medium">Nombre del paradero, lugar o dirección</label>
      <input id="kiosk-destination" className={fieldClass} type="search" autoComplete="off" maxLength={160}
        placeholder="Por ejemplo, Plaza de Armas de Huánuco" value={query}
        onChange={(event) => { resetSearch(); setQuery(event.target.value); }}
        onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); if (query.trim().length >= 2) void lookup(); } }} />
      <button type="button" className={buttonClass} disabled={query.trim().length < 2} onClick={lookup}>Buscar lugar o dirección</button>
      <p className="text-sm text-slate-300">Elige un paradero de la lista o busca la dirección con Photon / OpenStreetMap.</p>
      <p role="status" className="text-sm text-teal-200">{notice || stopStatus || (matches.length ? "" : "No hay paraderos que coincidan.")}</p>
      <ul className="space-y-2">{[...places, ...matches].map((item) => <li key={item.id}>
        <button type="button" className="w-full rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 text-left hover:border-teal-400"
          onClick={() => { resetSearch(); onChange(item); }}>
          <strong className="block">{item.title}</strong><span className="block text-sm text-slate-300">{item.subtitle}</span>
        </button>
      </li>)}</ul>
    </>}
  </fieldset>;
}
