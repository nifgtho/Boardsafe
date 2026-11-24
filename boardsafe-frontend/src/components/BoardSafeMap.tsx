"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import {
  RefreshCw,
  MapPin,
  Layers,
  Satellite,
  Map as MapIcon,
  Search,
  X,
} from "lucide-react";
import { apiRequest, BoardSafeError } from "@/lib/api";
import type { BayStatus, StopRecord } from "@/types/boardsafe";

interface BoardSafeMapProps {
  token: string;
  onSelectPoint?: (lat: number, lon: number, suggestedName?: string) => void;
  onSelectStop?: (stop: StopRecord) => void;
  refreshTrigger?: number;
}

interface SearchHit {
  id: string;
  title: string;
  subtitle: string;
  lat: number;
  lon: number;
  kind: "stop" | "place";
  stop?: StopRecord;
}

const MAPTILER_KEY = process.env.NEXT_PUBLIC_MAPTILER_KEY?.trim();

function buildMapStyle(): maplibregl.StyleSpecification {
  if (MAPTILER_KEY) {
    return {
      version: 8,
      sources: {
        "map-streets": {
          type: "raster",
          tiles: [
            `https://api.maptiler.com/maps/streets-v2/256/{z}/{x}/{y}@2x.png?key=${MAPTILER_KEY}`,
          ],
          tileSize: 256,
          maxzoom: 20,
          attribution:
            '&copy; <a href="https://www.maptiler.com/copyright/">MapTiler</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        },
        "map-satellite": {
          type: "raster",
          tiles: [
            `https://api.maptiler.com/maps/hybrid/256/{z}/{x}/{y}@2x.png?key=${MAPTILER_KEY}`,
          ],
          tileSize: 256,
          maxzoom: 20,
          attribution:
            '&copy; <a href="https://www.maptiler.com/copyright/">MapTiler</a> &copy; OpenStreetMap contributors',
        },
      },
      layers: [
        {
          id: "base-streets",
          type: "raster",
          source: "map-streets",
          layout: { visibility: "visible" },
        },
        {
          id: "base-satellite",
          type: "raster",
          source: "map-satellite",
          layout: { visibility: "none" },
        },
      ],
    };
  }

  // Respaldo temporal si aún no se agrega NEXT_PUBLIC_MAPTILER_KEY
  return {
    version: 8,
    sources: {
      "map-streets": {
        type: "raster",
        tiles: [
          "https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}",
        ],
        tileSize: 256,
        maxzoom: 19,
        attribution: "Tiles &copy; Esri &mdash; &copy; OpenStreetMap contributors",
      },
      "map-satellite": {
        type: "raster",
        tiles: [
          "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
        ],
        tileSize: 256,
        maxzoom: 19,
        attribution: "Tiles &copy; Esri, Maxar",
      },
    },
    layers: [
      {
        id: "base-streets",
        type: "raster",
        source: "map-streets",
        layout: { visibility: "visible" },
      },
      {
        id: "base-satellite",
        type: "raster",
        source: "map-satellite",
        layout: { visibility: "none" },
      },
    ],
  };
}

const EMPTY_FC: GeoJSON.FeatureCollection = {
  type: "FeatureCollection",
  features: [],
};

const BAY_COLORS: Record<BayStatus, { bg: string; label: string }> = {
  clear: { bg: "#0d9488", label: "Bahía despejada" },
  blocked: { bg: "#e11d48", label: "Bahía bloqueada" },
  unknown: { bg: "#d97706", label: "Sin verificar" },
};

function createStopElement(stop: StopRecord): HTMLButtonElement {
  const color = BAY_COLORS[stop.bay_effective_status] ?? BAY_COLORS.unknown;
  const btn = document.createElement("button");
  btn.type = "button";
  btn.setAttribute("aria-label", `Paradero ${stop.name} (${stop.code})`);
  btn.title = `${stop.name} (${stop.code}) — ${color.label}`;
  btn.style.cssText = `
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 4px 8px;
    border-radius: 9999px;
    background: ${color.bg};
    color: #ffffff;
    border: 2px solid #ffffff;
    box-shadow: 0 3px 10px rgba(0,0,0,0.45);
    font-size: 11px;
    font-weight: 700;
    cursor: pointer;
    white-space: nowrap;
  `;

  const dot = document.createElement("span");
  dot.textContent = stop.wheelchair_accessible ? "♿" : "🚏";
  const text = document.createElement("span");
  text.textContent = stop.code;

  btn.appendChild(dot);
  btn.appendChild(text);
  return btn;
}

function createStopPopupDom(
  stop: StopRecord,
  onSelect?: (s: StopRecord) => void
): HTMLDivElement {
  const color = BAY_COLORS[stop.bay_effective_status] ?? BAY_COLORS.unknown;
  const wrap = document.createElement("div");
  wrap.style.cssText = "min-width: 190px; color: #0f172a; font-family: system-ui, sans-serif;";

  const title = document.createElement("div");
  title.style.cssText = "font-weight: 700; font-size: 13px;";
  title.textContent = stop.name;

  const code = document.createElement("div");
  code.style.cssText = "font-size: 11px; color: #475569; margin-top: 2px;";
  code.textContent = `Código: ${stop.code} · ${
    stop.wheelchair_accessible ? "Accesible ♿" : "Acceso limitado"
  }`;

  const badge = document.createElement("div");
  badge.style.cssText = `
    display: inline-block;
    margin-top: 6px;
    padding: 2px 8px;
    border-radius: 9999px;
    font-size: 11px;
    font-weight: 600;
    color: #ffffff;
    background: ${color.bg};
  `;
  badge.textContent = color.label;

  wrap.appendChild(title);
  wrap.appendChild(code);
  wrap.appendChild(badge);

  if (onSelect) {
    const actionBtn = document.createElement("button");
    actionBtn.type = "button";
    actionBtn.textContent = "Usar este paradero";
    actionBtn.style.cssText = `
      display: block;
      width: 100%;
      margin-top: 8px;
      padding: 6px 10px;
      border-radius: 8px;
      border: none;
      background: #0f172a;
      color: #ffffff;
      font-size: 11px;
      font-weight: 600;
      cursor: pointer;
    `;
    actionBtn.addEventListener("click", () => onSelect(stop));
    wrap.appendChild(actionBtn);
  }

  return wrap;
}

export function BoardSafeMap({
  token,
  onSelectPoint,
  onSelectStop,
  refreshTrigger = 0,
}: BoardSafeMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const pickMarkerRef = useRef<maplibregl.Marker | null>(null);
  const stopMarkersRef = useRef<maplibregl.Marker[]>([]);
  const loadedRef = useRef(false);

  const onSelectPointRef = useRef(onSelectPoint);
  const onSelectStopRef = useRef(onSelectStop);
  onSelectPointRef.current = onSelectPoint;
  onSelectStopRef.current = onSelectStop;

  const [stops, setStops] = useState<StopRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [featureCount, setFeatureCount] = useState(0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [picked, setPicked] = useState<{ lat: number; lon: number } | null>(null);
  const [basemap, setBasemap] = useState<"streets" | "satellite">("streets");

  // Buscador de lugares y paraderos
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [hits, setHits] = useState<SearchHit[]>([]);

  const renderStopMarkers = useCallback((stopList: StopRecord[]) => {
    const map = mapRef.current;
    if (!map) return;

    stopMarkersRef.current.forEach((m) => m.remove());
    stopMarkersRef.current = [];

    for (const stop of stopList) {
      const el = createStopElement(stop);
      const popup = new maplibregl.Popup({ offset: 18 }).setDOMContent(
        createStopPopupDom(stop, (selected) => {
          onSelectStopRef.current?.(selected);
        })
      );

      const marker = new maplibregl.Marker({ element: el, anchor: "center" })
        .setLngLat([stop.lon, stop.lat])
        .setPopup(popup)
        .addTo(map);

      el.addEventListener("click", (ev) => {
        // Evita que el clic sobre un paradero mueva el pin de "nuevo punto"
        ev.stopPropagation();
        onSelectStopRef.current?.(stop);
      });

      stopMarkersRef.current.push(marker);
    }
  }, []);

  const loadFeatures = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setErrorMsg(null);
    try {
      const [geojsonRes, stopsRes] = await Promise.allSettled([
        apiRequest<GeoJSON.FeatureCollection>("/map/features", { token }),
        apiRequest<StopRecord[]>("/stops", { token }),
      ]);

      const stopsList = stopsRes.status === "fulfilled" ? stopsRes.value : [];
      setStops(stopsList);
      renderStopMarkers(stopsList);

      const geojson =
        geojsonRes.status === "fulfilled" &&
        geojsonRes.value?.type === "FeatureCollection"
          ? geojsonRes.value
          : EMPTY_FC;

      setFeatureCount(Math.max(geojson.features.length, stopsList.length));

      const map = mapRef.current;
      if (map && loadedRef.current) {
        const src = map.getSource("boardsafe") as maplibregl.GeoJSONSource | undefined;
        if (src) src.setData(geojson);
      }
    } catch (err) {
      setErrorMsg(
        err instanceof BoardSafeError
          ? err.message
          : "No se pudieron cargar las capas del mapa."
      );
    } finally {
      setLoading(false);
    }
  }, [token, renderStopMarkers]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: buildMapStyle(),
      center: [-76.2422, -9.9306], // Huánuco [lon, lat]
      zoom: 14.5,
      attributionControl: { compact: false },
    });

    map.addControl(new maplibregl.NavigationControl(), "top-right");

    map.on("load", () => {
      loadedRef.current = true;

      map.addSource("boardsafe", {
        type: "geojson",
        data: EMPTY_FC,
      });

      // Zonas de riesgo
      map.addLayer({
        id: "boardsafe-risk-zones",
        type: "circle",
        source: "boardsafe",
        filter: ["==", ["get", "kind"], "risk_zone"],
        paint: {
          "circle-radius": 20,
          "circle-color": "#f59e0b",
          "circle-opacity": 0.35,
          "circle-stroke-width": 2,
          "circle-stroke-color": "#d97706",
        },
      });

      // Restricciones viales confirmadas (LineString)
      map.addLayer({
        id: "boardsafe-restrictions",
        type: "line",
        source: "boardsafe",
        filter: ["==", ["get", "kind"], "road_restriction"],
        paint: {
          "line-color": "#ef4444",
          "line-width": 5,
          "line-opacity": 0.9,
        },
      });

      // Vehículos (los paraderos ya se pintan como marcadores clickeables con ícono)
      map.addLayer({
        id: "boardsafe-vehicles",
        type: "circle",
        source: "boardsafe",
        filter: ["==", ["get", "kind"], "vehicle"],
        paint: {
          "circle-radius": 8,
          "circle-color": "#2563eb",
          "circle-stroke-width": 2.5,
          "circle-stroke-color": "#ffffff",
        },
      });

      loadFeatures();
    });

    map.on("click", (e) => {
      const lat = Number(e.lngLat.lat.toFixed(6));
      const lon = Number(e.lngLat.lng.toFixed(6));
      setPicked({ lat, lon });
      onSelectPointRef.current?.(lat, lon);

      if (pickMarkerRef.current) {
        pickMarkerRef.current.setLngLat([lon, lat]);
      } else {
        pickMarkerRef.current = new maplibregl.Marker({ color: "#0f766e" })
          .setLngLat([lon, lat])
          .addTo(map);
      }
    });

    mapRef.current = map;

    return () => {
      loadedRef.current = false;
      stopMarkersRef.current.forEach((m) => m.remove());
      stopMarkersRef.current = [];
      pickMarkerRef.current?.remove();
      pickMarkerRef.current = null;
      map.remove();
      mapRef.current = null;
    };
  }, [loadFeatures]);

  useEffect(() => {
    if (loadedRef.current) {
      loadFeatures();
    }
  }, [refreshTrigger, loadFeatures]);

  function toggleBasemap() {
    const map = mapRef.current;
    if (!map || !loadedRef.current) return;
    const next = basemap === "streets" ? "satellite" : "streets";
    map.setLayoutProperty(
      "base-streets",
      "visibility",
      next === "streets" ? "visible" : "none"
    );
    map.setLayoutProperty(
      "base-satellite",
      "visibility",
      next === "satellite" ? "visible" : "none"
    );
    setBasemap(next);
  }

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    const q = query.trim();
    if (!q) {
      setHits([]);
      return;
    }

    setSearching(true);
    const results: SearchHit[] = [];

    // 1. Buscar primero en los paraderos ya registrados en BoardSafe
    const qLower = q.toLowerCase();
    for (const s of stops) {
      if (
        s.name.toLowerCase().includes(qLower) ||
        s.code.toLowerCase().includes(qLower)
      ) {
        results.push({
          id: `stop-${s.id}`,
          title: `${s.name} (${s.code})`,
          subtitle: "Paradero registrado en BoardSafe",
          lat: s.lat,
          lon: s.lon,
          kind: "stop",
          stop: s,
        });
      }
    }

    // 2. Buscar calles, plazas y comercios reales cerca del mapa (Photon OSM)
    try {
      const center = mapRef.current?.getCenter() ?? { lat: -9.9306, lng: -76.2422 };
      const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&lat=${center.lat}&lon=${center.lng}&limit=5`;
      const resp = await fetch(url);
      if (resp.ok) {
        const data = (await resp.json()) as {
          features?: Array<{
            geometry: { coordinates: [number, number] };
            properties: {
              name?: string;
              street?: string;
              city?: string;
              state?: string;
              osm_value?: string;
            };
          }>;
        };
        for (const [idx, f] of (data.features ?? []).entries()) {
          const [lon, lat] = f.geometry.coordinates;
          const p = f.properties;
          const title = p.name || p.street || q;
          const subtitle = [p.street, p.city, p.state].filter(Boolean).join(", ");
          results.push({
            id: `place-${idx}-${lon}-${lat}`,
            title,
            subtitle: subtitle || "Ubicación en mapa",
            lat: Number(lat.toFixed(6)),
            lon: Number(lon.toFixed(6)),
            kind: "place",
          });
        }
      }
    } catch {
      // Si falla la red externa, igual mostramos los paraderos locales
    } finally {
      setHits(results);
      setSearching(false);
    }
  }

  function pickSearchResult(hit: SearchHit) {
    const map = mapRef.current;
    if (map) {
      map.flyTo({ center: [hit.lon, hit.lat], zoom: 16.5, duration: 900 });
    }

    if (hit.kind === "stop" && hit.stop) {
      onSelectStopRef.current?.(hit.stop);
    } else {
      setPicked({ lat: hit.lat, lon: hit.lon });
      onSelectPointRef.current?.(hit.lat, hit.lon, hit.title);

      if (map) {
        if (pickMarkerRef.current) {
          pickMarkerRef.current.setLngLat([hit.lon, hit.lat]);
        } else {
          pickMarkerRef.current = new maplibregl.Marker({ color: "#0f766e" })
            .setLngLat([hit.lon, hit.lat])
            .addTo(map);
        }
      }
    }
    setHits([]);
  }

  return (
    <section
      aria-label="Mapa operativo BoardSafe"
      className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900 shadow-xl"
    >
      {/* Cabecera */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 px-4 py-3">
        <div className="flex items-center gap-2">
          <Layers className="h-4 w-4 text-teal-400" aria-hidden="true" />
          <h2 className="text-sm font-semibold text-white">Mapa interactivo</h2>
          <span className="rounded-full bg-slate-800 px-2.5 py-0.5 text-xs text-slate-300">
            {featureCount} elementos
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {picked && (
            <span className="inline-flex items-center gap-1 rounded-lg bg-slate-950 px-2.5 py-1 font-mono text-xs text-teal-300">
              <MapPin className="h-3.5 w-3.5" aria-hidden="true" />
              {picked.lat}, {picked.lon}
            </span>
          )}

          <button
            type="button"
            onClick={toggleBasemap}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-slate-700"
          >
            {basemap === "streets" ? (
              <>
                <Satellite className="h-3.5 w-3.5 text-teal-400" /> Satélite
              </>
            ) : (
              <>
                <MapIcon className="h-3.5 w-3.5 text-teal-400" /> Calles HD
              </>
            )}
          </button>

          <button
            type="button"
            onClick={loadFeatures}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-700 disabled:opacity-60"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            Actualizar
          </button>
        </div>
      </div>

      {/* Buscador de lugares y paraderos */}
      <div className="relative border-b border-slate-800 bg-slate-950/70 px-4 py-2.5">
        <form onSubmit={handleSearch} className="flex gap-2">
          <div className="relative flex-1">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
              aria-hidden="true"
            />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar calle, plaza, hospital o paradero (ej. Plaza de Armas Huánuco)..."
              aria-label="Buscar lugar o paradero en el mapa"
              className="w-full rounded-lg border border-slate-700 bg-slate-900 py-1.5 pl-9 pr-8 text-xs text-white placeholder-slate-400 focus:border-teal-400 focus:outline-none"
            />
            {query && (
              <button
                type="button"
                onClick={() => {
                  setQuery("");
                  setHits([]);
                }}
                aria-label="Limpiar búsqueda"
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          <button
            type="submit"
            disabled={searching}
            className="rounded-lg bg-teal-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-teal-500 disabled:opacity-60"
          >
            {searching ? "Buscando..." : "Buscar"}
          </button>
        </form>

        {hits.length > 0 && (
          <ul className="absolute left-4 right-4 top-12 z-30 max-h-56 overflow-y-auto rounded-xl border border-slate-700 bg-slate-900 shadow-2xl">
            {hits.map((h) => (
              <li key={h.id} className="border-b border-slate-800 last:border-none">
                <button
                  type="button"
                  onClick={() => pickSearchResult(h)}
                  className="flex w-full items-start justify-between gap-2 px-3 py-2 text-left hover:bg-slate-800"
                >
                  <div>
                    <p className="text-xs font-semibold text-white">{h.title}</p>
                    <p className="text-[11px] text-slate-400">{h.subtitle}</p>
                  </div>
                  <span
                    className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                      h.kind === "stop"
                        ? "bg-teal-500/20 text-teal-300"
                        : "bg-slate-800 text-slate-300"
                    }`}
                  >
                    {h.kind === "stop" ? "Paradero" : "Lugar"}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {!MAPTILER_KEY && (
        <div className="bg-slate-800/80 px-4 py-1.5 text-[11px] text-amber-200">
          Modo respaldo activo. Agrega{" "}
          <code className="font-mono text-white">NEXT_PUBLIC_MAPTILER_KEY</code> en{" "}
          <code className="font-mono text-white">.env.local</code> para ver calles HD con
          íconos y comercios.
        </div>
      )}

      {errorMsg && (
        <div role="alert" className="bg-amber-950/60 px-4 py-2 text-xs text-amber-200">
          {errorMsg}
        </div>
      )}

      <div ref={containerRef} className="h-[460px] w-full" />

      <div className="flex flex-wrap items-center gap-4 border-t border-slate-800 bg-slate-950/70 px-4 py-2.5 text-xs text-slate-300">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-teal-600" /> Bahía despejada
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-amber-600" /> Sin verificar
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-rose-600" /> Bloqueada
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-blue-600" /> Vehículos
        </span>
        <span className="ml-auto text-slate-400">
          Clic en un paradero para usarlo · Clic en el mapa para fijar punto.
        </span>
      </div>
    </section>
  );
}