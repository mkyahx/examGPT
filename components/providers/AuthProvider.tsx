"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { AuthUser } from "@/lib/types";

type AuthActionResult = { ok: true } | { ok: false; reason: string };

type AuthContextValue = {
  hydrated: boolean;
  user: AuthUser | null;
  error: string | null;
  refreshUser: () => Promise<void>;
  login: (input: { email: string; password: string }) => Promise<AuthActionResult>;
  register: (input: {
    email: string;
    displayName: string;
    password: string;
  }) => Promise<AuthActionResult>;
  logout: () => Promise<void>;
};

type AuthPayload = {
  ok?: boolean;
  user?: AuthUser | null;
  reason?: string;
};

const AuthContext = createContext<AuthContextValue | null>(null);

async function parseAuthResponse(response: Response): Promise<AuthPayload> {
  const payload = (await response.json().catch(() => ({}))) as AuthPayload;
  if (!response.ok || !payload.ok) {
    return {
      ok: false,
      reason: payload.reason ?? "Authentication request failed.",
    };
  }
  return payload;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [hydrated, setHydrated] = useState(false);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refreshUser = useCallback(async () => {
    setError(null);
    try {
      const response = await fetch("/api/auth/me", {
        method: "GET",
        credentials: "same-origin",
      });
      const payload = await parseAuthResponse(response);
      if (!payload.ok) {
        setUser(null);
        setError(payload.reason ?? "Could not load session.");
        return;
      }
      setUser(payload.user ?? null);
    } catch (err) {
      setUser(null);
      setError(err instanceof Error ? err.message : "Could not load session.");
    } finally {
      setHydrated(true);
    }
  }, []);

  useEffect(() => {
    queueMicrotask(() => {
      void refreshUser();
    });
  }, [refreshUser]);

  const login = useCallback(async (input: { email: string; password: string }) => {
    setError(null);
    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify(input),
    });
    const payload = await parseAuthResponse(response);
    if (!payload.ok || !payload.user) {
      const reason = payload.reason ?? "Could not sign in.";
      setError(reason);
      return { ok: false as const, reason };
    }
    setUser(payload.user);
    return { ok: true as const };
  }, []);

  const register = useCallback(
    async (input: { email: string; displayName: string; password: string }) => {
      setError(null);
      const response = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify(input),
      });
      const payload = await parseAuthResponse(response);
      if (!payload.ok || !payload.user) {
        const reason = payload.reason ?? "Could not create account.";
        setError(reason);
        return { ok: false as const, reason };
      }
      setUser(payload.user);
      return { ok: true as const };
    },
    [],
  );

  const logout = useCallback(async () => {
    setError(null);
    await fetch("/api/auth/logout", {
      method: "POST",
      credentials: "same-origin",
    }).catch(() => undefined);
    setUser(null);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      hydrated,
      user,
      error,
      refreshUser,
      login,
      register,
      logout,
    }),
    [hydrated, user, error, refreshUser, login, register, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
