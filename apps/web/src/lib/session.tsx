"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  TOKEN_KEY,
  bustCache,
  getAuthToken,
  getMe,
  getWalletNonce,
  setAuthToken,
  verifyWalletSignature,
  type Role,
  type User,
} from "@/lib/api";
import { connectWallet, signWalletMessage } from "@/lib/wallet";

export type RegisterRole = "producer" | "consumer";

export interface LoginOptions {
  role?: RegisterRole;
  name?: string;
}

export interface SessionValue {
  userId: string;
  user: User | null;
  role: Role | null;
  walletAddress: string | null;
  isAuthenticated: boolean;
  authLoading: boolean;
  authError: string | null;
  login: (options?: LoginOptions) => Promise<User>;
  logout: () => void;
  refresh: () => Promise<void>;
}

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const stored = typeof window !== "undefined" ? window.localStorage.getItem(TOKEN_KEY) : null;
    if (!stored) {
      setAuthToken(null);
      setUser(null);
      setAuthLoading(false);
      return;
    }
    setAuthToken(stored);
    try {
      const res = await getMe();
      setUser(res.user);
      setAuthError(null);
    } catch (err) {
      setAuthToken(null);
      setUser(null);
      setAuthError(err instanceof Error ? err.message : String(err));
    } finally {
      setAuthLoading(false);
    }
  }, []);

  useEffect(() => {
    const token = typeof window !== "undefined" ? window.localStorage.getItem(TOKEN_KEY) : null;
    if (token) setAuthToken(token);
    else setAuthToken(getAuthToken());
    void refresh();
  }, [refresh]);

  const login = useCallback(async (options?: LoginOptions) => {
    setAuthLoading(true);
    setAuthError(null);
    try {
      const address = await connectWallet();
      const nonce = await getWalletNonce(address);
      const signature = await signWalletMessage(nonce.message);
      const result = await verifyWalletSignature({
        address,
        signature,
        role: options?.role,
        name: options?.name,
      });
      setAuthToken(result.token);
      setUser(result.user);
      bustCache();
      return result.user;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setAuthError(message);
      throw err;
    } finally {
      setAuthLoading(false);
    }
  }, []);

  const logout = useCallback(() => {
    setAuthToken(null);
    setUser(null);
    setAuthError(null);
    bustCache();
  }, []);

  const value = useMemo<SessionValue>(
    () => ({
      userId: user?.id ?? "",
      user,
      role: user?.role ?? null,
      walletAddress: user?.walletAddress ?? null,
      isAuthenticated: Boolean(user),
      authLoading,
      authError,
      login,
      logout,
      refresh,
    }),
    [user, authLoading, authError, login, logout, refresh],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used within SessionProvider");
  return ctx;
}

export function canDecideCases(role: Role | null): boolean {
  return role === "verifier" || role === "admin";
}

export function canRunMatching(role: Role | null): boolean {
  return role === "verifier" || role === "admin";
}

export function canCreateOffer(role: Role | null): boolean {
  return role === "producer" || role === "admin";
}

export function canCreateRequest(role: Role | null): boolean {
  return role === "consumer" || role === "admin";
}

export function canManageUsers(role: Role | null): boolean {
  return role === "admin";
}
