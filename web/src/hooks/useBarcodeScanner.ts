import { useEffect, useLayoutEffect, useRef } from 'react';
import type { Product } from '../types';
import { lookupProductByBarcode } from '../api/products';

// USB/Bluetooth barcode scanners type characters very quickly (< 50 ms between
// chars) followed by an Enter or Tab keystroke.  We accumulate a buffer; when
// the scan completes we send the code to the server for a hotel-scoped lookup.

const SCAN_TIMEOUT_MS = 150;  // max ms between chars from a scanner
const MIN_SCAN_LENGTH = 3;    // minimum barcode length to consider

interface UseBarcodeScannersOptions {
  enabled: boolean;
  onProductFound: (product: Product, code: string) => void;
  onUnknownCode:  (code: string) => void;
}

export function useBarcodeScanner({
  enabled,
  onProductFound,
  onUnknownCode,
}: UseBarcodeScannersOptions): void {
  // Stable refs so the event handler never captures stale closures.
  const onProductFoundRef = useRef(onProductFound);
  const onUnknownCodeRef  = useRef(onUnknownCode);

  useLayoutEffect(() => {
    onProductFoundRef.current = onProductFound;
    onUnknownCodeRef.current  = onUnknownCode;
  });

  const bufferRef  = useRef('');
  const lastKeyRef = useRef(0);
  const timerRef   = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Guard: prevent duplicate lookups if scanner fires Enter before timeout
  const lookingUpRef = useRef(false);

  useEffect(() => {
    if (!enabled) return;

    async function flush(code: string) {
      bufferRef.current = '';
      if (code.length < MIN_SCAN_LENGTH) return;
      if (lookingUpRef.current) return;

      const normalized = code.trim().toUpperCase();
      lookingUpRef.current = true;
      try {
        const result = await lookupProductByBarcode(normalized);
        if (result.found) {
          onProductFoundRef.current(result.product, normalized);
        } else {
          onUnknownCodeRef.current(normalized);
        }
      } catch {
        // Network error — treat as unknown so cashier can fall back to search
        onUnknownCodeRef.current(normalized);
      } finally {
        lookingUpRef.current = false;
      }
    }

    function handleKeyDown(e: KeyboardEvent) {
      // Ignore keystrokes in inputs — manual search must not be disrupted
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      const now     = Date.now();
      const elapsed = now - lastKeyRef.current;
      lastKeyRef.current = now;

      if (e.key === 'Enter' || e.key === 'Tab') {
        if (timerRef.current) clearTimeout(timerRef.current);
        void flush(bufferRef.current);
        return;
      }

      // Large gap between keystrokes → human typing, reset buffer
      if (elapsed > SCAN_TIMEOUT_MS && bufferRef.current.length > 0) {
        bufferRef.current = '';
      }

      if (e.key.length === 1) {
        bufferRef.current += e.key;

        // Auto-flush if scanner doesn't send Enter (some scanners don't)
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => {
          if (bufferRef.current.length >= MIN_SCAN_LENGTH) {
            void flush(bufferRef.current);
          } else {
            bufferRef.current = '';
          }
        }, SCAN_TIMEOUT_MS * 2);
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      if (timerRef.current) clearTimeout(timerRef.current);
      bufferRef.current    = '';
      lookingUpRef.current = false;
    };
  }, [enabled]);
}
