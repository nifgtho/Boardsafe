import Link from "next/link";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import { KioskPanel } from "@/features/kiosk/KioskPanel";

export default function TotemPage() {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 antialiased selection:bg-teal-500 selection:text-white">
      {/* Barra de navegación superior accesible con botón Volver atrás */}
      <header className="sticky top-0 z-30 border-b border-slate-800 bg-slate-900/95 backdrop-blur">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <Link
            href="/"
            className="inline-flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-800/90 px-3.5 py-2 text-sm font-semibold text-slate-200 shadow-sm transition hover:border-teal-500/50 hover:bg-slate-700 hover:text-white focus-visible:outline-2 focus-visible:outline-teal-400"
            aria-label="Volver atrás al inicio"
          >
            <ArrowLeft className="h-4 w-4 text-teal-400" aria-hidden="true" />
            <span>Volver atrás</span>
          </Link>

          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-teal-600/20 text-teal-400 ring-1 ring-teal-500/40">
              <ShieldCheck className="h-4 w-4" aria-hidden="true" />
            </div>
            <div className="text-right sm:text-left">
              <p className="text-xs font-bold uppercase tracking-wider text-teal-400">Terminal de Paradero</p>
              <p className="hidden text-xs text-slate-400 sm:block">Modo Tótem Público · Alta Accesibilidad</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-950/60 px-2.5 py-1 text-xs font-medium text-emerald-400">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
              Tótem Activo
            </span>
          </div>
        </div>
      </header>

      {/* Contenido principal del Tótem */}
      <main className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
        <KioskPanel />
      </main>

      {/* Pie de página con garantías de privacidad y uso de tótem */}
      <footer className="mx-auto max-w-4xl border-t border-slate-800/80 px-4 py-6 text-center text-xs text-slate-500">
        <p>Terminal táctil público de asistencia inmediata · Sin cookies ni almacenamiento de datos en este dispositivo.</p>
        <p className="mt-1">BoardSafe · Sistema de Movilidad Inclusiva y Resiliencia Territorial</p>
      </footer>
    </div>
  );
}
