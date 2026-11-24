"use client";

import { useState, useCallback } from "react";
import {
  ShieldCheck,
  LogOut,
  UserPlus,
  LogIn,
  AlertTriangle,
  Contrast,
} from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { BoardSafeError } from "@/lib/api";
import { BoardSafeMap } from "@/components/BoardSafeMap";
import { AdminStaffPanel } from "@/components/AdminStaffPanel";
import { OperationsPanel } from "@/components/OperationsPanel";
import { PassengerAssistancePanel } from "@/features/assistance/PassengerAssistancePanel";
import type { StopRecord } from "@/types/boardsafe";

const ROLE_LABELS: Record<string, string> = {
  admin: "Administrador",
  passenger: "Pasajero",
  driver: "Transportista / Conductor",
  dispatcher: "Operador / Despachador",
  inspector: "Inspector de Campo",
  authority: "Autoridad Vial",
};

export default function HomePage() {
  const { token, user, expiresIn, loading, login, registerPassenger, logout } = useAuth();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [highContrast, setHighContrast] = useState(false);

  // Estado compartido entre el mapa y los paneles
  const [pickedCoords, setPickedCoords] = useState<{
    lat: number;
    lon: number;
    suggestedName?: string;
  } | null>(null);
  const [selectedStopId, setSelectedStopId] = useState<string | null>(null);
  const [mapRefresh, setMapRefresh] = useState(0);

  const [error, setError] = useState<{
    message: string;
    reasons: string[];
    hint: string;
  } | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const handleSelectPoint = useCallback(
    (lat: number, lon: number, suggestedName?: string) => {
      setPickedCoords({ lat, lon, suggestedName });
    },
    []
  );

  const handleSelectStop = useCallback((stop: StopRecord) => {
    setSelectedStopId(stop.id);
  }, []);

  const triggerMapRefresh = useCallback(() => {
    setMapRefresh((n) => n + 1);
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccessMsg(null);

    try {
      if (mode === "login") {
        await login(email, password);
      } else {
        await registerPassenger(email, password);
        setSuccessMsg("Cuenta de pasajero creada. Ahora puedes iniciar sesión.");
        setMode("login");
        setPassword("");
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
          message: err instanceof Error ? err.message : "Error inesperado",
          reasons: [],
          hint: "Intenta nuevamente.",
        });
      }
    }
  }

  // Vista autenticada
  if (user && token) {
    return (
      <div
        className={`min-h-screen ${
          highContrast ? "bg-black text-white contrast-125" : "bg-slate-950 text-slate-100"
        }`}
      >
        <header className="sticky top-0 z-20 border-b border-slate-800 bg-slate-900/95 backdrop-blur">
          <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-teal-600/20 text-teal-400 ring-1 ring-teal-500/40">
                <ShieldCheck className="h-5 w-5" aria-hidden="true" />
              </div>
              <div>
                <h1 className="text-base font-bold text-white">BoardSafe</h1>
                <p className="text-xs text-slate-400">
                  {ROLE_LABELS[user.role] ?? user.role} · {user.email}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <span className="hidden rounded-lg bg-slate-800 px-2.5 py-1 text-xs text-slate-300 sm:inline-block">
                Sesión en memoria ({expiresIn ? Math.round(expiresIn / 60) : 60} min)
              </span>

              <button
                type="button"
                onClick={() => setHighContrast((v) => !v)}
                aria-pressed={highContrast}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-700"
              >
                <Contrast className="h-3.5 w-3.5" aria-hidden="true" />
                {highContrast ? "Contraste normal" : "Alto contraste"}
              </button>

              <button
                type="button"
                onClick={() => logout()}
                className="inline-flex items-center gap-1.5 rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-rose-500"
              >
                <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
                Salir
              </button>
            </div>
          </div>
        </header>

        <main className="mx-auto grid max-w-7xl gap-6 px-4 py-6 lg:grid-cols-12">
          <div className="space-y-6 lg:col-span-7">
            <BoardSafeMap
              token={token}
              onSelectPoint={handleSelectPoint}
              onSelectStop={handleSelectStop}
              refreshTrigger={mapRefresh}
            />
          </div>

          <div className="space-y-6 lg:col-span-5">
            {user.role === "admin" && (
              <>
                <AdminStaffPanel token={token} />
                <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-4 text-xs text-slate-300">
                  Cuando termines de crear tu personal, cierra sesión e ingresa con{" "}
                  <strong className="text-teal-300">dispatcher</strong> para registrar
                  paraderos y vehículos en el mapa.
                </div>
              </>
            )}

            {["dispatcher", "driver", "inspector", "authority"].includes(user.role) && (
              <OperationsPanel
                token={token}
                role={user.role}
                pickedCoords={pickedCoords}
                selectedStopId={selectedStopId}
                onDataChanged={triggerMapRefresh}
              />
            )}

            {user.role === "passenger" && (
              <PassengerAssistancePanel
                token={token}
                pickedCoords={pickedCoords}
                selectedStopId={selectedStopId}
              />
            )}
          </div>
        </main>
      </div>
    );
  }

  // Vista no autenticada: Login / Registro pasajero
  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center px-4 py-10">
      <header className="mb-8 text-center">
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-teal-600/20 text-teal-400 ring-1 ring-teal-500/40">
          <ShieldCheck className="h-6 w-6" aria-hidden="true" />
        </div>
        <h1 className="text-3xl font-bold tracking-tight text-white">BoardSafe</h1>
        <p className="mt-2 text-sm text-slate-300">
          Movilidad inclusiva, sensores Edge y resiliencia vial (COC)
        </p>
      </header>

      <section
        aria-label="Acceso a la plataforma"
        className="rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-xl"
      >
        <div className="mb-6 grid grid-cols-2 gap-2 rounded-xl bg-slate-950 p-1">
          <button
            type="button"
            onClick={() => {
              setMode("login");
              setError(null);
            }}
            className={`flex items-center justify-center gap-2 rounded-lg py-2.5 text-sm font-semibold transition ${
              mode === "login" ? "bg-teal-600 text-white" : "text-slate-300 hover:text-white"
            }`}
          >
            <LogIn className="h-4 w-4" aria-hidden="true" />
            Iniciar sesión
          </button>
          <button
            type="button"
            onClick={() => {
              setMode("register");
              setError(null);
            }}
            className={`flex items-center justify-center gap-2 rounded-lg py-2.5 text-sm font-semibold transition ${
              mode === "register" ? "bg-teal-600 text-white" : "text-slate-300 hover:text-white"
            }`}
          >
            <UserPlus className="h-4 w-4" aria-hidden="true" />
            Registro pasajero
          </button>
        </div>

        {successMsg && (
          <div
            role="status"
            className="mb-4 rounded-xl border border-teal-500/40 bg-teal-950/60 p-3 text-sm text-teal-200"
          >
            {successMsg}
          </div>
        )}

        {error && (
          <div
            role="alert"
            className="mb-4 rounded-xl border border-amber-500/40 bg-amber-950/50 p-4 text-sm text-amber-100"
          >
            <div className="flex items-center gap-2 font-semibold text-amber-300">
              <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
              {error.message}
            </div>
            {error.reasons.length > 0 && (
              <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-amber-200">
                {error.reasons.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
            )}
            <p className="mt-2 text-xs text-amber-200/90">{error.hint}</p>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="email" className="block text-sm font-medium text-slate-200">
              Correo electrónico
            </label>
            <input
              id="email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="admin@boardsafe.local"
              className="mt-1.5 w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2.5 text-sm text-white placeholder-slate-500 focus:border-teal-400 focus:outline-none focus:ring-2 focus:ring-teal-500/40"
            />
          </div>

          <div>
            <label htmlFor="password" className="block text-sm font-medium text-slate-200">
              Contraseña {mode === "register" && "(mínimo 12 caracteres)"}
            </label>
            <input
              id="password"
              type="password"
              required
              minLength={mode === "register" ? 12 : 1}
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••••••"
              className="mt-1.5 w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2.5 text-sm text-white placeholder-slate-500 focus:border-teal-400 focus:outline-none focus:ring-2 focus:ring-teal-500/40"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-xl bg-teal-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-teal-500 disabled:opacity-60"
          >
            {loading
              ? "Conectando..."
              : mode === "login"
              ? "Entrar a BoardSafe"
              : "Crear cuenta de pasajero"}
          </button>
        </form>
      </section>
    </main>
  );
}