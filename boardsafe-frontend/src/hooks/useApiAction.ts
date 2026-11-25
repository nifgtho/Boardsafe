"use client";

import { useRef, useState } from "react";
import { apiRequest } from "@/lib/api";

export function useApiAction(token: string, onChanged: () => void) {
  const active = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [feedback, setFeedback] = useState("");
  async function run<T>(path: string, body?: unknown, success = "Acción registrada.", method: "POST" | "PATCH" | "GET" = "POST"): Promise<T | null> {
    if (active.current) return null;
    active.current = true; setBusy(true); setError(null); setFeedback("");
    try {
      const result = await apiRequest<T>(path, { token, method, body });
      setFeedback(success); if (method !== "GET") onChanged(); return result;
    } catch (failure) { setError(failure); return null; }
    finally { active.current = false; setBusy(false); }
  }
  return { run, busy, error, feedback };
}
