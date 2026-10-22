"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { bustCache, isOfflineError } from "@/lib/api";

export interface AsyncState<T> {
  data: T | null;
  error: string | null;
  offline: boolean;
  loading: boolean;
  reload: () => void;
}

export function useAsyncData<T>(
  loader: () => Promise<T>,
  deps: readonly unknown[],
  options: { refreshMs?: number } = {},
): AsyncState<T> {
  const [tick, setTick] = useState(0);
  const loaderRef = useRef(loader);
  loaderRef.current = loader;
  const [state, setState] = useState<Omit<AsyncState<T>, "reload">>({
    data: null,
    error: null,
    offline: false,
    loading: true,
  });

  useEffect(() => {
    let cancelled = false;
    setState((s) => ({ ...s, loading: true }));
    loaderRef
      .current()
      .then((data) => {
        if (!cancelled) setState({ data, error: null, offline: false, loading: false });
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setState((s) => ({
          data: s.data,
          error: e instanceof Error ? e.message : String(e),
          offline: isOfflineError(e),
          loading: false,
        }));
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);

  const reload = useCallback(() => {
    bustCache();
    setTick((t) => t + 1);
  }, []);

  useEffect(() => {
    if (!options.refreshMs) return;
    const id = window.setInterval(() => {
      bustCache();
      setTick((t) => t + 1);
    }, options.refreshMs);
    return () => window.clearInterval(id);
  }, [options.refreshMs]);

  return { ...state, reload };
}
