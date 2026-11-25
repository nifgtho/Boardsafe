"use client";

import { useCallback, useState } from "react";
import { UserPlus, CheckCircle2, AlertTriangle, Copy } from "lucide-react";
import { apiRequest, BoardSafeError } from "@/lib/api";
import type { UserRole } from "@/types/boardsafe";
import { usePollingResource } from "@/hooks/usePollingResource";

type StaffRole = Exclude<UserRole, "passenger">;

interface CreatedStaff {
  id: string;
  email: string;
  role: StaffRole;
  active?: boolean;
}

const STAFF_ROLES: { value: StaffRole; label: string; desc: string }[] = [
  { value: "dispatcher", label: "Operador (dispatcher)", desc: "Paraderos, vehículos, rutas y ofertas" },
  { value: "driver", label: "Conductor (driver)", desc: "Estado de bus/rampa, aceptar y abordar" },
  { value: "inspector", label: "Inspector (inspector)", desc: "Verificar reportes, rutas y riesgo" },
  { value: "authority", label: "Autoridad (authority)", desc: "Cierres viales y decisiones firmadas" },
  { value: "admin", label: "Administrador (admin)", desc: "Provisionamiento y nodos Edge/Tótem" },
];

export function AdminStaffPanel({ token }: { token: string }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<StaffRole>("dispatcher");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const loadStaff = useCallback((signal: AbortSignal) => apiRequest<CreatedStaff[]>("/auth/staff", { token, signal }), [token]);
  const { data: staff, error: loadError, loading: fetchingStaff, refresh } = usePollingResource(loadStaff);

  async function copyStaffId(id: string) {
    try {
      await navigator.clipboard.writeText(id);
      setFeedback("ID del personal copiado.");
    } catch {
      setError(`No se pudo copiar automáticamente. ID: ${id}`);
    }
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setFeedback(null);
    setLoading(true);

    try {
      const cleanEmail = email.trim().toLowerCase();
      const created = await apiRequest<CreatedStaff>("/auth/staff", {
        method: "POST",
        token,
        body: { email: cleanEmail, password, role },
      });

      setFeedback(`Cuenta de ${created.email} registrada.`);
      refresh();
      setEmail("");
      setPassword("");
    } catch (err) {
      setError(
        err instanceof BoardSafeError
          ? `${err.message} ${err.reasons.join(" · ")}`
          : "No se pudo crear el usuario."
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <section
      aria-label="Provisionamiento de personal"
      className="rounded-2xl border border-slate-800 bg-slate-900 p-5 shadow-xl"
    >
      <div className="mb-4 flex items-center gap-2">
        <UserPlus className="h-5 w-5 text-teal-400" aria-hidden="true" />
        <div>
          <h2 className="text-base font-semibold text-white">
            Crear cuentas de personal
          </h2>
          <p className="text-xs text-slate-400">
            Administración de cuentas del personal autorizado.
          </p>
        </div>
      </div>

      {error && (
        <div
          role="alert"
          className="mb-4 flex items-start gap-2 rounded-xl border border-amber-500/40 bg-amber-950/50 p-3 text-xs text-amber-100"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
          <span>{error}</span>
        </div>
      )}

      {loadError instanceof Error && <p role="alert" className="mb-3 text-sm text-amber-200">{loadError.message}</p>}
      {feedback && <p role="status" className="mb-3 text-sm text-teal-200">{feedback}</p>}

      <form onSubmit={handleCreate} autoComplete="off" className="space-y-3">
        <div>
          <label htmlFor="staff-role" className="block text-xs font-medium text-slate-200">
            Rol operativo
          </label>
          <select
            id="staff-role"
            value={role}
            onChange={(e) => setRole(e.target.value as StaffRole)}
            className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white focus:border-teal-400 focus:outline-none"
          >
            {STAFF_ROLES.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label} — {r.desc}
              </option>
            ))}
          </select>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="staff-email" className="block text-xs font-medium text-slate-200">
              Correo
            </label>
            <input
              id="staff-email"
              type="email"
              autoComplete="off"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="operador@boardsafe.local"
              className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-teal-400 focus:outline-none"
            />
          </div>

          <div>
            <label htmlFor="staff-pass" className="block text-xs font-medium text-slate-200">
              Contraseña (mín. 12 caracteres)
            </label>
            <input
              id="staff-pass"
              type="password"
              autoComplete="new-password"
              required
              minLength={12}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Usa una contraseña nueva"
              className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-teal-400 focus:outline-none"
            />
          </div>
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-xl bg-teal-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-teal-500 disabled:opacity-60"
        >
          {loading ? "Creando cuenta..." : "Registrar personal"}
        </button>
      </form>

        <div className="mt-5 border-t border-slate-800 pt-4">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-slate-200">Personal registrado</h3>
            <button type="button" onClick={refresh} disabled={fetchingStaff} className="rounded-lg border border-slate-600 px-3 py-2 text-sm text-white disabled:opacity-50">Actualizar personal</button>
          </div>
          <ul className="space-y-2">
            {(staff ?? []).map((u) => (
              <li
                key={u.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-teal-500/20 bg-slate-950 px-3 py-2 text-xs"
              >
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-teal-400" />
                  <span className="font-medium text-white">{u.email}</span>
                  <span className="rounded bg-teal-500/20 px-2 py-0.5 text-teal-300">
                    {u.role}
                  </span>
                  {u.active === false && <span className="text-amber-200">Inactivo</span>}
                </div>
                <button
                  type="button"
                  onClick={() => void copyStaffId(u.id)}
                  className="inline-flex items-center gap-1 rounded bg-slate-800 px-2 py-1 font-mono text-[11px] text-slate-300 hover:bg-slate-700"
                  title="Copiar UUID"
                >
                  <Copy className="h-3 w-3" />
                  {u.id.slice(0, 8)}...
                </button>
              </li>
            ))}
          </ul>
        </div>
    </section>
  );
}
