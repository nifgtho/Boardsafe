"use client";

import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import {
  Bus,
  MapPin,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  ShieldCheck,
  Search,
  Clock,
  Copy,
  Check,
  Accessibility,
  Navigation,
} from "lucide-react";
import { apiRequest, BoardSafeError } from "@/lib/api";
import type {
  BayStatus,
  StopRecord,
  UserRole,
  VehicleRecord,
} from "@/types/boardsafe";

interface OperationsPanelProps {
  token: string;
  role: UserRole;
  pickedCoords: {
    lat: number;
    lon: number;
    suggestedName?: string;
  } | null;
  selectedStopId?: string | null;
  onDataChanged: () => void;
}

interface UiError {
  message: string;
  reasons: string[];
  hint: string;
}

type SubmitTask = "stop" | "bay" | "vehicle" | "vehicleStatus" | null;

const BAY_BADGE: Record<BayStatus, { label: string; style: string }> = {
  clear: {
    label: "Bahía despejada",
    style: "bg-teal-500/20 text-teal-300 border-teal-500/30",
  },
  blocked: {
    label: "Bahía bloqueada",
    style: "bg-rose-500/20 text-rose-300 border-rose-500/30",
  },
  unknown: {
    label: "Sin verificar / vencida",
    style: "bg-amber-500/20 text-amber-300 border-amber-500/30",
  },
};

const QUICK_BAY_NOTES: { status: BayStatus; label: string; note: string }[] = [
  {
    status: "clear",
    label: "Despejada",
    note: "Inspección física confirmada: bahía despejada y accesible.",
  },
  {
    status: "blocked",
    label: "Vehículo obstruyendo",
    note: "Bahía bloqueada por vehículo estacionado en zona de abordaje.",
  },
  {
    status: "blocked",
    label: "Obra / escombros",
    note: "Acceso obstruido por material o trabajos en la calzada.",
  },
  {
    status: "unknown",
    label: "Sin visibilidad",
    note: "No es posible confirmar estado físico de la bahía en este momento.",
  },
];

function formatCheckedAt(iso: string | null): string {
  if (!iso) return "Sin verificación registrada";
  const normalized = iso.endsWith("Z") ? iso : `${iso}Z`;
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return "Hora desconocida";
  return date.toLocaleTimeString("es-PE", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function OperationsPanel({
  token,
  role,
  pickedCoords,
  selectedStopId = null,
  onDataChanged,
}: OperationsPanelProps) {
  const canCreateStop = role === "dispatcher" || role === "authority";
  const canVerifyBay = role === "dispatcher" || role === "inspector";
  const canCreateVehicle = role === "dispatcher";
  const canUpdateVehicle = role === "driver" || role === "dispatcher";
  const canSeeVehicles = [
    "dispatcher",
    "driver",
    "inspector",
    "authority",
  ].includes(role);

  const [tab, setTab] = useState<"stops" | "vehicles">(
    role === "driver" ? "vehicles" : "stops"
  );
  const [stops, setStops] = useState<StopRecord[]>([]);
  const [vehicles, setVehicles] = useState<VehicleRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState<SubmitTask>(null);
  const [error, setError] = useState<UiError | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Filtros de búsqueda locales (escalabilidad)
  const [stopFilter, setStopFilter] = useState("");
  const [vehicleFilter, setVehicleFilter] = useState("");

  // Formulario nuevo paradero (StopIn)
  const [stopCode, setStopCode] = useState("");
  const [stopName, setStopName] = useState("");
  const [stopLat, setStopLat] = useState("");
  const [stopLon, setStopLon] = useState("");
  const [wheelchairAccessible, setWheelchairAccessible] = useState(true);

  // Formulario verificación de bahía (StopBay)
  const [bayTargetId, setBayTargetId] = useState<string | null>(null);
  const [bayStatus, setBayStatus] = useState<BayStatus>("clear");
  const [bayNote, setBayNote] = useState(
    "Inspección física confirmada: bahía despejada y accesible."
  );

  // Formulario nuevo vehículo (VehicleIn)
  const [vehCode, setVehCode] = useState("");
  const [vehOperator, setVehOperator] = useState("");
  const [vehSpacesTotal, setVehSpacesTotal] = useState(2);
  const [vehDriverId, setVehDriverId] = useState("");

  // Formulario estado de vehículo (VehicleCheck)
  const [vehStatusTarget, setVehStatusTarget] = useState<VehicleRecord | null>(
    null
  );
  const [vehSpacesFree, setVehSpacesFree] = useState(1);
  const [vehRampOk, setVehRampOk] = useState(true);
  const [vehLat, setVehLat] = useState("");
  const [vehLon, setVehLon] = useState("");

  const stopCardRefs = useRef<Record<string, HTMLDivElement | null>>({});

  // Sincroniza coordenadas y nombre sugerido desde el clic o buscador del mapa
  useEffect(() => {
    if (!pickedCoords) return;

    if (tab === "stops") {
      setStopLat(String(pickedCoords.lat));
      setStopLon(String(pickedCoords.lon));
      if (pickedCoords.suggestedName) {
        setStopName(pickedCoords.suggestedName);
      }
    } else if (tab === "vehicles") {
      setVehLat(String(pickedCoords.lat));
      setVehLon(String(pickedCoords.lon));
    }
  }, [pickedCoords, tab]);

  // Sincroniza cuando el usuario hace clic en un paradero directamente en el mapa
  useEffect(() => {
    if (!selectedStopId) return;
    setTab("stops");
    setStopFilter("");

    if (canVerifyBay) {
      setBayTargetId(selectedStopId);
    }

    const card = stopCardRefs.current[selectedStopId];
    if (card) {
      card.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [selectedStopId, canVerifyBay]);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const stopData = await apiRequest<StopRecord[]>("/stops", { token });
      setStops(stopData);

      if (canSeeVehicles) {
        const vehData = await apiRequest<VehicleRecord[]>("/vehicles", {
          token,
        });
        setVehicles(vehData);
      }
    } catch (err) {
      if (err instanceof BoardSafeError) {
        setError({
          message: err.message,
          reasons: err.reasons,
          hint: err.actionHint,
        });
      } else {
        setError({
          message: "No se pudieron cargar los paraderos y vehículos.",
          reasons: [],
          hint: "Verifica que el backend esté activo e intenta recargar.",
        });
      }
    } finally {
      setLoading(false);
    }
  }, [token, canSeeVehicles]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  function setApiError(err: unknown, fallback: string) {
    if (err instanceof BoardSafeError) {
      setError({
        message: err.message,
        reasons: err.reasons,
        hint: err.actionHint,
      });
    } else {
      setError({
        message: err instanceof Error ? err.message : fallback,
        reasons: [],
        hint: "Revisa los datos ingresados e intenta nuevamente.",
      });
    }
  }

  async function copyUuid(id: string) {
    try {
      await navigator.clipboard.writeText(id);
      setCopiedId(id);
      setTimeout(() => setCopiedId((curr) => (curr === id ? null : curr)), 1800);
    } catch {
      // Ignorar si el navegador restringe portapapeles
    }
  }

  async function handleCreateStop(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setFeedback(null);

    const lat = Number(stopLat);
    const lon = Number(stopLon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      setError({
        message: "Coordenadas inválidas.",
        reasons: ["Selecciona un punto en el mapa o escribe latitud y longitud válidas."],
        hint: "Latitud entre -90 y 90; longitud entre -180 y 180.",
      });
      return;
    }

    setSubmitting("stop");
    try {
      await apiRequest("/stops", {
        method: "POST",
        token,
        body: {
          code: stopCode.trim().toUpperCase(),
          name: stopName.trim(),
          lat,
          lon,
          wheelchair_accessible: wheelchairAccessible,
        },
      });
      setStopCode("");
      setStopName("");
      setFeedback("Paradero registrado y publicado en el mapa.");
      await fetchAll();
      onDataChanged();
    } catch (err) {
      setApiError(err, "No se pudo registrar el paradero.");
    } finally {
      setSubmitting(null);
    }
  }

  async function handleVerifyBay(e: React.FormEvent) {
    e.preventDefault();
    if (!bayTargetId) return;
    setError(null);
    setFeedback(null);

    if (bayNote.trim().length < 8) {
      setError({
        message: "La nota de verificación es demasiado corta.",
        reasons: ["Debe tener al menos 8 caracteres para trazabilidad operativa."],
        hint: "Puedes usar uno de los botones rápidos de nota.",
      });
      return;
    }

    setSubmitting("bay");
    try {
      await apiRequest(`/stops/${bayTargetId}/bay`, {
        method: "PATCH",
        token,
        body: {
          status: bayStatus,
          note: bayNote.trim(),
        },
      });
      setBayTargetId(null);
      setFeedback(
        "Estado de bahía verificado manualmente (vigente por 3 minutos según política COC)."
      );
      await fetchAll();
      onDataChanged();
    } catch (err) {
      setApiError(err, "No se pudo verificar la bahía.");
    } finally {
      setSubmitting(null);
    }
  }

  async function handleCreateVehicle(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setFeedback(null);
    setSubmitting("vehicle");
    try {
      await apiRequest("/vehicles", {
        method: "POST",
        token,
        body: {
          code: vehCode.trim().toUpperCase(),
          operator_name: vehOperator.trim(),
          driver_id: vehDriverId.trim() ? vehDriverId.trim() : null,
          accessible_spaces_total: Number(vehSpacesTotal),
        },
      });
      setVehCode("");
      setVehOperator("");
      setVehDriverId("");
      setFeedback(
        "Vehículo registrado. Confirma sus plazas, rampa y ubicación para activarlo en el mapa."
      );
      await fetchAll();
      onDataChanged();
    } catch (err) {
      setApiError(err, "No se pudo registrar el vehículo.");
    } finally {
      setSubmitting(null);
    }
  }

  async function handleUpdateVehicleStatus(e: React.FormEvent) {
    e.preventDefault();
    if (!vehStatusTarget) return;
    setError(null);
    setFeedback(null);

    if (vehSpacesFree > vehStatusTarget.accessible_spaces_total) {
      setError({
        message: "Las plazas libres superan la capacidad instalada.",
        reasons: [
          `Capacidad máxima del vehículo ${vehStatusTarget.code}: ${vehStatusTarget.accessible_spaces_total}.`,
        ],
        hint: "Ajusta el número de plazas libres e intenta nuevamente.",
      });
      return;
    }

    const hasLat = vehLat.trim() !== "";
    const hasLon = vehLon.trim() !== "";
    if (hasLat !== hasLon) {
      setError({
        message: "Coordenadas incompletas.",
        reasons: ["Ingresa tanto latitud como longitud, o deja ambos campos vacíos."],
        hint: "Haz clic en el mapa para llenar ambas coordenadas juntas.",
      });
      return;
    }

    setSubmitting("vehicleStatus");
    try {
      await apiRequest(`/vehicles/${vehStatusTarget.id}/status`, {
        method: "PATCH",
        token,
        body: {
          accessible_spaces_free: Number(vehSpacesFree),
          ramp_ok: vehRampOk,
          at_lat: hasLat ? Number(vehLat) : null,
          at_lon: hasLon ? Number(vehLon) : null,
        },
      });
      setVehStatusTarget(null);
      setFeedback(
        "Capacidad accesible, rampa y ubicación del vehículo confirmadas (vigentes por 3 min)."
      );
      await fetchAll();
      onDataChanged();
    } catch (err) {
      setApiError(err, "No se pudo actualizar el estado del vehículo.");
    } finally {
      setSubmitting(null);
    }
  }

  // Métricas rápidas y listas filtradas
  const metrics = useMemo(() => {
    const clearStops = stops.filter((s) => s.bay_effective_status === "clear").length;
    const freshVehicles = vehicles.filter((v) => v.state_fresh).length;
    return { clearStops, freshVehicles };
  }, [stops, vehicles]);

  const filteredStops = useMemo(() => {
    const q = stopFilter.trim().toLowerCase();
    if (!q) return stops;
    return stops.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        s.code.toLowerCase().includes(q)
    );
  }, [stops, stopFilter]);

  const filteredVehicles = useMemo(() => {
    const q = vehicleFilter.trim().toLowerCase();
    if (!q) return vehicles;
    return vehicles.filter(
      (v) =>
        v.code.toLowerCase().includes(q) ||
        v.operator_name.toLowerCase().includes(q)
    );
  }, [vehicles, vehicleFilter]);

  return (
    <section
      aria-label="Operación de transporte"
      className="space-y-4 rounded-2xl border border-slate-800 bg-slate-900 p-5 shadow-xl"
    >
      {/* Cabecera y tabs */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div
          role="tablist"
          aria-label="Módulos de operación"
          className="flex gap-1.5 rounded-xl bg-slate-950 p-1"
        >
          <button
            type="button"
            role="tab"
            aria-selected={tab === "stops"}
            onClick={() => setTab("stops")}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
              tab === "stops"
                ? "bg-teal-600 text-white"
                : "text-slate-300 hover:text-white"
            }`}
          >
            <MapPin className="h-3.5 w-3.5" aria-hidden="true" />
            Paraderos ({stops.length})
          </button>

          {canSeeVehicles && (
            <button
              type="button"
              role="tab"
              aria-selected={tab === "vehicles"}
              onClick={() => setTab("vehicles")}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                tab === "vehicles"
                  ? "bg-teal-600 text-white"
                  : "text-slate-300 hover:text-white"
              }`}
            >
              <Bus className="h-3.5 w-3.5" aria-hidden="true" />
              Vehículos ({vehicles.length})
            </button>
          )}
        </div>

        <button
          type="button"
          onClick={fetchAll}
          disabled={loading}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-xs font-medium text-slate-200 transition hover:bg-slate-700 disabled:opacity-60"
        >
          <RefreshCw
            className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`}
            aria-hidden="true"
          />
          Recargar
        </button>
      </div>

      {/* Mini resumen operativo */}
      <div className="grid grid-cols-2 gap-2.5 text-xs">
        <div className="rounded-xl border border-slate-800 bg-slate-950/60 px-3 py-2">
          <p className="text-[11px] text-slate-400">Bahías despejadas</p>
          <p className="mt-0.5 text-sm font-bold text-teal-300">
            {metrics.clearStops}{" "}
            <span className="text-xs font-normal text-slate-400">
              de {stops.length}
            </span>
          </p>
        </div>
        {canSeeVehicles && (
          <div className="rounded-xl border border-slate-800 bg-slate-950/60 px-3 py-2">
            <p className="text-[11px] text-slate-400">Unidades vigentes</p>
            <p className="mt-0.5 text-sm font-bold text-blue-300">
              {metrics.freshVehicles}{" "}
              <span className="text-xs font-normal text-slate-400">
                de {vehicles.length}
              </span>
            </p>
          </div>
        )}
      </div>

      {/* Feedback y errores accesibles */}
      {feedback && (
        <div
          role="status"
          aria-live="polite"
          className="flex items-center gap-2 rounded-xl border border-teal-500/40 bg-teal-950/60 p-3 text-xs text-teal-200"
        >
          <CheckCircle2 className="h-4 w-4 shrink-0 text-teal-400" aria-hidden="true" />
          <span>{feedback}</span>
        </div>
      )}

      {error && (
        <div
          role="alert"
          className="rounded-xl border border-amber-500/40 bg-amber-950/50 p-3 text-xs text-amber-100"
        >
          <div className="flex items-start gap-2 font-semibold text-amber-300">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{error.message}</span>
          </div>
          {error.reasons.length > 0 && (
            <ul className="mt-1.5 list-disc space-y-0.5 pl-6 text-[11px] text-amber-200">
              {error.reasons.map((r, idx) => (
                <li key={idx}>{r}</li>
              ))}
            </ul>
          )}
          {error.hint && (
            <p className="mt-1.5 pl-6 text-[11px] text-amber-200/80">{error.hint}</p>
          )}
        </div>
      )}

      {/* ===================== TAB PARADEROS ===================== */}
      {tab === "stops" && (
        <div className="space-y-4">
          {canCreateStop && (
            <form
              onSubmit={handleCreateStop}
              autoComplete="off"
              className="space-y-3 rounded-xl border border-slate-800 bg-slate-950/70 p-4"
            >
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-teal-300">
                  Nuevo paradero
                </h3>
                <span className="text-[11px] text-slate-400">
                  Clic o busca en el mapa para llenar datos
                </span>
              </div>

              <div className="grid gap-2.5 sm:grid-cols-2">
                <div>
                  <label
                    htmlFor="stop-code"
                    className="mb-1 block text-[11px] font-medium text-slate-300"
                  >
                    Código
                  </label>
                  <input
                    id="stop-code"
                    type="text"
                    required
                    minLength={2}
                    maxLength={80}
                    value={stopCode}
                    onChange={(e) => setStopCode(e.target.value)}
                    placeholder={`PAR-${String(stops.length + 1).padStart(2, "0")}`}
                    className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-white placeholder-slate-500 focus:border-teal-400 focus:outline-none"
                  />
                </div>

                <div>
                  <label
                    htmlFor="stop-name"
                    className="mb-1 block text-[11px] font-medium text-slate-300"
                  >
                    Nombre del paradero
                  </label>
                  <input
                    id="stop-name"
                    type="text"
                    required
                    minLength={2}
                    maxLength={200}
                    value={stopName}
                    onChange={(e) => setStopName(e.target.value)}
                    placeholder="Ej. Plaza de Armas"
                    className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-white placeholder-slate-500 focus:border-teal-400 focus:outline-none"
                  />
                </div>
              </div>

              <div className="grid gap-2.5 sm:grid-cols-2">
                <div>
                  <label
                    htmlFor="stop-lat"
                    className="mb-1 block text-[11px] font-medium text-slate-300"
                  >
                    Latitud
                  </label>
                  <input
                    id="stop-lat"
                    type="number"
                    step="any"
                    min={-90}
                    max={90}
                    required
                    value={stopLat}
                    onChange={(e) => setStopLat(e.target.value)}
                    placeholder="-9.930600"
                    className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 font-mono text-xs text-white placeholder-slate-500 focus:border-teal-400 focus:outline-none"
                  />
                </div>

                <div>
                  <label
                    htmlFor="stop-lon"
                    className="mb-1 block text-[11px] font-medium text-slate-300"
                  >
                    Longitud
                  </label>
                  <input
                    id="stop-lon"
                    type="number"
                    step="any"
                    min={-180}
                    max={180}
                    required
                    value={stopLon}
                    onChange={(e) => setStopLon(e.target.value)}
                    placeholder="-76.242200"
                    className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 font-mono text-xs text-white placeholder-slate-500 focus:border-teal-400 focus:outline-none"
                  />
                </div>
              </div>

              <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-200">
                <input
                  type="checkbox"
                  checked={wheelchairAccessible}
                  onChange={(e) => setWheelchairAccessible(e.target.checked)}
                  className="h-4 w-4 rounded accent-teal-500"
                />
                <Accessibility className="h-3.5 w-3.5 text-teal-400" aria-hidden="true" />
                Paradero con acceso para silla de ruedas
              </label>

              <button
                type="submit"
                disabled={submitting === "stop"}
                className="w-full rounded-lg bg-teal-600 px-3 py-2 text-xs font-semibold text-white transition hover:bg-teal-500 disabled:opacity-60"
              >
                {submitting === "stop" ? "Guardando paradero..." : "Crear paradero"}
              </button>
            </form>
          )}

          {/* Filtro rápido de paraderos */}
          {stops.length > 3 && (
            <div className="relative">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400"
                aria-hidden="true"
              />
              <input
                type="text"
                value={stopFilter}
                onChange={(e) => setStopFilter(e.target.value)}
                placeholder="Filtrar paraderos por nombre o código..."
                aria-label="Filtrar paraderos"
                className="w-full rounded-lg border border-slate-800 bg-slate-950 py-1.5 pl-8 pr-3 text-xs text-white placeholder-slate-500 focus:border-teal-400 focus:outline-none"
              />
            </div>
          )}

          {/* Lista de paraderos */}
          <div className="max-h-[380px] space-y-2.5 overflow-y-auto pr-1">
            {filteredStops.length === 0 ? (
              <p className="rounded-xl border border-dashed border-slate-800 p-4 text-center text-xs text-slate-400">
                {stops.length === 0
                  ? "Aún no hay paraderos registrados. Haz clic o busca en el mapa y crea el primero."
                  : "Ningún paradero coincide con tu búsqueda."}
              </p>
            ) : (
              filteredStops.map((s) => {
                const badge = BAY_BADGE[s.bay_effective_status] ?? BAY_BADGE.unknown;
                const isEditing = bayTargetId === s.id;
                const isSelected = selectedStopId === s.id;

                return (
                  <div
                    key={s.id}
                    ref={(el) => {
                      stopCardRefs.current[s.id] = el;
                    }}
                    className={`rounded-xl border p-3.5 transition ${
                      isSelected
                        ? "border-teal-400 bg-teal-950/25 ring-1 ring-teal-500/40"
                        : "border-slate-800 bg-slate-950/60"
                    }`}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <p className="text-sm font-semibold text-white">
                          {s.name}{" "}
                          <span className="font-mono text-xs text-teal-300">
                            ({s.code})
                          </span>
                        </p>
                        <p className="mt-0.5 font-mono text-[11px] text-slate-400">
                          {s.lat.toFixed(5)}, {s.lon.toFixed(5)} ·{" "}
                          {s.wheelchair_accessible ? "Accesible ♿" : "Acceso limitado"}
                        </p>
                        <p className="mt-1 inline-flex items-center gap-1 text-[11px] text-slate-400">
                          <Clock className="h-3 w-3" aria-hidden="true" />
                          Última verificación: {formatCheckedAt(s.bay_checked_at)}
                        </p>
                      </div>

                      <div className="flex flex-col items-end gap-1.5">
                        <span
                          className={`rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${badge.style}`}
                        >
                          {badge.label}
                        </span>
                        <button
                          type="button"
                          onClick={() => copyUuid(s.id)}
                          className="inline-flex items-center gap-1 rounded bg-slate-800/80 px-1.5 py-0.5 font-mono text-[10px] text-slate-300 hover:bg-slate-700"
                          title="Copiar ID del paradero"
                        >
                          {copiedId === s.id ? (
                            <>
                              <Check className="h-3 w-3 text-teal-400" /> Copiado
                            </>
                          ) : (
                            <>
                              <Copy className="h-3 w-3" /> {s.id.slice(0, 8)}
                            </>
                          )}
                        </button>
                      </div>
                    </div>

                    {canVerifyBay && (
                      <div className="mt-2.5">
                        {!isEditing ? (
                          <button
                            type="button"
                            onClick={() => {
                              setBayTargetId(s.id);
                              setBayStatus("clear");
                            }}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1 text-xs font-medium text-slate-200 hover:bg-slate-700"
                          >
                            <ShieldCheck className="h-3.5 w-3.5 text-teal-400" />
                            Verificar bahía
                          </button>
                        ) : (
                          <form
                            onSubmit={handleVerifyBay}
                            className="mt-2 space-y-2.5 rounded-lg border border-slate-700 bg-slate-900 p-3"
                          >
                            <div className="flex flex-wrap gap-1.5">
                              {QUICK_BAY_NOTES.map((preset) => (
                                <button
                                  key={preset.label}
                                  type="button"
                                  onClick={() => {
                                    setBayStatus(preset.status);
                                    setBayNote(preset.note);
                                  }}
                                  className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-[11px] text-slate-300 hover:border-teal-500 hover:text-white"
                                >
                                  {preset.label}
                                </button>
                              ))}
                            </div>

                            <div>
                              <label
                                htmlFor={`bay-status-${s.id}`}
                                className="mb-1 block text-[11px] text-slate-300"
                              >
                                Estado físico de la bahía
                              </label>
                              <select
                                id={`bay-status-${s.id}`}
                                value={bayStatus}
                                onChange={(e) => setBayStatus(e.target.value as BayStatus)}
                                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-white"
                              >
                                <option value="clear">clear — Bahía despejada</option>
                                <option value="blocked">blocked — Bahía bloqueada</option>
                                <option value="unknown">unknown — Sin confirmar</option>
                              </select>
                            </div>

                            <div>
                              <label
                                htmlFor={`bay-note-${s.id}`}
                                className="mb-1 block text-[11px] text-slate-300"
                              >
                                Nota de inspección (mín. 8 caracteres)
                              </label>
                              <input
                                id={`bay-note-${s.id}`}
                                type="text"
                                required
                                minLength={8}
                                maxLength={500}
                                value={bayNote}
                                onChange={(e) => setBayNote(e.target.value)}
                                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-white"
                              />
                            </div>

                            <div className="flex gap-2">
                              <button
                                type="submit"
                                disabled={submitting === "bay"}
                                className="rounded-lg bg-teal-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-teal-500 disabled:opacity-60"
                              >
                                {submitting === "bay"
                                  ? "Guardando..."
                                  : "Guardar verificación"}
                              </button>
                              <button
                                type="button"
                                onClick={() => setBayTargetId(null)}
                                className="rounded-lg bg-slate-800 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-700"
                              >
                                Cancelar
                              </button>
                            </div>
                          </form>
                        )}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* ===================== TAB VEHÍCULOS ===================== */}
      {tab === "vehicles" && canSeeVehicles && (
        <div className="space-y-4">
          {canCreateVehicle && (
            <form
              onSubmit={handleCreateVehicle}
              autoComplete="off"
              className="space-y-3 rounded-xl border border-slate-800 bg-slate-950/70 p-4"
            >
              <h3 className="text-xs font-semibold uppercase tracking-wide text-teal-300">
                Registrar vehículo accesible
              </h3>

              <div className="grid gap-2.5 sm:grid-cols-2">
                <div>
                  <label
                    htmlFor="veh-code"
                    className="mb-1 block text-[11px] font-medium text-slate-300"
                  >
                    Placa / Código
                  </label>
                  <input
                    id="veh-code"
                    type="text"
                    required
                    minLength={2}
                    maxLength={80}
                    value={vehCode}
                    onChange={(e) => setVehCode(e.target.value)}
                    placeholder="Ej. BUS-101"
                    className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-white placeholder-slate-500 focus:border-teal-400 focus:outline-none"
                  />
                </div>

                <div>
                  <label
                    htmlFor="veh-operator"
                    className="mb-1 block text-[11px] font-medium text-slate-300"
                  >
                    Operador / Empresa
                  </label>
                  <input
                    id="veh-operator"
                    type="text"
                    required
                    minLength={2}
                    maxLength={160}
                    value={vehOperator}
                    onChange={(e) => setVehOperator(e.target.value)}
                    placeholder="Ej. Transporte Huánuco"
                    className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-white placeholder-slate-500 focus:border-teal-400 focus:outline-none"
                  />
                </div>
              </div>

              <div className="grid gap-2.5 sm:grid-cols-2">
                <div>
                  <label
                    htmlFor="veh-spaces"
                    className="mb-1 block text-[11px] font-medium text-slate-300"
                  >
                    Plazas accesibles totales
                  </label>
                  <input
                    id="veh-spaces"
                    type="number"
                    min={0}
                    max={100}
                    required
                    value={vehSpacesTotal}
                    onChange={(e) => setVehSpacesTotal(Number(e.target.value))}
                    className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-white"
                  />
                </div>

                <div>
                  <label
                    htmlFor="veh-driver"
                    className="mb-1 block text-[11px] font-medium text-slate-300"
                  >
                    UUID del conductor (opcional)
                  </label>
                  <input
                    id="veh-driver"
                    type="text"
                    value={vehDriverId}
                    onChange={(e) => setVehDriverId(e.target.value)}
                    placeholder="Pega UUID del rol driver"
                    className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 font-mono text-xs text-white placeholder-slate-500"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={submitting === "vehicle"}
                className="w-full rounded-lg bg-teal-600 px-3 py-2 text-xs font-semibold text-white transition hover:bg-teal-500 disabled:opacity-60"
              >
                {submitting === "vehicle" ? "Registrando..." : "Registrar vehículo"}
              </button>
            </form>
          )}

          {/* Filtro de vehículos */}
          {vehicles.length > 3 && (
            <div className="relative">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400"
                aria-hidden="true"
              />
              <input
                type="text"
                value={vehicleFilter}
                onChange={(e) => setVehicleFilter(e.target.value)}
                placeholder="Filtrar vehículos por código u operador..."
                aria-label="Filtrar vehículos"
                className="w-full rounded-lg border border-slate-800 bg-slate-950 py-1.5 pl-8 pr-3 text-xs text-white placeholder-slate-500 focus:border-teal-400 focus:outline-none"
              />
            </div>
          )}

          {/* Lista de vehículos */}
          <div className="max-h-[380px] space-y-2.5 overflow-y-auto pr-1">
            {filteredVehicles.length === 0 ? (
              <p className="rounded-xl border border-dashed border-slate-800 p-4 text-center text-xs text-slate-400">
                {role === "driver"
                  ? "No tienes vehículos asignados todavía. Pide al operador que asigne tu UUID."
                  : "Aún no hay vehículos registrados."}
              </p>
            ) : (
              filteredVehicles.map((v) => {
                const isEditing = vehStatusTarget?.id === v.id;
                return (
                  <div
                    key={v.id}
                    className="rounded-xl border border-slate-800 bg-slate-950/60 p-3.5"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <p className="text-sm font-semibold text-white">
                          {v.code}{" "}
                          <span className="text-xs font-normal text-slate-400">
                            · {v.operator_name}
                          </span>
                        </p>
                        <p className="mt-0.5 text-xs text-slate-300">
                          Plazas libres: <strong>{v.accessible_spaces_free}</strong>/
                          {v.accessible_spaces_total} · Rampa:{" "}
                          <strong
                            className={v.ramp_ok ? "text-teal-300" : "text-rose-300"}
                          >
                            {v.ramp_ok ? "Operativa" : "No operativa"}
                          </strong>
                        </p>
                        <p className="mt-1 inline-flex items-center gap-1 text-[11px] text-slate-400">
                          <Clock className="h-3 w-3" aria-hidden="true" />
                          Confirmado: {formatCheckedAt(v.state_checked_at)}
                        </p>
                      </div>

                      <div className="flex flex-col items-end gap-1.5">
                        <span
                          className={`rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${
                            v.state_fresh
                              ? "border-blue-500/30 bg-blue-500/20 text-blue-300"
                              : "border-amber-500/30 bg-amber-500/20 text-amber-300"
                          }`}
                        >
                          {v.state_fresh ? "Estado vigente" : "Requiere confirmación"}
                        </span>
                        <button
                          type="button"
                          onClick={() => copyUuid(v.id)}
                          className="inline-flex items-center gap-1 rounded bg-slate-800/80 px-1.5 py-0.5 font-mono text-[10px] text-slate-300 hover:bg-slate-700"
                          title="Copiar ID del vehículo"
                        >
                          {copiedId === v.id ? (
                            <>
                              <Check className="h-3 w-3 text-teal-400" /> Copiado
                            </>
                          ) : (
                            <>
                              <Copy className="h-3 w-3" /> {v.id.slice(0, 8)}
                            </>
                          )}
                        </button>
                      </div>
                    </div>

                    {canUpdateVehicle && (
                      <div className="mt-2.5">
                        {!isEditing ? (
                          <button
                            type="button"
                            onClick={() => {
                              setVehStatusTarget(v);
                              setVehSpacesFree(v.accessible_spaces_free);
                              setVehRampOk(v.ramp_ok);
                              setVehLat(
                                v.at_lat !== null
                                  ? String(v.at_lat)
                                  : pickedCoords
                                  ? String(pickedCoords.lat)
                                  : ""
                              );
                              setVehLon(
                                v.at_lon !== null
                                  ? String(v.at_lon)
                                  : pickedCoords
                                  ? String(pickedCoords.lon)
                                  : ""
                              );
                            }}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1 text-xs font-medium text-slate-200 hover:bg-slate-700"
                          >
                            <Navigation className="h-3.5 w-3.5 text-blue-400" />
                            Confirmar plazas, rampa y ubicación
                          </button>
                        ) : (
                          <form
                            onSubmit={handleUpdateVehicleStatus}
                            className="mt-2 space-y-2.5 rounded-lg border border-slate-700 bg-slate-900 p-3"
                          >
                            <div className="grid gap-2 sm:grid-cols-2">
                              <div>
                                <label
                                  htmlFor={`veh-free-${v.id}`}
                                  className="mb-1 block text-[11px] text-slate-300"
                                >
                                  Plazas libres (máx. {v.accessible_spaces_total})
                                </label>
                                <input
                                  id={`veh-free-${v.id}`}
                                  type="number"
                                  min={0}
                                  max={v.accessible_spaces_total}
                                  required
                                  value={vehSpacesFree}
                                  onChange={(e) =>
                                    setVehSpacesFree(Number(e.target.value))
                                  }
                                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-white"
                                />
                              </div>

                              <label className="flex cursor-pointer items-center gap-2 pt-4 text-xs text-slate-200">
                                <input
                                  type="checkbox"
                                  checked={vehRampOk}
                                  onChange={(e) => setVehRampOk(e.target.checked)}
                                  className="h-4 w-4 rounded accent-teal-500"
                                />
                                Rampa operativa
                              </label>
                            </div>

                            <p className="text-[11px] text-slate-400">
                              Haz clic en el mapa para actualizar la posición del bus:
                            </p>
                            <div className="grid gap-2 sm:grid-cols-2">
                              <input
                                type="number"
                                step="any"
                                min={-90}
                                max={90}
                                aria-label="Latitud del vehículo"
                                value={vehLat}
                                onChange={(e) => setVehLat(e.target.value)}
                                placeholder="Latitud"
                                className="rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 font-mono text-xs text-white"
                              />
                              <input
                                type="number"
                                step="any"
                                min={-180}
                                max={180}
                                aria-label="Longitud del vehículo"
                                value={vehLon}
                                onChange={(e) => setVehLon(e.target.value)}
                                placeholder="Longitud"
                                className="rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 font-mono text-xs text-white"
                              />
                            </div>

                            <div className="flex gap-2">
                              <button
                                type="submit"
                                disabled={submitting === "vehicleStatus"}
                                className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-500 disabled:opacity-60"
                              >
                                {submitting === "vehicleStatus"
                                  ? "Confirmando..."
                                  : "Confirmar estado"}
                              </button>
                              <button
                                type="button"
                                onClick={() => setVehStatusTarget(null)}
                                className="rounded-lg bg-slate-800 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-700"
                              >
                                Cancelar
                              </button>
                            </div>
                          </form>
                        )}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </section>
  );
}