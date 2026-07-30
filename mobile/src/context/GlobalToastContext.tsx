import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';

export type ToastSeverity = 'info' | 'success' | 'warning' | 'error';

export interface ToastEvent {
  icon: string;
  severity: ToastSeverity;
  title: string;
  body?: string;
}

interface DispatchCtx {
  showToast: (event: ToastEvent, durationMs?: number) => void;
  dismissToast: () => void;
}

const ToastDispatch = createContext<DispatchCtx>({ showToast: () => {}, dismissToast: () => {} });
export const ToastState = createContext<ToastEvent | null>(null);

export function GlobalToastProvider({ children }: { children: React.ReactNode }) {
  const [toast, setToast] = useState<ToastEvent | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((event: ToastEvent, durationMs = 5000) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setToast(event);
    timerRef.current = setTimeout(() => setToast(null), durationMs);
  }, []);

  const dismissToast = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setToast(null);
  }, []);

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  return (
    <ToastDispatch.Provider value={{ showToast, dismissToast }}>
      <ToastState.Provider value={toast}>
        {children}
      </ToastState.Provider>
    </ToastDispatch.Provider>
  );
}

export function useGlobalToast(): DispatchCtx {
  return useContext(ToastDispatch);
}

export function useToastState(): ToastEvent | null {
  return useContext(ToastState);
}
