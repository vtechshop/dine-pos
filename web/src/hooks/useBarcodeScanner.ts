import { useEffect, useLayoutEffect, useRef } from 'react';
import type { Product } from '../types';

// USB barcode scanners type characters very quickly (< 50ms between chars)
// followed by an Enter or Tab keystroke. We accumulate a buffer, and if
// the overall scan completes within SCAN_TIMEOUT_MS, treat it as a barcode.

const SCAN_TIMEOUT_MS = 150; // max ms between chars in a barcode scan
const MIN_SCAN_LENGTH = 3;   // minimum barcode length to consider

interface UseBarcodeScannersOptions {
  products: Product[];
  enabled: boolean;
  onProductFound: (product: Product, code: string) => void;
  onUnknownCode: (code: string) => void;
}

export function useBarcodeScanner({
  products,
  enabled,
  onProductFound,
  onUnknownCode,
}: UseBarcodeScannersOptions): void {
  // Keep latest versions of props in refs so the event handler never goes stale.
  // useLayoutEffect (not render body) so react-hooks/refs is satisfied.
  const onProductFoundRef = useRef(onProductFound);
  const onUnknownCodeRef  = useRef(onUnknownCode);
  const productsRef       = useRef(products);

  useLayoutEffect(() => {
    onProductFoundRef.current = onProductFound;
    onUnknownCodeRef.current  = onUnknownCode;
    productsRef.current       = products;
  });

  const bufferRef  = useRef('');
  const lastKeyRef = useRef(0);
  const timerRef   = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!enabled) return;

    function flush(code: string) {
      bufferRef.current = '';
      if (code.length < MIN_SCAN_LENGTH) return;

      const trimmed = code.trim().toUpperCase();
      const match = productsRef.current.find(
        p => p.shortCode && p.shortCode.toUpperCase() === trimmed,
      );

      if (match) {
        onProductFoundRef.current(match, trimmed);
      } else {
        onUnknownCodeRef.current(trimmed);
      }
    }

    function handleKeyDown(e: KeyboardEvent) {
      // Ignore if user is typing in an input/textarea/select
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      const now     = Date.now();
      const elapsed = now - lastKeyRef.current;
      lastKeyRef.current = now;

      if (e.key === 'Enter' || e.key === 'Tab') {
        if (timerRef.current) clearTimeout(timerRef.current);
        flush(bufferRef.current);
        return;
      }

      // If gap is too large, reset buffer (user is typing, not scanning)
      if (elapsed > SCAN_TIMEOUT_MS && bufferRef.current.length > 0) {
        bufferRef.current = '';
      }

      // Only accumulate printable single chars
      if (e.key.length === 1) {
        bufferRef.current += e.key;

        // Auto-flush if no Enter received within timeout
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => {
          if (bufferRef.current.length >= MIN_SCAN_LENGTH) {
            flush(bufferRef.current);
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
      bufferRef.current = '';
    };
  }, [enabled]);
}
