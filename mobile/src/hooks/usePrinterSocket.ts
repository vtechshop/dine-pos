import { useEffect, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { io, Socket } from 'socket.io-client';
import { useSettings } from '../context/SettingsContext';
import { executePrintJob, PrintJobEvent } from '../services/PrintService';
import { getSocketUrl, getToken, getKitchenToken, getCashierToken, getStoredHotelId, getBaseUrl } from '../services/api';
import type { Settings } from '../types';

const DEVICE_ID_KEY = '@dine_device_id';

async function getOrCreateDeviceId(): Promise<string> {
  const stored = await AsyncStorage.getItem(DEVICE_ID_KEY);
  if (stored) return stored;
  const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  await AsyncStorage.setItem(DEVICE_ID_KEY, id);
  return id;
}

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

// ── Module-level printer socket registry ─────────────────────────────────────
//
// Sockets are created on first use and kept alive across screen unmount/remount
// so the backend PrinterDevice registration stays active and pending KOT/receipt
// jobs can be dispatched at any time, not only while a specific screen is focused.
//
// Per-role accessors (getSettings, getErrorCb) are updated by whichever screen
// instance is currently mounted. When no screen is mounted they return null/undefined,
// causing incoming print_job events to be queued and re-attempted on the next
// reconnect flush rather than silently dropped.

type RoleState = {
  socket:       Socket | null;
  heartbeat:    ReturnType<typeof setInterval> | null;
  printQueue:   Promise<void>;
  getSettings:  () => Settings | null;
  getErrorCb:   () => ((msg: string) => void) | undefined;
};

const _state: Record<'kitchen' | 'cashier', RoleState> = {
  kitchen: {
    socket: null, heartbeat: null, printQueue: Promise.resolve(),
    getSettings: () => null, getErrorCb: () => undefined,
  },
  cashier: {
    socket: null, heartbeat: null, printQueue: Promise.resolve(),
    getSettings: () => null, getErrorCb: () => undefined,
  },
};

function buildSocket(
  role:     'kitchen' | 'cashier',
  url:      string,
  token:    string,
  hotelId:  string,
  deviceId: string,
): Socket {
  const st = _state[role];

  const socket = io(url, {
    transports:           ['websocket'],
    auth:                 { token },
    reconnectionAttempts: 20,
    reconnectionDelay:    3000,
  });
  st.socket = socket;

  socket.on('connect', () => {
    socket.emit('join_hotel', hotelId);
    socket.emit('register_printer', {
      deviceId,
      printerRole: role,
      printerName: undefined,
    });
  });

  // Single persistent print_job listener per socket.
  // Reads settings/error callback through module-level accessors so it always
  // uses the latest values even after a screen remount.
  socket.on('print_job', (event: PrintJobEvent) => {
    const settings = st.getSettings();
    const makeReport = (errCb: ((msg: string) => void) | undefined) =>
      async (jobId: string, status: 'success' | 'failed', error?: string) => {
        await reportPrintStatus(jobId, status, error);
        if (status === 'failed' && errCb) {
          errCb(error || 'Print failed. Check Bluetooth connection.');
        }
      };

    if (!settings) {
      // No screen mounted — report failure immediately so the server can retry
      const report = makeReport(st.getErrorCb());
      st.printQueue = st.printQueue.then(() =>
        report(event.jobId, 'failed', 'Printer screen not active'),
      );
      return;
    }

    const report = makeReport(st.getErrorCb());
    st.printQueue = st.printQueue.then(() =>
      executePrintJob(event, settings, report),
    );
  });

  socket.on('disconnect', () => {
    st.getErrorCb()?.('Printer disconnected. Reconnecting…');
  });

  const onReconnectFailed = () => {
    st.getErrorCb()?.('Printer offline. Retrying connection…');
    // After exhausting reconnection attempts, wait 30 s then restart the cycle
    setTimeout(() => {
      if (st.socket === socket) socket.connect();
    }, 30_000);
  };
  socket.io.on('reconnect_failed', onReconnectFailed);

  // Heartbeat every 30 s — server marks device offline if > 60 s stale
  if (st.heartbeat) clearInterval(st.heartbeat);
  st.heartbeat = setInterval(() => {
    if (socket.connected) socket.emit('printer_heartbeat');
  }, 30_000);

  return socket;
}

// ── Hook: registers this device as a printer and handles print_job events ───────
//
// Call from:
//   KitchenDisplayScreen  →  usePrinterSocket('kitchen')
//   CashierDashboardScreen →  usePrinterSocket('cashier')
//
// The socket survives screen unmount/remount (module-level singleton per role).
// On each mount the hook updates the settings and error-callback accessors and
// re-emits register_printer so the backend always has the latest socketId.

export function usePrinterSocket(
  printerRole:  'kitchen' | 'cashier',
  printerName?: string,
  onPrintError?: (message: string) => void,
): void {
  const { settings }  = useSettings();
  const settingsRef   = useRef(settings);
  const nameRef       = useRef(printerName);
  const onErrorRef    = useRef(onPrintError);

  useEffect(() => { settingsRef.current = settings; }, [settings]);
  useEffect(() => { nameRef.current = printerName; }, [printerName]);
  useEffect(() => { onErrorRef.current = onPrintError; }, [onPrintError]);

  useEffect(() => {
    const st = _state[printerRole];

    // Install accessors for this mount
    st.getSettings = () => settingsRef.current;
    st.getErrorCb  = () => onErrorRef.current;

    let cancelled = false;

    (async () => {
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

      if (st.socket?.connected) {
        // Socket already live — re-register with current printerName
        st.socket.emit('register_printer', {
          deviceId,
          printerRole,
          printerName: nameRef.current,
        });
        return;
      }

      // Disconnect stale socket before creating a new one
      if (st.socket) {
        st.socket.io.off('reconnect_failed');
        st.socket.disconnect();
        st.socket = null;
      }

      buildSocket(printerRole, url, token || '', hotelId, deviceId);
    })();

    return () => {
      cancelled = true;
      // Clear accessors when screen unmounts — print_job events received while
      // offline will be reported as failed so the server queues them for retry.
      // The socket and heartbeat are intentionally NOT disconnected — they keep
      // the PrinterDevice registration alive so new orders can be dispatched
      // immediately without waiting for the screen to remount.
      st.getSettings = () => null;
      st.getErrorCb  = () => undefined;
    };
  }, []); // socket lifecycle is module-level; only runs once per mount
}
