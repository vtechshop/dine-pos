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
  socket:              Socket | null;
  heartbeat:           ReturnType<typeof setInterval> | null;
  printQueue:          Promise<void>;
  getSettings:         () => Settings | null;
  getErrorCb:          () => ((msg: string) => void) | undefined;
  getNameCb:           () => string | undefined;
  onReconnectFailed:   (() => void) | null;
};

const _state: Record<'kitchen' | 'cashier', RoleState> = {
  kitchen: {
    socket: null, heartbeat: null, printQueue: Promise.resolve(),
    getSettings: () => null, getErrorCb: () => undefined, getNameCb: () => undefined,
    onReconnectFailed: null,
  },
  cashier: {
    socket: null, heartbeat: null, printQueue: Promise.resolve(),
    getSettings: () => null, getErrorCb: () => undefined, getNameCb: () => undefined,
    onReconnectFailed: null,
  },
};

function buildSocket(
  role:     'kitchen' | 'cashier',
  url:      string,
  baseUrl:  string,
  token:    string,
  hotelId:  string,
  deviceId: string,
): Socket {
  const st = _state[role];

  console.log(`[PrinterSocket][${role}] CREATING SOCKET socketUrl=${url} hotelId=${hotelId} tokenPresent=${!!token}`);
  const socket = io(url, {
    transports:           ['websocket'],
    auth:                 { token },
    reconnectionAttempts: 20,
    reconnectionDelay:    3000,
  });
  st.socket = socket;
  console.log(`[PrinterSocket][${role}] Socket instance created — id=${socket.id ?? 'pending'} connected=${socket.connected}`);
  const _eng = (socket.io as any).engine;
  console.log(
    `\n======== ENGINE SNAPSHOT [PrinterSocket][${role}] ========\n` +
    `uri=${(socket.io as any).uri}\n` +
    `transport=${_eng?.transport?.name ?? 'n/a'}\n` +
    `readyState=${_eng?.readyState ?? 'n/a'}\n` +
    `hostname=${_eng?.hostname ?? 'n/a'}\n` +
    `port=${_eng?.port ?? 'n/a'}\n` +
    `secure=${_eng?.secure ?? 'n/a'}\n` +
    `path=${_eng?.path ?? 'n/a'}\n` +
    '========================================================='
  );
  // autoConnect=true: Socket.IO connects internally — no explicit socket.connect() call
  console.log('\n======== EVENTS ========');

  socket.on('connect_error', (err: any) => {
    console.log(
      `\n[PrinterSocket][${role}] EVENT connect_error` +
      `\nmessage=${err?.message}` +
      `\ndescription=${JSON.stringify(err?.description)}` +
      `\ntype=${err?.type}` +
      `\ntransport=${err?.context?.transport?.name ?? 'n/a'}` +
      `\nuri=${(socket.io as any).uri}` +
      `\nsocketId=${socket.id ?? 'none'}` +
      `\nconnected=${socket.connected}`
    );
  });

  socket.on('connect', () => {
    console.log(`[PrinterSocket][${role}] EVENT connect — id=${socket.id} uri=${(socket.io as any).uri}`);
    socket.emit('join_hotel', hotelId);
    console.log(`[PrinterSocket][${role}] join_hotel EMITTED — hotelId=${hotelId} socketId=${socket.id} room=hotel_${hotelId} (no ack)`);
    socket.emit('register_printer', {
      deviceId,
      printerRole: role,
      printerName: st.getNameCb(),
    });
  });

  // Single persistent print_job listener per socket.
  // Reads settings/error callback through module-level accessors so it always
  // uses the latest values even after a screen remount.
  socket.on('print_job', (event: PrintJobEvent) => {
    console.log(`[PrinterSocket][${role}] Print job received — jobId=${event.jobId} type=${event.jobType}`);
    const settings = st.getSettings();
    const makeReport = (errCb: ((msg: string) => void) | undefined) =>
      async (jobId: string, status: 'success' | 'failed', error?: string) => {
        if (status === 'success') {
          console.log(`[PrinterSocket][${role}] Print job success — jobId=${jobId}`);
        } else {
          console.log(`[PrinterSocket][${role}] Print job failed — jobId=${jobId} error=${error}`);
        }
        await reportPrintStatus(jobId, status, error);
        if (status === 'failed' && errCb) {
          // Only surface to UI when the Bluetooth print itself failed — not server events
          errCb(error || 'Print failed. Check Bluetooth connection.');
        }
      };

    if (!settings) {
      console.log(`[PrinterSocket][${role}] Print job deferred — screen not mounted, will retry on reconnect`);
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

  socket.on('disconnect', (reason: string) => {
    console.log(`[PrinterSocket][${role}] EVENT disconnect — reason=${reason}`);
  });

  const onReconnectFailed = () => {
    console.log(`[PrinterSocket][${role}] EVENT reconnect_failed — gave up after 20 attempts. Retrying in 30s.`);
    setTimeout(() => {
      if (st.socket === socket) {
        console.log(`[PrinterSocket][${role}] Retrying — calling socket.connect()`);
        socket.connect();
      }
    }, 30_000);
  };
  st.onReconnectFailed = onReconnectFailed;
  socket.io.on('reconnect_failed', onReconnectFailed);

  socket.io.on('reconnect_attempt', (n: number) => {
    console.log(`[PrinterSocket][${role}] EVENT reconnect_attempt ${n}/20`);
  });

  socket.io.on('reconnect', (n: number) => {
    console.log(`[PrinterSocket][${role}] EVENT reconnect — after ${n} attempt(s)`);
  });

  // Heartbeat every 30 s — server marks device offline if > 60 s stale.
  if (st.heartbeat) clearInterval(st.heartbeat);
  st.heartbeat = setInterval(() => {
    if (socket.connected) {
      console.log(`[PrinterSocket][${role}] Heartbeat sent — ${new Date().toISOString()}`);
      socket.emit('printer_heartbeat');
    }
  }, 30_000);

  console.log(`[PrinterSocket][${role}] All event handlers registered`);
  console.log('\n======== END ========');

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
    st.getNameCb   = () => nameRef.current;

    let cancelled = false;

    (async () => {
      const roleFetcher = printerRole === 'kitchen' ? getKitchenToken
                        : printerRole === 'cashier' ? getCashierToken
                        : getToken;
      const [url, roleToken, adminToken, hotelId, deviceId, baseUrl] = await Promise.all([
        getSocketUrl(),
        roleFetcher(),
        getToken(),
        getStoredHotelId(),
        getOrCreateDeviceId(),
        getBaseUrl(),
      ]);
      const token = roleToken || adminToken;
      const _ts = new Date().toISOString();

      console.log(
        '\n======== SOCKET START ========' +
        `\nRole=${printerRole}` +
        '\nScreen=usePrinterSocket' +
        '\nThread=JS_THREAD' +
        `\nTimestamp=${_ts}` +
        `\nBASE_URL=${baseUrl ?? 'NULL'}` +
        `\nSOCKET_URL=${url ?? 'NULL'}` +
        `\nhotelId=${hotelId ?? 'NULL'}` +
        `\ntokenPresent=${!!token} tokenLength=${token?.length ?? 0}` +
        `\nsocketExists=${!!st.socket} socketConnected=${st.socket?.connected ?? false}` +
        '\nautoConnect=true' +
        "\ntransports=['websocket']" +
        `\ncancelled=${cancelled}` +
        '\n=============================='
      );

      if (cancelled || !url || !hotelId) {
        const _r: string[] = [];
        if (cancelled) _r.push('cancelled=true');
        if (!url) _r.push('url=MISSING');
        if (!hotelId) _r.push('hotelId=NULL');
        console.log(
          '\n======== EARLY RETURN ========' +
          '\nRETURN_BEFORE_SOCKET' +
          `\nreason: ${_r.join(' | ')}` +
          `\nstack: ${new Error('EARLY_RETURN').stack ?? 'unavailable'}` +
          '\n=============================='
        );
        return;
      }

      if (st.socket?.connected) {
        console.log(`[PrinterSocket][${printerRole}] Socket already connected — skipping io() — re-registering printer`);
        st.socket.emit('register_printer', {
          deviceId,
          printerRole,
          printerName: nameRef.current,
        });
        return;
      }

      // Disconnect stale socket before creating a new one
      if (st.socket) {
        console.log(`[PrinterSocket][${printerRole}] Disconnecting stale socket before rebuild`);
        if (st.onReconnectFailed) st.socket.io.off('reconnect_failed', st.onReconnectFailed);
        st.onReconnectFailed = null;
        st.socket.disconnect();
        st.socket = null;
      }

      console.log(`[PrinterSocket][${printerRole}] Calling io()`);
      buildSocket(printerRole, url, baseUrl, token || '', hotelId, deviceId);
      console.log(`[PrinterSocket][${printerRole}] io() call returned — socket instance created`);
      console.log(`[PrinterSocket][${printerRole}] autoConnect=true — socket.connect() NOT called explicitly`);
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
      st.getNameCb   = () => undefined;
    };
  }, []); // socket lifecycle is module-level; only runs once per mount
}
