"use client";

import Link from "next/link";
import { useState, useCallback } from "react";
import {
  ShieldCheck,
  LogOut,
  UserPlus,
  LogIn,
  AlertTriangle,
  Contrast,
  Accessibility,
  ArrowRight,
  Eye,
  EyeOff,
  Sparkles,
  CheckCircle2,
} from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { BoardSafeError } from "@/lib/api";
import { BoardSafeMap } from "@/components/BoardSafeMap";
import { AdminStaffPanel } from "@/components/AdminStaffPanel";
import { OperationsPanel } from "@/components/OperationsPanel";
import { PassengerAssistancePanel } from "@/features/assistance/PassengerAssistancePanel";
import { DispatchAssistancePanel } from "@/features/assistance/DispatchAssistancePanel";
import { ResiliencePanel } from "@/features/resilience/ResiliencePanel";
import { useBoardSafeEvents } from "@/hooks/useBoardSafeEvents";
import { MonitoringPanel } from "@/features/monitoring/MonitoringPanel";
import { RiskPanel } from "@/features/risk/RiskPanel";
import { EdgeNodesPanel } from "@/features/edge/EdgeNodesPanel";
import type { RoutePlanRecord, StopRecord } from "@/types/boardsafe";

const ROLE_LABELS: Record<string, string> = {
  admin: "Administrador",
  passenger: "Pasajero",
  driver: "Transportista / Conductor",
  dispatcher: "Operador / Despachador",
  inspector: "Inspector de Campo",
  authority: "Autoridad Vial",
};

const ROLE_BADGE_COLORS: Record<string, string> = {
  admin: "border-purple-500/40 bg-purple-950/60 text-purple-300",
  passenger: "border-teal-500/40 bg-teal-950/60 text-teal-300",
  driver: "border-sky-500/40 bg-sky-950/60 text-sky-300",
  dispatcher: "border-amber-500/40 bg-amber-950/60 text-amber-300",
  inspector: "border-emerald-500/40 bg-emerald-950/60 text-emerald-300",
  authority: "border-rose-500/40 bg-rose-950/60 text-rose-300",
};

const DEMO_ROLES = [
  { role: "admin", label: "Admin", email: "admin@boardsafe.local" },
  { role: "dispatcher", label: "Despacho", email: "dispatcher@boardsafe.local" },
  { role: "driver", label: "Conductor", email: "driver@boardsafe.local" },
  { role: "inspector", label: "Inspector", email: "inspector@boardsafe.local" },
  { role: "authority", label: "Autoridad", email: "authority@boardsafe.local" },
  { role: "passenger", label: "Pasajero", email: "passenger@boardsafe.local" },
];

export default function HomePage() {
  const { token, user, expiresIn, loading, login, registerPassenger, logout } = useAuth();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [highContrast, setHighContrast] = useState(false);

  // Estado compartido entre el mapa y los paneles
  const [pickedCoords, setPickedCoords] = useState<{
    lat: number;
    lon: number;
    suggestedName?: string;
  } | null>(null);
  const [selectedStopId, setSelectedStopId] = useState<string | null>(null);
  const [mapRefresh, setMapRefresh] = useState(0);
  const [routeData, setRouteData] = useState<{ token: string | null; routes: RoutePlanRecord[] }>({
    token: null,
    routes: [],
  });
  const [previewRouteId, setPreviewRouteId] = useState<string | null>(null);
  const [routeFocus, setRouteFocus] = useState(0);
  const [roadDraft, setRoadDraft] = useState<[number, number][]>([]);
  const [drawingRoad, setDrawingRoad] = useState(false);

  const handleAddRoadPoint = useCallback((lon: number, lat: number) => {
    setRoadDraft((points) => (points.length < 5000 ? [...points, [lon, lat]] : points));
  }, []);

  const handleRoutesChanged = useCallback(
    (routes: RoutePlanRecord[]) => {
      setRouteData({ token, routes });
    },
    [token]
  );

  const handlePreviewRoute = useCallback((id: string) => {
    setPreviewRouteId(id);
    setRouteFocus((value) => value + 1);
  }, []);

  const previewRoute =
    routeData.token === token
      ? routeData.routes.find((route) => route.id === previewRouteId) ?? null
      : null;

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

  const events = useBoardSafeEvents(token, user?.role, triggerMapRefresh);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccessMsg(null);

    try {
      if (mode === "login") {
        setPickedCoords(null);
        setSelectedStopId(null);
        setRouteData({ token: null, routes: [] });
        setPreviewRouteId(null);
        setRoadDraft([]);
        setDrawingRoad(false);
        await login(email, password);
        setPassword("");
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

  // ==========================================
  // Vista autenticada (Panel de Operaciones)
  // ==========================================
  if (user && token) {
    const roleBadgeClass =
      ROLE_BADGE_COLORS[user.role] ?? "border-slate-700 bg-slate-800 text-slate-300";

    return (
      <div
        className={`min-h-screen ${
          highContrast ? "bg-black text-white contrast-125" : "bg-slate-950 text-slate-100"
        }`}
      >
        <header className="sticky top-0 z-20 border-b border-slate-800 bg-slate-900/95 backdrop-blur shadow-md">
          <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-teal-600/20 text-teal-400 ring-1 ring-teal-500/40">
                <ShieldCheck className="h-5 w-5" aria-hidden="true" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h1 className="text-base font-extrabold text-white">BoardSafe</h1>
                  <span
                    className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${roleBadgeClass}`}
                  >
                    {ROLE_LABELS[user.role] ?? user.role}
                  </span>
                </div>
                <p className="text-xs text-slate-400">{user.email}</p>
              </div>
            </div>

            <div className="flex items-center gap-2 sm:gap-3">
              {/* Enlace rápido al Tótem para administradores / operadores */}
              <Link
                href="/totem"
                className="inline-flex items-center gap-1.5 rounded-lg border border-teal-500/30 bg-teal-950/40 px-2.5 py-1.5 text-xs font-semibold text-teal-300 transition hover:bg-teal-900/60 hover:text-white"
                title="Abrir terminal público de asistencia en paradero"
              >
                <Accessibility className="h-3.5 w-3.5 text-teal-400" aria-hidden="true" />
                <span className="hidden sm:inline">Modo Tótem</span>
              </Link>

              <span className="hidden rounded-lg bg-slate-800 px-2.5 py-1.5 text-xs text-slate-300 md:inline-flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                Sesión ({expiresIn ? Math.round(expiresIn / 60) : 60} min)
              </span>

              <button
                type="button"
                onClick={() => setHighContrast((v) => !v)}
                aria-pressed={highContrast}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-slate-700"
              >
                <Contrast className="h-3.5 w-3.5" aria-hidden="true" />
                {highContrast ? "Normal" : "Contraste"}
              </button>

              <button
                type="button"
                onClick={() => logout()}
                className="inline-flex items-center gap-1.5 rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-rose-500 shadow-sm"
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
              previewRoute={previewRoute}
              routeFocus={routeFocus}
              roadDraft={roadDraft}
              drawingRoad={drawingRoad && ["admin", "authority"].includes(user.role)}
              onAddRoadPoint={handleAddRoadPoint}
            />
          </div>

          <div className="space-y-6 lg:col-span-5">
            {user.role === "admin" && (
              <>
                <AdminStaffPanel token={token} />
              </>
            )}

            {user.role !== "passenger" && (
              <DispatchAssistancePanel
                key={token}
                token={token}
                role={user.role}
                refreshTrigger={mapRefresh}
                onDataChanged={triggerMapRefresh}
                onPreviewRoute={handlePreviewRoute}
                onRoutesChanged={handleRoutesChanged}
              />
            )}

            {["dispatcher", "driver", "inspector", "authority", "admin"].includes(user.role) && (
              <OperationsPanel
                key={`operations-${token}`}
                refreshTrigger={mapRefresh}
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

            {["dispatcher", "inspector", "authority", "admin"].includes(user.role) && (
              <>
                <MonitoringPanel
                  key={`monitor-${token}`}
                  token={token}
                  role={user.role}
                  refreshTrigger={mapRefresh}
                  connection={events.status}
                  lastEventId={events.lastEventId}
                />
                <RiskPanel
                  key={`risk-${token}`}
                  token={token}
                  role={user.role}
                  refreshTrigger={mapRefresh}
                  pickedCoords={pickedCoords}
                  onDataChanged={triggerMapRefresh}
                />
              </>
            )}
            {user.role === "admin" && (
              <EdgeNodesPanel
                key={`edge-${token}`}
                token={token}
                refreshTrigger={mapRefresh}
                onDataChanged={triggerMapRefresh}
              />
            )}

            <ResiliencePanel
              key={`resilience-${token}`}
              token={token}
              role={user.role}
              refreshTrigger={mapRefresh}
              pickedCoords={pickedCoords}
              roadPoints={roadDraft}
              drawingRoad={drawingRoad}
              onRoadPointsChange={setRoadDraft}
              onDrawingRoadChange={setDrawingRoad}
              onDataChanged={triggerMapRefresh}
            />
          </div>
        </main>
      </div>
    );
  }

  // ==========================================
  // Vista no autenticada: Login / Registro
  // ==========================================
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 antialiased selection:bg-teal-500 selection:text-white flex flex-col justify-between">
      <main className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center px-4 py-8 sm:py-12">
        {/* Encabezado Hero */}
        <header className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-teal-600/20 text-teal-400 ring-1 ring-teal-500/40 shadow-lg shadow-teal-950/50">
            <ShieldCheck className="h-8 w-8" aria-hidden="true" />
          </div>
          <div className="inline-flex items-center gap-1.5 rounded-full border border-teal-500/30 bg-teal-950/60 px-3 py-1 text-xs font-semibold text-teal-300 mb-2">
            <Sparkles className="h-3 w-3" />
            Continuidad Operativa Vial & Inclusión
          </div>
          <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-white">BoardSafe</h1>
          <p className="mt-2 text-sm text-slate-300 leading-relaxed max-w-md mx-auto">
            Movilidad inclusiva, sensores Edge y resiliencia territorial (Cadena de Custodia Operativa)
          </p>
        </header>

        {/* Tarjeta destacada: Asistencia sin cuenta en el tótem */}
        <div className="mb-6 overflow-hidden rounded-2xl border border-teal-500/40 bg-gradient-to-r from-teal-950/60 via-slate-900 to-slate-900 p-4 sm:p-5 shadow-xl shadow-teal-950/40">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-teal-500/20 text-teal-400 ring-1 ring-teal-500/40">
                <Accessibility className="h-5 w-5" aria-hidden="true" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="rounded-md bg-teal-500/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-teal-300">
                    Modo Público
                  </span>
                  <h2 className="text-sm sm:text-base font-bold text-white">
                    Asistencia sin cuenta
                  </h2>
                </div>
                <p className="mt-1 text-xs text-slate-300 leading-relaxed">
                  ¿Estás en un paradero o no tienes cuenta? Solicita asistencia de viaje accesible en pantalla pública.
                </p>
              </div>
            </div>
            <Link
              href="/totem"
              className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-teal-600 px-4 py-2.5 text-xs sm:text-sm font-bold text-white shadow-sm transition hover:bg-teal-500 active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-teal-300"
            >
              <span>Asistencia sin cuenta en el tótem</span>
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          </div>
        </div>

        {/* Formulario de Acceso Institucional / Pasajero */}
        <section
          aria-label="Acceso a la plataforma"
          className="rounded-2xl border border-slate-800 bg-slate-900/90 p-6 sm:p-7 shadow-2xl backdrop-blur"
        >
          {/* Pestañas de modo */}
          <div className="mb-6 grid grid-cols-2 gap-2 rounded-xl bg-slate-950 p-1.5 border border-slate-800">
            <button
              type="button"
              onClick={() => {
                setMode("login");
                setError(null);
              }}
              className={`flex items-center justify-center gap-2 rounded-lg py-2.5 text-sm font-semibold transition ${
                mode === "login"
                  ? "bg-teal-600 text-white shadow-sm"
                  : "text-slate-400 hover:text-white"
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
                mode === "register"
                  ? "bg-teal-600 text-white shadow-sm"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              <UserPlus className="h-4 w-4" aria-hidden="true" />
              Registro pasajero
            </button>
          </div>

          {successMsg && (
            <div
              role="status"
              className="mb-4 flex items-center gap-2.5 rounded-xl border border-teal-500/40 bg-teal-950/60 p-3.5 text-sm text-teal-200"
            >
              <CheckCircle2 className="h-4 w-4 shrink-0 text-teal-400" aria-hidden="true" />
              <span>{successMsg}</span>
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
                className="mt-1.5 w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2.5 text-sm text-white placeholder-slate-500 shadow-inner transition focus:border-teal-400 focus:outline-none focus:ring-2 focus:ring-teal-500/30"
              />
            </div>

            <div>
              <div className="flex items-center justify-between">
                <label htmlFor="password" className="block text-sm font-medium text-slate-200">
                  Contraseña {mode === "register" && "(mínimo 12 caracteres)"}
                </label>
              </div>
              <div className="relative mt-1.5">
                <input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  required
                  minLength={mode === "register" ? 12 : 1}
                  autoComplete={mode === "login" ? "current-password" : "new-password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••••••"
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2.5 pr-10 text-sm text-white placeholder-slate-500 shadow-inner transition focus:border-teal-400 focus:outline-none focus:ring-2 focus:ring-teal-500/30"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200 focus:outline-none"
                  aria-label={showPassword ? "Ocultar contraseña" : "Ver contraseña"}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-xl bg-teal-600 px-4 py-3 text-sm font-bold text-white shadow-md transition hover:bg-teal-500 active:scale-[0.99] disabled:opacity-60"
            >
              {loading
                ? "Conectando..."
                : mode === "login"
                ? "Entrar a BoardSafe"
                : "Crear cuenta de pasajero"}
            </button>
          </form>

          {/* Selector rápido de credenciales de prueba para evaluación */}
          {mode === "login" && (
            <div className="mt-5 border-t border-slate-800 pt-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">
                Credenciales de prueba rápida:
              </p>
              <div className="flex flex-wrap gap-1.5">
                {DEMO_ROLES.map((item) => (
                  <button
                    key={item.role}
                    type="button"
                    onClick={() => {
                      setEmail(item.email);
                      setError(null);
                    }}
                    className="rounded-lg border border-slate-700 bg-slate-950/80 px-2.5 py-1 text-xs text-slate-300 transition hover:border-teal-500 hover:text-white active:scale-95"
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </section>
      </main>

      {/* Pie de página */}
      <footer className="mx-auto max-w-xl px-4 py-6 text-center text-xs text-slate-500">
        <p>BoardSafe · Resiliencia Territorial & Accesibilidad Universal</p>
      </footer>
    </div>
  );
}
