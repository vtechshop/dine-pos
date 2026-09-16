import { useState, useEffect, useCallback } from 'react';

export type ConnectivityStatus = 'ONLINE' | 'OFFLINE' | 'CHECKING' | 'DEGRADED';

const HEALTH_URL = `${import.meta.env.VITE_API_URL ?? 'http://localhost:5000/api'}/health/live`;
export const HEALTH_CHECK_TIMEOUT_MS = 5_000;

/**
 * Probes the backend health endpoint. Returns true only when it responds 2xx within the timeout.
 * Uses a plain fetch (no auth headers, no retry) so it works even before the user is signed in.
 */
export async function checkBackendHealth(): Promise<boolean> {
  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), HEALTH_CHECK_TIMEOUT_MS);
  try {
    const res = await fetch(HEALTH_URL, { method: 'GET', signal: controller.signal });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(tid);
  }
}

/**
 * Pure state machine: given the browser's online flag and the last health-probe result, derive
 * a four-level connectivity status. Exported for testing.
 */
export function deriveConnectivityStatus(
  browserOnline: boolean,
  backendHealthy: boolean | null,
): ConnectivityStatus {
  if (!browserOnline) return 'OFFLINE';
  if (backendHealthy === null) return 'CHECKING';
  return backendHealthy ? 'ONLINE' : 'DEGRADED';
}

/**
 * Reactive connectivity status that distinguishes a live backend (ONLINE) from a reachable
 * browser but unreachable backend (DEGRADED). Probes on mount, on the online event, on tab
 * visibility change, and on window focus — no polling.
 */
export function useConnectivity(): ConnectivityStatus {
  const [browserOnline, setBrowserOnline] = useState<boolean>(
    () => (typeof navigator === 'undefined' ? true : navigator.onLine),
  );
  const [backendHealthy, setBackendHealthy] = useState<boolean | null>(null);

  const probe = useCallback(async () => {
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      setBackendHealthy(null);
      return;
    }
    setBackendHealthy(null); // briefly CHECKING
    const healthy = await checkBackendHealth();
    setBackendHealthy(healthy);
  }, []);

  useEffect(() => {
    const handleOnline  = () => { setBrowserOnline(true);  void probe(); };
    const handleOffline = () => { setBrowserOnline(false); setBackendHealthy(null); };
    const handleVisible = () => { if (!document.hidden) void probe(); };
    const handleFocus   = () => void probe();

    window.addEventListener('online',  handleOnline);
    window.addEventListener('offline', handleOffline);
    document.addEventListener('visibilitychange', handleVisible);
    window.addEventListener('focus', handleFocus);
    void probe();

    return () => {
      window.removeEventListener('online',  handleOnline);
      window.removeEventListener('offline', handleOffline);
      document.removeEventListener('visibilitychange', handleVisible);
      window.removeEventListener('focus', handleFocus);
    };
  }, [probe]);

  return deriveConnectivityStatus(browserOnline, backendHealthy);
}
