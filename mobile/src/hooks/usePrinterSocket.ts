import { useEffect, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { io, Socket } from 'socket.io-client';
import { useSettings } from '../context/SettingsContext';
import { executePrintJob, PrintJobEvent } from '../services/PrintService';
import { getSocketUrl, getToken, getStoredHotelId, getBaseUrl } from '../services/api';

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

export function usePrinterSocket(printerRole: 'kitchen' | 'cashier'): void {
  const { settings } = useSettings();
  const settingsRef  = useRef(settings);
  const roleRef      = useRef(printerRole);
  const socketRef    = useRef<Socket | null>(null);

  // Keep refs current so event handlers always see latest values
  useEffect(() => { settingsRef.current = settings; }, [settings]);
  useEffect(() => { roleRef.current = printerRole; }, [printerRole]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const [url, token, hotelId, deviceId] = await Promise.all([
        getSocketUrl(),
        getToken(),
        getStoredHotelId(),
        getOrCreateDeviceId(),
      ]);

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
        // Register this device for its printer role on every connect/reconnect
        // so the backend always has the current socketId
        socket.emit('register_printer', {
          deviceId,
          printerRole: roleRef.current,
        });
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
  }, []); // socket lifecycle is mount/unmount only; role changes update via roleRef
}
