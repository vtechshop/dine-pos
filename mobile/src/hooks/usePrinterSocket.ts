import { useEffect, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { io, Socket } from 'socket.io-client';
import { useSettings } from '../context/SettingsContext';
import { executePrintJob, PrintJobEvent } from '../services/PrintService';
import { getSocketUrl, getToken, getKitchenToken, getCashierToken, getStoredHotelId, getBaseUrl } from '../services/api';

const DEVICE_ID_KEY = '@dine_device_id';

// Reuse the same ID generation pattern used in AdminLoginScreen
async function getOrCreateDeviceId(): Promise<string> {
  const stored = await AsyncStorage.getItem(DEVICE_ID_KEY);
  if (stored) return stored;
  const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  await AsyncStorage.setItem(DEVICE_ID_KEY, id);
  return id;
}

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

// ── Hook: registers this device as a printer and handles print_job events ───────
//
// Call from:
//   KitchenDisplayScreen  →  usePrinterSocket('kitchen')
//   CashierDashboardScreen →  usePrinterSocket('cashier')
//
// On each connect (including reconnects), emits `register_printer` so the backend
// always has the current socketId for targeted dispatch.
// The hook manages its own socket connection; it does NOT share the screen socket.

export function usePrinterSocket(
  printerRole: 'kitchen' | 'cashier',
  printerName?: string,
  onPrintError?: (message: string) => void,
): void {
  const { settings }   = useSettings();
  const settingsRef    = useRef(settings);
  const roleRef        = useRef(printerRole);
  const nameRef        = useRef(printerName);
  const onErrorRef     = useRef(onPrintError);
  const socketRef      = useRef<Socket | null>(null);
  const heartbeatRef   = useRef<ReturnType<typeof setInterval> | null>(null);

  // Keep refs current so event handlers always see latest values
  useEffect(() => { settingsRef.current = settings; }, [settings]);
  useEffect(() => { roleRef.current = printerRole; }, [printerRole]);
  useEffect(() => { nameRef.current = printerName; }, [printerName]);
  useEffect(() => { onErrorRef.current = onPrintError; }, [onPrintError]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      // Prefer role-specific JWT so dedicated kitchen/cashier tablets (where no
      // admin has logged in) can authenticate the printer socket connection.
      const roleFetcher = printerRole === 'kitchen' ? getKitchenToken
                        : printerRole === 'cashier' ? getCashierToken
                        : getToken;
      const [url, roleToken, adminToken, hotelId, deviceId] = await Promise.all([
        getSocketUrl(),
        roleFetcher(),
        getToken(),
        getStoredHotelId(),
        getOrCreateDeviceId(),
      ]);
      const token = roleToken || adminToken;

      if (cancelled || !url || !hotelId) return;

      const socket = io(url, {
        transports:           ['websocket'],
        auth:                 { token: token || '' },
        reconnectionAttempts: 20,
        reconnectionDelay:    3000,
      });
      socketRef.current = socket;

      socket.on('connect', () => {
        socket.emit('join_hotel', hotelId);
        // Register (or re-register on reconnect) so backend has current socketId + heartbeat
        socket.emit('register_printer', {
          deviceId,
          printerRole: roleRef.current,
          printerName: nameRef.current,
        });
      });

      const wrappedReport = async (jobId: string, status: 'success' | 'failed', error?: string) => {
        await reportPrintStatus(jobId, status, error);
        if (status === 'failed' && onErrorRef.current) {
          onErrorRef.current(error || 'Print failed. Check Bluetooth connection.');
        }
      };

      // Serial queue — each job waits for the previous to finish before
      // starting. Bluetooth printers can only handle one connection at a time;
      // concurrent executePrintJob calls cause collisions and print failures.
      let printQueue = Promise.resolve();
      socket.on('print_job', (event: PrintJobEvent) => {
        printQueue = printQueue.then(() =>
          executePrintJob(event, settingsRef.current, wrappedReport),
        );
      });

      socket.on('disconnect', (reason) => {
        if (cancelled) return;
        if (onErrorRef.current) {
          onErrorRef.current(`Printer disconnected: ${reason}. Reconnecting…`);
        }
      });

      // After all reconnection attempts are exhausted, restart the cycle.
      // socket.connect() resets the attempt counter and tries again.
      // Named so we can remove it from the manager on cleanup (avoids leak).
      const onReconnectFailed = () => {
        if (cancelled) return;
        if (onErrorRef.current) {
          onErrorRef.current('Printer offline. Retrying connection…');
        }
        setTimeout(() => {
          if (!cancelled && socketRef.current) {
            socketRef.current.connect();
          }
        }, 30_000);
      };
      socket.io.on('reconnect_failed', onReconnectFailed);

      // Heartbeat every 30 s — server marks device offline if > 60 s stale
      heartbeatRef.current = setInterval(() => {
        if (socketRef.current?.connected) {
          socketRef.current.emit('printer_heartbeat');
        }
      }, 30_000);
    })();

    return () => {
      cancelled = true;
      if (heartbeatRef.current) clearInterval(heartbeatRef.current);
      // Remove manager-level listener before disconnect to prevent memory leak
      socketRef.current?.io?.off('reconnect_failed');
      socketRef.current?.disconnect();
      socketRef.current = null;
    };
  }, []); // socket + heartbeat lifecycle tied to mount/unmount only
}
