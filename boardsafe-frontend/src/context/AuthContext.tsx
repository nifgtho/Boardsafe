"use client";

import React, { createContext, useContext, useState, useCallback, useEffect } from "react";
import { closeSessionConnections } from "@/lib/sessionConnections";
import { apiRequest } from "@/lib/api";
import type { AuthUser, LoginResponse } from "@/types/boardsafe";

interface AuthContextValue {
  token: string | null;
  user: AuthUser | null;
  expiresIn: number | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<AuthUser>;
  registerPassenger: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  // JWT mantenido solo en memoria (cumpliendo el contrato de seguridad)
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [expiresIn, setExpiresIn] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!token || !expiresIn) return;
    const timer = window.setTimeout(() => {
      closeSessionConnections();
      setToken(null);
      setUser(null);
      setExpiresIn(null);
    }, expiresIn * 1000);
    return () => window.clearTimeout(timer);
  }, [token, expiresIn]);

  const login = useCallback(async (email: string, password: string) => {
    setLoading(true);
    try {
      const cleanEmail = email.trim().toLowerCase();
      const res = await apiRequest<LoginResponse>("/auth/login", {
        method: "POST",
        body: { email: cleanEmail, password },
      });

      const me = await apiRequest<AuthUser>("/auth/me", {
        token: res.access_token,
      });

      setToken(res.access_token);
      setExpiresIn(res.expires_in);
      setUser(me);
      return me;
    } finally {
      setLoading(false);
    }
  }, []);

  const registerPassenger = useCallback(
    async (email: string, password: string) => {
      setLoading(true);
      try {
        const cleanEmail = email.trim().toLowerCase();
        await apiRequest("/auth/register", {
          method: "POST",
          body: { email: cleanEmail, password },
        });
      } finally {
        setLoading(false);
      }
    },
    []
  );

  const logout = useCallback(async () => {
    closeSessionConnections();
    setToken(null);
    setUser(null);
    setExpiresIn(null);
    if (token) {
      try {
        await apiRequest("/auth/logout", { method: "POST", token });
      } catch {
        // Si ya expiró, igual limpiamos la sesión en memoria
      }
    }
  }, [token]);

  return (
    <AuthContext.Provider
      value={{ token, user, expiresIn, loading, login, registerPassenger, logout }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth debe usarse dentro de AuthProvider");
  return ctx;
}
