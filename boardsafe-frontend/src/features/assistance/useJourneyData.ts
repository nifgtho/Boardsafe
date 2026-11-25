"use client";

import { useCallback } from "react";
import { apiRequest } from "@/lib/api";
import { usePollingResource } from "@/hooks/usePollingResource";
import type { AssistanceRecord, RoutePlanRecord, StopRecord, UserRole, VehicleRecord } from "@/types/boardsafe";

export function useJourneyData(token: string, role: UserRole, refreshTrigger: number, onRoutesChanged: (routes: RoutePlanRecord[]) => void) {
  const load = useCallback(async (signal: AbortSignal) => {
    const [requests, routes, stops, vehicles] = await Promise.all([
      apiRequest<AssistanceRecord[]>("/assistance", { token, signal }),
      apiRequest<RoutePlanRecord[]>("/routes", { token, signal }),
      apiRequest<StopRecord[]>("/stops", { token, signal }),
      apiRequest<VehicleRecord[]>("/vehicles", { token, signal }),
    ]);
    const visibleRoutes = role === "driver" ? routes.filter((route) => requests.some((request) => request.route_id === route.id)) : routes;
    if (!signal.aborted) onRoutesChanged(visibleRoutes);
    return { requests, routes: visibleRoutes, stops, vehicles };
  }, [token, role, onRoutesChanged]);
  return usePollingResource(load, refreshTrigger);
}
