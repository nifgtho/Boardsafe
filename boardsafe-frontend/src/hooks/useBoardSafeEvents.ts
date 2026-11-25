"use client";

import { useEffect, useRef, useState } from "react";
import { apiRequest } from "@/lib/api";
import { registerSessionConnection } from "@/lib/sessionConnections";
import type { DomainEventRecord, UserRole } from "@/types/boardsafe";

export type EventConnection = "inactive" | "connecting" | "connected" | "reconnecting" | "unavailable";
const institutional = new Set<UserRole>(["dispatcher", "inspector", "authority", "admin"]);

export function useBoardSafeEvents(token: string | null, role: UserRole | undefined, onDataChanged: () => void) {
  const [connection, setConnection] = useState<{ token: string | null; status: EventConnection }>({ token: null, status: "inactive" });
  const [lastEvent, setLastEvent] = useState<{ token: string; id: number } | null>(null);
  const callback = useRef(onDataChanged);
  useEffect(() => { callback.current = onDataChanged; }, [onDataChanged]);
  useEffect(() => {
    if (!token || !role || !institutional.has(role)) return;
    const setStatus = (status: EventConnection) => setConnection({ token, status });
    const controller = new AbortController();
    let socket: WebSocket | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let refresh: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    let attempt = 0;
    let cursor = 0;
    let queue = Promise.resolve();
    const changed = () => {
      if (refresh || stopped) return;
      refresh = setTimeout(() => { refresh = undefined; if (!stopped) callback.current(); }, 200);
    };
    const consume = (event: DomainEventRecord) => {
      if (stopped || !Number.isSafeInteger(event.id) || event.id <= cursor) return;
      cursor = event.id; setLastEvent({ token, id: cursor }); changed();
    };
    const recover = async () => {
      // Replay after connecting: frames arriving during HTTP catch-up are queued.
      while (!stopped) {
        const events = await apiRequest<DomainEventRecord[]>(`/events?since_id=${cursor}&limit=500`, { token, signal: controller.signal });
        for (const event of events) consume(event);
        if (events.length < 500) break;
      }
    };
    const stop = () => {
      stopped = true; controller.abort(); clearTimeout(retry); clearTimeout(refresh);
      socket?.close(1000, "Sesión finalizada");
    };
    const unregister = registerSessionConnection(stop);
    const connect = () => {
      if (stopped) return;
      setStatus(attempt ? "reconnecting" : "connecting");
      try {
        const configured = process.env.NEXT_PUBLIC_BOARDSAFE_WS_URL;
        const api = process.env.NEXT_PUBLIC_BOARDSAFE_API_URL ?? "/api/v1";
        const url = new URL(configured || `${api.replace(/\/$/, "")}/ws/events`, window.location.origin);
        url.protocol = url.protocol === "https:" || url.protocol === "wss:" ? "wss:" : "ws:";
        if (url.search || url.username || url.password) throw new Error("URL WebSocket no válida");
        socket = new WebSocket(url);
        const current = socket;
        current.onopen = () => { if (!stopped) current.send(token); };
        current.onmessage = (message) => {
          queue = queue.then(async () => {
            if (stopped || current !== socket) return;
            const payload = JSON.parse(String(message.data));
            if (payload.type === "connected") {
              await recover(); attempt = 0; if (!stopped) setStatus("connected");
            } else if (payload.type === "event" && payload.event) consume(payload.event);
          }).catch(() => { if (!stopped) { setStatus("unavailable"); current.close(); } });
        };
        current.onerror = () => { if (!stopped) setStatus("unavailable"); };
        current.onclose = (event) => {
          if (stopped) return;
          if (event.code === 1008 || event.code === 4001) { setStatus("unavailable"); stop(); return; }
          setStatus("reconnecting");
          retry = setTimeout(connect, Math.min(30000, 1000 * 2 ** Math.min(attempt++, 5)));
        };
      } catch { setStatus("unavailable"); }
    };
    connect();
    return () => { stop(); unregister(); };
  }, [token, role]);
  const active = !!token && !!role && institutional.has(role);
  return { status: active ? (connection.token === token ? connection.status : "connecting") : "inactive" as EventConnection, lastEventId: active && lastEvent?.token === token ? lastEvent.id : null };
}
