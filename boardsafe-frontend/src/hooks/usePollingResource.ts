"use client";

import { useCallback, useEffect, useState } from "react";

/** Poll only while visible; cancel old sessions and avoid overlapping requests. */
export function usePollingResource<T>(
  load: (signal: AbortSignal) => Promise<T>,
  refreshTrigger = 0,
  intervalMs = 10000,
) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [version, setVersion] = useState(0);
  const refresh = useCallback(() => {
    setLoading(true);
    setVersion((value) => value + 1);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    let running = false;
    const run = () => {
      if (running || controller.signal.aborted) return;
      running = true;
      load(controller.signal).then((result) => {
        if (!controller.signal.aborted) {
          setData(result);
          setError(null);
        }
      }).catch((failure: unknown) => {
        if (!controller.signal.aborted) setError(failure);
      }).finally(() => {
        running = false;
        if (!controller.signal.aborted) setLoading(false);
      });
    };
    const whenVisible = () => {
      if (document.visibilityState === "visible") run();
    };
    run();
    const timer = window.setInterval(whenVisible, intervalMs);
    window.addEventListener("focus", whenVisible);
    document.addEventListener("visibilitychange", whenVisible);
    return () => {
      controller.abort();
      window.clearInterval(timer);
      window.removeEventListener("focus", whenVisible);
      document.removeEventListener("visibilitychange", whenVisible);
    };
  }, [load, refreshTrigger, intervalMs, version]);

  return { data, error, loading, refresh };
}
