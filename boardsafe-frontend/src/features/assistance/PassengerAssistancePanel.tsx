"use client";

import { useEffect, useState, useCallback } from "react";
import {
  Accessibility,
  Volume2,
  VolumeX,
  RefreshCw,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  ShieldAlert,
  MapPin,
  Navigation,
} from "lucide-react";
import { apiRequest, BoardSafeError } from "@/lib/api";
import type {
  AssistanceRecord,
  AssistanceStatus,
  StopRecord,
  SupportOption,
} from "@/types/boardsafe";

interface PassengerAssistancePanelProps {
  token: string;
  pickedCoords: {
    lat: number;
    lon: number;
    suggestedName?: string;
  } | null;
  selectedStopId?: string | null;
}

interface UiError {
  message: string;
  reasons: string[];
  hint: string;
}

const SUPPORT_CHOICES: { value: SupportOption; label: string; desc: string }[] = [
  {
    value: "ramp",
    label: "Rampa de acceso",
    desc: "Despliegue de rampa y plaza accesible",
  },
  {
    value: "audio",
    label: "Guía por audio",
    desc: "Avisos verbales de llegada y abordaje",
  },
  {
    value: "text",
    label: "Indicaciones en texto",
    desc: "Mensajes claros de alto contraste",
  },
  {
    value: "boarding_help",
    label: "Apoyo de abordaje",
    desc: "Acompañamiento del conductor al subir",
  },
];

const SUPPORT_LABELS: Record<SupportOption, string> = {
  ramp: "Rampa",
  audio: "Guía por audio",
  text: "Texto claro",
  boarding_help: "Apoyo al abordar",
};

const BAY_STATUS_LABEL: Record<string, string> = {
  clear: "bahía despejada",
  blocked: "bahía bloqueada",
  unknown: "bahía sin verificar",
};

const COC_STEPS: { key: AssistanceStatus; label: string }[] = [
  { key: "requested", label: "Solicitada" },
  { key: "offered", label: "Asignada" },
  { key: "accepted", label: "Confirmada" },
  { key: "onboard", label: "A bordo" },
  { key: "completed", label: "Completada" },
];

const STATUS_UI: Record<
  AssistanceStatus,
  { label: string; badge: string; message: string; stepIndex: number }
> = {
  requested: {
    label: "Solicitada",
    badge: "bg-sky-500/20 text-sky-300 border-sky-500/30",
    message:
      "Tu solicitud fue registrada. El centro de control está buscando una unidad accesible con ruta verificada.",
    stepIndex: 0,
  },
  offered: {
    label: "Unidad asignada (por confirmar)",
    badge: "bg-indigo-500/20 text-indigo-300 border-indigo-500/30",
    message:
      "El operador asignó un vehículo accesible; esperando confirmación del conductor.",
    stepIndex: 1,
  },
  accepted: {
    label: "Confirmada por conductor",
    badge: "bg-teal-500/20 text-teal-300 border-teal-500/30",
    message:
      "El conductor confirmó plaza accesible y rampa operativa para tu abordaje.",
    stepIndex: 2,
  },
  onboard: {
    label: "A bordo",
    badge: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",
    message:
      "Abordaje confirmado. Al llegar a tu destino puedes marcar el viaje como completado.",
    stepIndex: 3,
  },
  completed: {
    label: "Viaje completado",
    badge: "bg-slate-700/60 text-slate-200 border-slate-600",
    message: "El servicio finalizó correctamente.",
    stepIndex: 4,
  },
  waiting_safe: {
    label: "En espera segura (vía cerrada)",
    badge: "bg-amber-500/20 text-amber-200 border-amber-500/40",
    message:
      "Una autoridad confirmó una restricción en la ruta. Permanece en zona segura mientras el operador verifica una alternativa oficial. No se mostrará hora de llegada hasta validar un desvío seguro.",
    stepIndex: -1,
  },
  interrupted: {
    label: "Trayecto interrumpido (a bordo)",
    badge: "bg-rose-500/20 text-rose-200 border-rose-500/40",
    message:
      "La ruta activa fue revocada por cierre oficial. El centro de control está coordinando una ruta alternativa verificada o trasbordo seguro.",
    stepIndex: -1,
  },
  cancelled: {
    label: "Cancelada",
    badge: "bg-slate-800 text-slate-400 border-slate-700",
    message: "Solicitud cancelada por el pasajero.",
    stepIndex: -1,
  },
  expired: {
    label: "Expirada",
    badge: "bg-slate-800 text-slate-400 border-slate-700",
    message:
      "La solicitud venció sin confirmación. Puedes registrar una nueva cuando gustes.",
    stepIndex: -1,
  },
  unable_to_serve: {
    label: "Sin cobertura verificada",
    badge: "bg-amber-900/40 text-amber-200 border-amber-600/40",
    message:
      "No fue posible asignar una unidad accesible verificada en este momento. Contacta al centro de control para coordinar alternativa humana.",
    stepIndex: -1,
  },
};

export function PassengerAssistancePanel({
  token,
  pickedCoords,
  selectedStopId = null,
}: PassengerAssistancePanelProps) {
  const [stops, setStops] = useState<StopRecord[]>([]);
  const [requests, setRequests] = useState<AssistanceRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [busyActionId, setBusyActionId] = useState<string | null>(null);
  const [speakingId, setSpeakingId] = useState<string | null>(null);

  const [error, setError] = useState<UiError | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  // Campos exactos de AssistanceIn
  const [stopId, setStopId] = useState(selectedStopId ?? "");
  const [destLat, setDestLat] = useState(pickedCoords ? String(pickedCoords.lat) : "");
  const [destLon, setDestLon] = useState(pickedCoords ? String(pickedCoords.lon) : "");
  const [destLabel, setDestLabel] = useState<string | null>(pickedCoords?.suggestedName ?? null);
  const [support, setSupport] = useState<SupportOption[]>(["ramp"]);
  const [consent, setConsent] = useState(false);

  const [previousCoords, setPreviousCoords] = useState(pickedCoords);
  if (pickedCoords !== previousCoords) {
    setPreviousCoords(pickedCoords);
    if (pickedCoords) {
      setDestLat(String(pickedCoords.lat));
      setDestLon(String(pickedCoords.lon));
      setDestLabel(pickedCoords.suggestedName ?? null);
    }
  }

  // Sincroniza cuando el pasajero hace clic directamente en un paradero del mapa
  const [previousStopId, setPreviousStopId] = useState(selectedStopId);
  if (selectedStopId !== previousStopId) {
    setPreviousStopId(selectedStopId);
    if (selectedStopId) setStopId(selectedStopId);
  }

  // Detiene síntesis de voz al desmontar
  useEffect(() => {
    return () => {
      if (typeof window !== "undefined" && "speechSynthesis" in window) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  const loadData = useCallback(() => {
    return Promise.all([
      apiRequest<StopRecord[]>("/stops", { token }),
      apiRequest<AssistanceRecord[]>("/assistance", { token }),
    ]).then(([stopsData, reqData]) => {
      setError(null);
      setStops(stopsData);
      setRequests(reqData);
      setStopId((prev) => prev || stopsData[0]?.id || "");
    }).catch((err: unknown) => {
      if (err instanceof BoardSafeError) {
        setError({
          message: err.message,
          reasons: err.reasons,
          hint: err.actionHint,
        });
      } else {
        setError({
          message: "No se pudieron cargar tus datos de asistencia.",
          reasons: [],
          hint: "Verifica tu conexión e intenta recargar.",
        });
      }
    }).finally(() => {
      setLoading(false);
    });
  }, [token]);

  useEffect(() => {
    loadData();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void loadData();
    }, 10000);
    return () => window.clearInterval(timer);
  }, [loadData]);

  function toggleSupport(opt: SupportOption) {
    setSupport((prev) =>
      prev.includes(opt) ? prev.filter((item) => item !== opt) : [...prev, opt]
    );
  }

  function handleSpeakToggle(req: AssistanceRecord) {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;

    if (speakingId === req.id) {
      window.speechSynthesis.cancel();
      setSpeakingId(null);
      return;
    }

    const ui = STATUS_UI[req.state] ?? STATUS_UI.requested;
    const stopLabel = stopById.get(req.stop_id)?.name ?? "paradero seleccionado";
    const utterance = new SpeechSynthesisUtterance(
      `Solicitud en ${stopLabel}. Estado: ${ui.label}. ${ui.message}`
    );
    utterance.lang = "es-PE";
    utterance.onend = () => setSpeakingId(null);
    utterance.onerror = () => setSpeakingId(null);

    window.speechSynthesis.cancel();
    setSpeakingId(req.id);
    window.speechSynthesis.speak(utterance);
  }

  async function handleCreateRequest(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setFeedback(null);

    if (!stopId) {
      setError({
        message: "Selecciona un paradero de origen.",
        reasons: ["Puedes elegirlo en la lista o haciendo clic sobre su ícono en el mapa."],
        hint: "Si no hay paraderos aún, el operador debe registrarlos primero.",
      });
      return;
    }

    const lat = Number(destLat);
    const lon = Number(destLon);
    if (!destLat.trim() || !destLon.trim() || !Number.isFinite(lat) || !Number.isFinite(lon)) {
      setError({
        message: "Faltan coordenadas de destino válidas.",
        reasons: ["Haz clic en el mapa o usa el buscador superior para fijar tu destino."],
        hint: "Latitud entre -90 y 90; longitud entre -180 y 180.",
      });
      return;
    }

    if (support.length === 0) {
      setError({
        message: "Selecciona al menos un apoyo operativo.",
        reasons: ["Elige entre rampa, guía por audio, indicaciones en texto o apoyo de abordaje."],
        hint: "Nunca se te pedirá diagnóstico médico.",
      });
      return;
    }

    setSubmitting(true);
    try {
      await apiRequest("/assistance", {
        method: "POST",
        token,
        body: {
          stop_id: stopId,
          destination_lat: lat,
          destination_lon: lon,
          support,
          consent_operational: consent,
        },
      });
      setFeedback(
        "Solicitud enviada. Solo el personal autorizado verá los apoyos operativos requeridos."
      );
      setConsent(false);
      await loadData();
    } catch (err) {
      if (err instanceof BoardSafeError) {
        setError({
          message: err.message,
          reasons: err.reasons,
          hint: err.actionHint,
        });
      } else {
        setError({
          message: "No se pudo registrar la solicitud.",
          reasons: [],
          hint: "Revisa los campos e intenta nuevamente.",
        });
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function handleAction(id: string, action: "cancel" | "complete") {
    setError(null);
    setFeedback(null);
    setBusyActionId(id);
    try {
      await apiRequest(`/assistance/${id}/${action}`, {
        method: "POST",
        token,
      });
      setFeedback(
        action === "cancel"
          ? "Solicitud cancelada correctamente."
          : "Viaje marcado como completado. ¡Buen destino!"
      );
      await loadData();
    } catch (err) {
      if (err instanceof BoardSafeError) {
        setError({
          message: err.message,
          reasons: err.reasons,
          hint: err.actionHint,
        });
      } else {
        setError({
          message: "No se pudo actualizar la solicitud.",
          reasons: [],
          hint: "Recarga el estado e intenta nuevamente.",
        });
      }
    } finally {
      setBusyActionId(null);
    }
  }

  const stopById = new Map(stops.map((s) => [s.id, s]));

  const selectedStop = stopId ? stopById.get(stopId) : undefined;

  return (
    <section
      aria-label="Asistencia accesible para pasajero"
      className="space-y-5 rounded-2xl border border-slate-800 bg-slate-900 p-5 shadow-xl"
    >
      {/* Cabecera */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-teal-600/20 text-teal-400">
            <Accessibility className="h-5 w-5" aria-hidden="true" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-white">
              Solicitar asistencia de abordaje
            </h2>
            <p className="text-xs text-slate-400">
              Privacidad garantizada: sin diagnósticos ni ubicación pública.
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => { setLoading(true); void loadData(); }}
          disabled={loading}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-xs font-medium text-white transition hover:bg-slate-700 disabled:opacity-60"
        >
          <RefreshCw
            className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`}
            aria-hidden="true"
          />
          Actualizar
        </button>
      </div>

      {/* Feedback y errores */}
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
              {error.reasons.map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ul>
          )}
          {error.hint && (
            <p className="mt-1.5 pl-6 text-[11px] text-amber-200/80">{error.hint}</p>
          )}
        </div>
      )}

      {/* Formulario AssistanceIn */}
      <form
        onSubmit={handleCreateRequest}
        className="space-y-4 rounded-xl border border-slate-800 bg-slate-950/70 p-4"
      >
        {/* 1. Paradero de origen */}
        <div>
          <label
            htmlFor="origin-stop"
            className="flex items-center justify-between text-xs font-medium text-slate-200"
          >
            <span>1. Paradero de origen</span>
            <span className="text-[11px] font-normal text-slate-400">
              o haz clic en un paradero del mapa
            </span>
          </label>
          <select
            id="origin-stop"
            required
            value={stopId}
            onChange={(e) => setStopId(e.target.value)}
            className="mt-1.5 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-white focus:border-teal-400 focus:outline-none"
          >
            {stops.length === 0 ? (
              <option value="">No hay paraderos cargados todavía</option>
            ) : (
              stops.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.code}) —{" "}
                  {BAY_STATUS_LABEL[s.bay_effective_status] ?? s.bay_effective_status}
                </option>
              ))
            )}
          </select>

          {selectedStop && selectedStop.bay_effective_status === "blocked" && (
            <p className="mt-1.5 flex items-center gap-1.5 text-[11px] text-amber-300">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              Esta bahía figura bloqueada ahora; el operador deberá verificarla antes del
              abordaje.
            </p>
          )}
        </div>

        {/* 2. Destino */}
        <div>
          <div className="flex flex-wrap items-center justify-between gap-1">
            <span className="text-xs font-medium text-slate-200">
              2. Destino (busca o haz clic en el mapa)
            </span>
            {destLabel && (
              <span className="inline-flex items-center gap-1 rounded-md bg-teal-500/15 px-2 py-0.5 text-[11px] text-teal-300">
                <MapPin className="h-3 w-3" aria-hidden="true" />
                {destLabel}
              </span>
            )}
          </div>
          <div className="mt-1.5 grid gap-2 sm:grid-cols-2">
            <div>
              <label htmlFor="dest-lat" className="sr-only">
                Latitud de destino
              </label>
              <input
                id="dest-lat"
                type="number"
                step="any"
                min={-90}
                max={90}
                required
                value={destLat}
                onChange={(e) => {
                  setDestLat(e.target.value);
                  setDestLabel(null);
                }}
                placeholder="Latitud destino"
                className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 font-mono text-xs text-white placeholder-slate-500 focus:border-teal-400 focus:outline-none"
              />
            </div>
            <div>
              <label htmlFor="dest-lon" className="sr-only">
                Longitud de destino
              </label>
              <input
                id="dest-lon"
                type="number"
                step="any"
                min={-180}
                max={180}
                required
                value={destLon}
                onChange={(e) => {
                  setDestLon(e.target.value);
                  setDestLabel(null);
                }}
                placeholder="Longitud destino"
                className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 font-mono text-xs text-white placeholder-slate-500 focus:border-teal-400 focus:outline-none"
              />
            </div>
          </div>
        </div>

        {/* 3. Apoyos operativos */}
        <fieldset>
          <legend className="text-xs font-medium text-slate-200">
            3. Apoyos operativos necesarios (elige 1 o más)
          </legend>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {SUPPORT_CHOICES.map((opt) => {
              const checked = support.includes(opt.value);
              return (
                <label
                  key={opt.value}
                  className={`flex cursor-pointer items-start gap-2.5 rounded-xl border p-2.5 text-xs transition ${
                    checked
                      ? "border-teal-500 bg-teal-950/50 text-white"
                      : "border-slate-800 bg-slate-900 text-slate-300 hover:border-slate-700"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleSupport(opt.value)}
                    className="mt-0.5 h-4 w-4 rounded accent-teal-500"
                  />
                  <span>
                    <strong className="block">{opt.label}</strong>
                    <span className="text-[11px] text-slate-400">{opt.desc}</span>
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>

        {/* 4. Consentimiento operativo explícito */}
        <label className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-slate-800 bg-slate-900/70 p-3 text-xs text-slate-200">
          <input
            type="checkbox"
            required
            checked={consent}
            onChange={(e) => setConsent(e.target.checked)}
            className="mt-0.5 h-4 w-4 rounded accent-teal-500"
          />
          <span>
            Autorizo compartir estos apoyos operativos únicamente con el operador y
            conductor asignados para coordinar mi abordaje.
          </span>
        </label>

        <button
          type="submit"
          disabled={submitting || stops.length === 0}
          className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-teal-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-teal-500 disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-400"
        >
          <Navigation className="h-4 w-4" aria-hidden="true" />
          {submitting ? "Enviando solicitud..." : "Solicitar asistencia accesible"}
        </button>
      </form>

      {/* Lista de solicitudes del pasajero */}
      <div className="space-y-3">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
          Mis solicitudes ({requests.length})
        </h3>

        {requests.length === 0 ? (
          <p className="rounded-xl border border-dashed border-slate-800 p-4 text-center text-xs text-slate-400">
            Aún no tienes solicitudes registradas.
          </p>
        ) : (
          <div className="max-h-[420px] space-y-3 overflow-y-auto pr-1">
            {requests.map((req) => {
              const ui = STATUS_UI[req.state] ?? STATUS_UI.requested;
              const isDisrupted =
                req.state === "waiting_safe" || req.state === "interrupted";
              const canCancel = [
                "requested",
                "offered",
                "accepted",
                "waiting_safe",
              ].includes(req.state);
              const canComplete = req.state === "onboard";
              const stopInfo = stopById.get(req.stop_id);
              const isBusy = busyActionId === req.id;
              const isSpeaking = speakingId === req.id;

              return (
                <article
                  key={req.id}
                  aria-live="polite"
                  className="rounded-xl border border-slate-800 bg-slate-950/70 p-4"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span
                      className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold ${ui.badge}`}
                    >
                      {ui.label}
                    </span>

                    <button
                      type="button"
                      onClick={() => handleSpeakToggle(req)}
                      aria-pressed={isSpeaking}
                      className="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1 text-xs text-slate-200 transition hover:bg-slate-700"
                    >
                      {isSpeaking ? (
                        <>
                          <VolumeX className="h-3.5 w-3.5 text-rose-400" />
                          Detener
                        </>
                      ) : (
                        <>
                          <Volume2 className="h-3.5 w-3.5 text-teal-400" />
                          Escuchar
                        </>
                      )}
                    </button>
                  </div>

                  {/* Progreso visual del ciclo COC (solo estados activos/normales) */}
                  {ui.stepIndex >= 0 && (
                    <ol
                      aria-label="Progreso del servicio"
                      className="mt-3 grid grid-cols-5 gap-1"
                    >
                      {COC_STEPS.map((step, idx) => {
                        const active = idx <= ui.stepIndex;
                        return (
                          <li key={step.key} className="space-y-1">
                            <div
                              className={`h-1.5 rounded-full ${
                                active ? "bg-teal-500" : "bg-slate-800"
                              }`}
                            />
                            <span
                              className={`block truncate text-[10px] ${
                                active ? "font-medium text-teal-300" : "text-slate-500"
                              }`}
                            >
                              {step.label}
                            </span>
                          </li>
                        );
                      })}
                    </ol>
                  )}

                  <div className="mt-3 space-y-1 text-xs text-slate-300">
                    <p>
                      Paradero:{" "}
                      <strong className="text-white">
                        {stopInfo
                          ? `${stopInfo.name} (${stopInfo.code})`
                          : req.stop_id.slice(0, 8)}
                      </strong>
                    </p>
                    <p className="font-mono text-[11px] text-slate-400">
                      Destino: {req.destination_lat.toFixed(5)},{" "}
                      {req.destination_lon.toFixed(5)}
                    </p>
                  </div>

                  {Array.isArray(req.support) && req.support.length > 0 && (
                    <div className="mt-2.5 flex flex-wrap gap-1.5">
                      {req.support.map((s) => (
                        <span
                          key={s}
                          className="rounded-md border border-teal-500/20 bg-teal-950/40 px-2 py-0.5 text-[11px] text-teal-300"
                        >
                          {SUPPORT_LABELS[s] ?? s}
                        </span>
                      ))}
                    </div>
                  )}

                  <p
                    className={`mt-3 rounded-lg p-2.5 text-xs ${
                      isDisrupted
                        ? "border border-amber-500/40 bg-amber-950/50 text-amber-100"
                        : "bg-slate-900 text-slate-300"
                    }`}
                  >
                    {isDisrupted && (
                      <ShieldAlert
                        className="mr-1.5 inline h-4 w-4 text-amber-300"
                        aria-hidden="true"
                      />
                    )}
                    {ui.message}
                  </p>

                  {(canComplete || canCancel) && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {canComplete && (
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => handleAction(req.id, "complete")}
                          className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-emerald-500 disabled:opacity-60"
                        >
                          <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                          {isBusy ? "Procesando..." : "Confirmar llegada"}
                        </button>
                      )}
                      {canCancel && (
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => handleAction(req.id, "cancel")}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-rose-500/40 bg-rose-950/50 px-3 py-1.5 text-xs font-semibold text-rose-200 transition hover:bg-rose-900/60 disabled:opacity-60"
                        >
                          <XCircle className="h-3.5 w-3.5" aria-hidden="true" />
                          {isBusy ? "Procesando..." : "Cancelar solicitud"}
                        </button>
                      )}
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
