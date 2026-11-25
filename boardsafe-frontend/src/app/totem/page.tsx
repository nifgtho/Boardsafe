import { KioskPanel } from "@/features/kiosk/KioskPanel";

export default function TotemPage() {
  return (
    <main className="access-shell min-h-screen bg-slate-950 px-4 py-5 text-slate-100 sm:px-6 sm:py-10">
      <div className="mx-auto max-w-3xl">
        <KioskPanel />
      </div>
    </main>
  );
}
