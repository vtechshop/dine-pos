import { useEffect, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import { useSettings } from '../context/SettingsContext';
import { executePrintJob, PrintJobEvent } from '../services/PrintService';
import { getSocketUrl, getToken, getStoredHotelId, getBaseUrl } from '../services/api';

// ── Report job result back to backend ──────────────────────────────────────────

async function reportPrintStatus(
  jobId:   string,
  status:  'success' | 'failed',
  error?:  string,
): Promise<void> {
  try {
    const [base, token] = await Promise.all([getBaseUrl(), getToken()]);
    await fetch(`${base}/print-jobs/${jobId}/status`, {
      method:  'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization:  `Bearer ${token || ''}`,
      },
      body: JSON.stringify({ status, errorMessage: error }),
    });
  } catch {
    // Status reporting is best-effort; never blocks the UI
  }
}

// ── Hook: opens a dedicated socket for print_job events ────────────────────────
//
// Usage: call `usePrinterSocket()` inside a screen that should handle print jobs.
// The hook manages its own socket connection — it does NOT share the screen's socket.
//
// Integration points:
//   KitchenDisplayScreen — handles KOT jobs routed to kitchenPrinterAddress
//   CashierDashboardScreen — handles receipt jobs routed to cashierPrinterAddress
//
// If no printer is configured (printerAddress empty), executePrintJob reports
// 'failed' without crashing — the job stays visible in print-jobs dashboard.

export function usePrinterSocket(): void {
  const { settings }   = useSettings();
  const settingsRef    = useRef(settings);
  const socketRef      = useRef<Socket | null>(null);

  // Keep settingsRef current so the event handler always uses the latest settings
  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const [url, token, hotelId] = await Promise.all([
        getSocketUrl(),
        getToken(),
        getStoredHotelId(),
      ]);

      if (cancelled || !url || !hotelId) return;

      const socket = io(url, {
        transports:          ['websocket'],
        auth:                { token: token || '' },
        reconnectionAttempts: 20,
        reconnectionDelay:   3000,
      });
      socketRef.current = socket;

      socket.on('connect', () => {
        socket.emit('join_hotel', hotelId);
      });

      socket.on('print_job', async (event: PrintJobEvent) => {
        await executePrintJob(
          event,
          settingsRef.current,
          reportPrintStatus,
        );
      });
    })();

    return () => {
      cancelled = true;
      socketRef.current?.disconnect();
      socketRef.current = null;
    };
  }, []); // intentionally empty — socket lifecycle is independent of re-renders
}
