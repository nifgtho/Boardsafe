"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  ArrowLeft,
  Volume2,
  VolumeX,
  ShieldCheck,
  UserCheck,
  Accessibility,
  FileText,
  Key,
  Copy,
  Check,
  Clock,
  Bus,
  RefreshCw,
  ChevronDown,
  Info,
  CheckCircle2,
} from "lucide-react";
import { ApiError } from "@/components/ApiError";
import { DestinationPicker } from "./DestinationPicker";
import type { Destination } from "@/lib/placeSearch";
import { buttonClass, fieldClass } from "@/components/controls";
import { BoardSafeError } from "@/lib/api";
import { parseApiUtcDate } from "@/lib/dates";
import { JOURNEY_LABELS, SUPPORT_LABELS } from "@/features/assistance/journeys";
import type { KioskReceipt, KioskTracking, SupportOption } from "@/types/boardsafe";

const SUPPORT_ICONS: Record<SupportOption, typeof UserCheck> = {
  boarding_help: UserCheck,
  ramp: Accessibility,
  audio: Volume2,
  text: FileText,
};

const SUPPORT_DESCRIPTIONS: Record<SupportOption, string> = {
  boarding_help: "Acompañamiento del conductor o personal al subir a la unidad.",
  ramp: "Despliegue de rampa accesible para silla de ruedas o movilidad reducida.",
  audio: "Avisos verbales y sonoros al aproximarse y arribar la unidad.",
  text: "Alertas visuales en pantalla con alto contraste e información de viaje.",
};

async function kioskRequest<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api/kiosk/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
      signal,
    });
  } catch (failure) {
    if (signal?.aborted) throw failure;
    throw new Error("No hay conexión con el servicio. Solicita ayuda al personal.");
  }
  let data;
  try {
    data = await response.json();
  } catch {
    throw new BoardSafeError(503, "El servicio no respondió correctamente. Solicita ayuda al personal.");
  }
  if (!response.ok) throw new BoardSafeError(response.status, data.detail ?? "No se pudo completar la operación.");
  return data;
}

interface KioskPanelProps {
  showBackButton?: boolean;
  onBack?: () => void;
}

export function KioskPanel({ showBackButton = true, onBack }: KioskPanelProps) {
  const [destination, setDestination] = useState<Destination | null>(null);
  const [support, setSupport] = useState<SupportOption[]>(["boarding_help"]);
  const [consent, setConsent] = useState(false);
  const [ticket, setTicket] = useState<{ token: string; expires: string } | null>(null);
  const [tracking, setTracking] = useState<KioskTracking | null>(null);
  const [showCode, setShowCode] = useState(false);
  const [resume, setResume] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [message, setMessage] = useState("");
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [copied, setCopied] = useState(false);

  const clear = useCallback((text: string) => {
    setTicket(null);
    setDestination(null);
    setSupport(["boarding_help"]);
    setTracking(null);
    setShowCode(false);
    setResume("");
    setConsent(false);
    setMessage(text);
    window.speechSynthesis?.cancel();
    setIsSpeaking(false);
  }, []);

  const statusText = tracking ? JOURNEY_LABELS[tracking.state] : "Solicitud recibida. Espera indicaciones del personal.";

  useEffect(() => {
    if (!ticket) return;
    const controller = new AbortController();
    let active = false;
    const expires = parseApiUtcDate(ticket.expires).getTime();
    const expiry = window.setTimeout(
      () => clear("El código temporal venció y se borró de esta pantalla. Solicita ayuda al personal."),
      Math.max(0, expires - Date.now())
    );
    const update = async () => {
      if (active || controller.signal.aborted || document.visibilityState !== "visible") return;
      active = true;
      try {
        const result = await kioskRequest<KioskTracking>("tracking", { token: ticket.token }, controller.signal);
        if (!controller.signal.aborted) {
          setTracking(result);
          setError(null);
          if (["completed", "cancelled", "expired", "unable_to_serve"].includes(result.state)) {
            clear(`Estado final: ${JOURNEY_LABELS[result.state]}. Código borrado de esta pantalla.`);
          }
        }
      } catch (failure) {
        if (!controller.signal.aborted) {
          setError(failure);
          if (failure instanceof BoardSafeError && failure.status === 401) {
            clear("Código inválido o vencido. Solicita ayuda al personal.");
          }
        }
      } finally {
        active = false;
      }
    };
    void update();
    const timer = window.setInterval(update, 10000);
    return () => {
      controller.abort();
      clearTimeout(expiry);
      clearInterval(timer);
    };
  }, [ticket, clear]);

  useEffect(() => {
    if (!ticket) return;
    let timer: ReturnType<typeof setTimeout>;
    const reset = () => {
      clearTimeout(timer);
      timer = setTimeout(
        () => clear("Pantalla limpiada por inactividad. Tu solicitud sigue activa; conserva tu código privado."),
        90000
      );
    };
    reset();
    window.addEventListener("pointerdown", reset);
    window.addEventListener("keydown", reset);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("pointerdown", reset);
      window.removeEventListener("keydown", reset);
    };
  }, [ticket, clear]);

  useEffect(() => {
    if (!showCode) return;
    const timer = setTimeout(() => setShowCode(false), 30000);
    return () => clearTimeout(timer);
  }, [showCode]);

  useEffect(() => () => {
    window.speechSynthesis?.cancel();
    setIsSpeaking(false);
  }, []);

  const handleCopyCode = async () => {
    if (!ticket?.token) return;
    try {
      await navigator.clipboard.writeText(ticket.token);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // Fallback si el portapapeles no tiene permiso
    }
  };

  const handleSpeak = () => {
    if (!("speechSynthesis" in window)) {
      setMessage("Audio no disponible en este dispositivo. Solicita apoyo al personal.");
      return;
    }
    window.speechSynthesis.cancel();
    const textToSpeak = ticket
      ? statusText
      : "Asistencia sin cuenta. Elige un paradero o busca un lugar por nombre o dirección. Selecciona los apoyos que necesitas. Solicita ayuda al personal si lo necesitas.";
    const speech = new SpeechSynthesisUtterance(textToSpeak);
    speech.lang = "es-PE";
    speech.onend = () => setIsSpeaking(false);
    speech.onerror = () => setIsSpeaking(false);
    setIsSpeaking(true);
    window.speechSynthesis.speak(speech);
  };

  const handleStopSpeak = () => {
    window.speechSynthesis?.cancel();
    setIsSpeaking(false);
  };

  return (
    <section
      aria-label="Asistencia sin cuenta"
      className="space-y-6 rounded-3xl border-2 border-slate-700 bg-slate-950/95 p-6 sm:p-8 text-lg text-white shadow-2xl backdrop-blur"
    >
      {/* Barra de navegación superior con botón Volver atrás */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800 pb-5">
        {showBackButton && (
          onBack ? (
            <button
              type="button"
              onClick={onBack}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-900/90 px-4 py-2 text-sm font-semibold text-slate-200 shadow-sm transition hover:border-teal-500/50 hover:bg-slate-800 hover:text-white focus-visible:outline-2 focus-visible:outline-teal-400"
              aria-label="Volver atrás"
            >
              <ArrowLeft className="h-4 w-4 text-teal-400" aria-hidden="true" />
              <span>Volver atrás</span>
            </button>
          ) : (
            <Link
              href="/"
              className="inline-flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-900/90 px-4 py-2 text-sm font-semibold text-slate-200 shadow-sm transition hover:border-teal-500/50 hover:bg-slate-800 hover:text-white focus-visible:outline-2 focus-visible:outline-teal-400"
              aria-label="Volver atrás al inicio"
            >
              <ArrowLeft className="h-4 w-4 text-teal-400" aria-hidden="true" />
              <span>Volver atrás</span>
            </Link>
          )
        )}

        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-teal-500/30 bg-teal-950/60 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-teal-300">
            <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
            Terminal de Paradero
          </span>
        </div>
      </div>

      {/* Encabezado principal del Tótem */}
      <div className="space-y-2">
        <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-white">
          BoardSafe · Asistencia sin cuenta
        </h1>
        <p className="text-base text-slate-300 leading-relaxed">
          No necesitas carnet ni diagnóstico médico. Si necesitas ayuda para indicar tu destino, llama al personal del paradero.
        </p>
      </div>

      {/* Controles accesibles de Audio */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-sm text-slate-300">
            <Volume2 className="h-5 w-5 text-teal-400" aria-hidden="true" />
            <span className="font-medium">Accesibilidad por voz:</span>
            {isSpeaking && (
              <span className="inline-flex items-center gap-1 text-xs text-teal-300 font-semibold animate-pulse">
                Reproduciendo audio...
              </span>
            )}
          </div>
          <div className="flex flex-wrap gap-2.5">
            <button
              type="button"
              className={`${buttonClass} min-h-12 text-base px-4 font-medium`}
              onClick={handleSpeak}
            >
              <Volume2 className="h-4 w-4" aria-hidden="true" />
              Escuchar indicaciones
            </button>
            <button
              type="button"
              className="inline-flex items-center justify-center gap-2 min-h-12 rounded-xl border border-slate-700 bg-slate-800/90 px-4 text-base font-medium text-slate-200 transition hover:bg-slate-700 hover:text-white"
              onClick={handleStopSpeak}
            >
              <VolumeX className="h-4 w-4 text-rose-400" aria-hidden="true" />
              Detener audio
            </button>
          </div>
        </div>
      </div>

      {/* Alertas y Mensajes del sistema */}
      <ApiError error={error} />
      {message && (
        <div
          role="status"
          className="flex items-start gap-3 rounded-2xl border border-teal-500/40 bg-teal-950/60 p-4 text-base text-teal-100 shadow-sm"
        >
          <Info className="h-5 w-5 shrink-0 text-teal-400 mt-0.5" aria-hidden="true" />
          <p>{message}</p>
        </div>
      )}

      {/* Vista de Solicitud Activa con Código */}
      {ticket ? (
        <div className="space-y-6">
          <div className="rounded-2xl border border-teal-500/30 bg-slate-900/80 p-6 space-y-4">
            <div className="flex items-center justify-between gap-2 border-b border-slate-800 pb-3">
              <span className="text-xs uppercase font-bold tracking-wider text-teal-400">
                Estado de la asistencia en curso
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-teal-500/20 px-2.5 py-0.5 text-xs font-semibold text-teal-300">
                <span className="h-1.5 w-1.5 rounded-full bg-teal-400 animate-ping" />
                En seguimiento
              </span>
            </div>

            <p role="status" aria-live="polite" className="text-2xl sm:text-3xl font-extrabold text-white">
              {statusText}
            </p>

            <div className="flex items-start gap-3 rounded-xl border border-slate-800 bg-slate-950/60 p-4 text-base text-slate-200">
              {tracking?.vehicle_assigned ? (
                <>
                  <Bus className="h-6 w-6 text-emerald-400 shrink-0 mt-0.5" aria-hidden="true" />
                  <div>
                    <p className="font-semibold text-emerald-300">Unidad de transporte asignada</p>
                    <p className="text-sm text-slate-300">Hay una unidad asignada. Sigue las indicaciones del personal.</p>
                  </div>
                </>
              ) : (
                <>
                  <Clock className="h-6 w-6 text-amber-400 shrink-0 mt-0.5" aria-hidden="true" />
                  <div>
                    <p className="font-semibold text-amber-300">Buscando unidad y ruta verificada</p>
                    <p className="text-sm text-slate-300">Aún no hay unidad asignada. Solicita apoyo al personal si lo necesitas.</p>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Tarjeta de Código Privado de Seguimiento */}
          {showCode && (
            <div className="space-y-4 rounded-2xl border-2 border-amber-400/80 bg-amber-950/40 p-5 sm:p-6 shadow-lg backdrop-blur">
              <div className="flex items-center gap-2.5 text-amber-300">
                <Key className="h-5 w-5 shrink-0" aria-hidden="true" />
                <h3 className="font-bold text-lg">Código privado de seguimiento</h3>
              </div>

              <div>
                <label className="block text-sm font-semibold text-amber-200" htmlFor="kiosk-code">
                  Código privado de seguimiento (se muestra una vez)
                  <div className="relative mt-2">
                    <input
                      id="kiosk-code"
                      readOnly
                      autoComplete="off"
                      className={`${fieldClass} font-mono font-bold tracking-wider text-base text-amber-100 border-amber-500/60 bg-black/80 py-3 pr-28`}
                      value={ticket.token}
                      onFocus={(e) => e.target.select()}
                    />
                    <button
                      type="button"
                      onClick={handleCopyCode}
                      className="absolute right-2 top-1/2 -translate-y-1/2 inline-flex items-center gap-1.5 rounded-lg border border-amber-500/50 bg-amber-900/60 px-3 py-1.5 text-xs font-semibold text-amber-200 transition hover:bg-amber-800"
                    >
                      {copied ? (
                        <>
                          <Check className="h-3.5 w-3.5 text-emerald-400" aria-hidden="true" />
                          <span>Copiado</span>
                        </>
                      ) : (
                        <>
                          <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                          <span>Copiar</span>
                        </>
                      )}
                    </button>
                  </div>
                </label>
              </div>

              <div className="text-sm text-amber-200/90 leading-relaxed space-y-1">
                <p className="font-medium">Guárdalo de forma privada. Ocúltalo antes de dejar el tótem.</p>
                <p className="text-xs text-amber-300/70">
                  Por seguridad, este código se ocultará automáticamente en 30 segundos o cuando pulses el botón de abajo.
                </p>
              </div>

              <button
                type="button"
                className={`${buttonClass} w-full min-h-12 bg-amber-600 hover:bg-amber-500 text-slate-950 font-bold`}
                onClick={() => setShowCode(false)}
              >
                Ya guardé mi código
              </button>
            </div>
          )}

          {/* Botones de acción según el estado */}
          <div className="space-y-3 pt-2">
            {tracking?.state === "onboard" && (
              <button
                type="button"
                className={`${buttonClass} min-h-14 w-full text-lg font-bold bg-emerald-600 hover:bg-emerald-500`}
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  setError(null);
                  try {
                    await kioskRequest("complete", { token: ticket.token });
                    clear("Viaje completado. El código temporal se borró.");
                  } catch (failure) {
                    setError(failure);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <CheckCircle2 className="h-5 w-5" aria-hidden="true" />
                Confirmar llegada y finalizar
              </button>
            )}

            <button
              type="button"
              className="inline-flex items-center justify-center gap-2 min-h-14 w-full rounded-xl border border-slate-700 bg-slate-900 px-4 text-base font-semibold text-slate-300 transition hover:bg-slate-800 hover:text-white"
              disabled={busy}
              onClick={() => clear("Pantalla limpiada. La solicitud sigue activa; conserva tu código privado para consultarla.")}
            >
              <RefreshCw className="h-4 w-4" aria-hidden="true" />
              Limpiar pantalla para otra persona
            </button>
          </div>
        </div>
      ) : (
        /* Formulario de Nueva Solicitud sin Cuenta */
        <>
          <form
            className="space-y-6"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!destination || busy) return;
              setBusy(true);
              setError(null);
              setMessage("");
              try {
                const receipt = await kioskRequest<KioskReceipt>("requests", {
                  destination_lat: destination.lat,
                  destination_lon: destination.lon,
                  support,
                  consent_operational: consent,
                });
                setTicket({ token: receipt.tracking_token, expires: receipt.expires_at });
                setShowCode(true);
              } catch (failure) {
                setError(failure);
              } finally {
                setBusy(false);
              }
            }}
          >
            <DestinationPicker destination={destination} onChange={setDestination} />

            {/* Paso 2: Apoyos operativos requeridos */}
            <fieldset className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5 space-y-4">
              <legend className="px-1 text-lg font-bold text-white">¿Qué apoyo necesitas?</legend>
              <p className="text-sm text-slate-300">Selecciona al menos una opción.</p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                {(Object.entries(SUPPORT_LABELS) as [SupportOption, string][]).map(([value, label]) => {
                  const isChecked = support.includes(value);
                  const Icon = SUPPORT_ICONS[value] ?? UserCheck;
                  const desc = SUPPORT_DESCRIPTIONS[value];
                  return (
                    <label
                      key={value}
                      className={`flex min-h-16 items-start gap-3.5 rounded-xl border p-4 cursor-pointer transition-all duration-150 ${
                        isChecked
                          ? "border-teal-500 bg-teal-950/40 text-white ring-1 ring-teal-500/50 shadow-sm"
                          : "border-slate-700 bg-slate-950/60 text-slate-300 hover:border-slate-500 hover:bg-slate-900/60"
                      }`}
                    >
                      <input
                        type="checkbox"
                        className="mt-1 h-5 w-5 rounded border-slate-600 accent-teal-500"
                        checked={isChecked}
                        onChange={(e) =>
                          setSupport((previous) =>
                            e.target.checked ? [...previous, value] : previous.filter((option) => option !== value)
                          )
                        }
                      />
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <Icon className={`h-4 w-4 ${isChecked ? "text-teal-400" : "text-slate-400"}`} aria-hidden="true" />
                          <span className="font-semibold text-base leading-tight">{label}</span>
                        </div>
                        {desc && <p className="text-xs text-slate-400 leading-normal">{desc}</p>}
                      </div>
                    </label>
                  );
                })}
              </div>
            </fieldset>

            {/* Paso 3: Consentimiento */}
            <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs uppercase font-bold tracking-wider text-teal-400">Confirmación</span>
              </div>
              <label className="flex min-h-12 items-start gap-3.5 cursor-pointer text-base text-slate-200">
                <input
                  type="checkbox"
                  required
                  checked={consent}
                  className="mt-1 h-5 w-5 rounded border-slate-600 accent-teal-500"
                  onChange={(e) => setConsent(e.target.checked)}
                />
                <span className="leading-normal">
                  Consiento el uso de mi destino y apoyos para coordinar este viaje.
                </span>
              </label>
            </div>

            {/* Botón de Envío Principal */}
            <button
              type="submit"
              disabled={busy || !destination || !support.length || !consent}
              className={`${buttonClass} min-h-14 w-full text-xl font-bold bg-teal-600 hover:bg-teal-500 shadow-lg shadow-teal-950`}
            >
              {busy ? "Enviando…" : "Solicitar asistencia sin cuenta"}
            </button>
          </form>

          {/* Consulta con código existente */}
          <details className="group rounded-2xl border border-slate-800 bg-slate-900/40 p-5 transition-all">
            <summary className="flex cursor-pointer items-center justify-between text-base font-medium text-slate-300 hover:text-white">
              <span className="flex items-center gap-2">
                <Key className="h-4 w-4 text-teal-400" aria-hidden="true" />
                Consultar una solicitud con mi código privado
              </span>
              <ChevronDown className="h-5 w-5 text-slate-400 transition-transform group-open:rotate-180" aria-hidden="true" />
            </summary>
            <form
              className="mt-4 space-y-4 pt-3 border-t border-slate-800/80"
              autoComplete="off"
              onSubmit={async (e) => {
                e.preventDefault();
                setBusy(true);
                setError(null);
                try {
                  const result = await kioskRequest<KioskTracking>("tracking", { token: resume });
                  setTicket({ token: resume, expires: result.expires_at });
                  setTracking(result);
                  setResume("");
                  setShowCode(false);
                } catch (failure) {
                  setError(failure);
                  setResume("");
                } finally {
                  setBusy(false);
                }
              }}
            >
              <label htmlFor="kiosk-resume" className="block text-sm font-medium text-slate-200">
                Código temporal
                <input
                  id="kiosk-resume"
                  type="password"
                  autoComplete="off"
                  required
                  minLength={30}
                  maxLength={256}
                  value={resume}
                  onChange={(e) => setResume(e.target.value)}
                  className={fieldClass}
                  placeholder="Introduce o pega tu código privado..."
                />
              </label>
              <button className={`${buttonClass} w-full min-h-12 text-base font-semibold`} disabled={busy}>
                Consultar mi solicitud
              </button>
            </form>
          </details>
        </>
      )}
    </section>
  );
}
