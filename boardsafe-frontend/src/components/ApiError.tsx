import { AlertTriangle } from "lucide-react";
import { BoardSafeError } from "@/lib/api";

export function ApiError({ error }: { error: unknown }) {
  if (!error) return null;
  const known = error instanceof BoardSafeError;
  return (
    <div
      role="alert"
      className="rounded-xl border border-amber-500/40 bg-amber-950/40 p-4 text-sm text-amber-100 shadow-sm backdrop-blur-xs"
    >
      <div className="flex items-start gap-2.5 font-semibold text-amber-300">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" aria-hidden="true" />
        <p>{error instanceof Error ? error.message : "No se pudo actualizar la información."}</p>
      </div>
      {known && error.reasons.length > 0 && (
        <ul className="mt-2 list-disc space-y-1 pl-6 text-xs text-amber-200">
          {error.reasons.map((reason, index) => (
            <li key={index}>{reason}</li>
          ))}
        </ul>
      )}
      {known && error.actionHint && (
        <p className="mt-2 pl-6 text-xs text-amber-200/90">{error.actionHint}</p>
      )}
    </div>
  );
}
