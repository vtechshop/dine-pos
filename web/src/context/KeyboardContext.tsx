import { createContext, useContext, useRef, useEffect, useCallback } from 'react';
import type { ReactNode } from 'react';

export type ShortcutKey = 'F1' | 'F2' | 'F3' | 'F4' | 'Escape' | 'Enter';
type Handler = () => void;

interface KeyboardContextType {
  /**
   * Register a keyboard shortcut. Returns a cleanup function that deregisters it.
   * Last registration per key wins (modal-last semantics).
   * Escape and Enter work inside inputs; F1–F4 are blocked while an input is focused.
   */
  register(key: ShortcutKey, handler: Handler): () => void;
}

const KeyboardContext = createContext<KeyboardContextType | null>(null);

const F_KEYS: ReadonlySet<string> = new Set(['F1', 'F2', 'F3', 'F4']);

export function KeyboardProvider({ children }: { children: ReactNode }) {
  const registry = useRef(new Map<ShortcutKey, Handler>());

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const key = e.key as ShortcutKey;
      const handler = registry.current.get(key);
      if (!handler) return;

      const target = e.target as HTMLElement;
      const inInput = target.tagName === 'INPUT'
        || target.tagName === 'TEXTAREA'
        || target.isContentEditable;

      // F keys do not fire while user is typing — every other key still fires
      if (F_KEYS.has(key) && inInput) return;

      // Prevent browser default for F1–F4 (help, address bar, search, etc.)
      if (F_KEYS.has(key)) e.preventDefault();

      handler();
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const register = useCallback((key: ShortcutKey, handler: Handler): (() => void) => {
    registry.current.set(key, handler);
    return () => {
      if (registry.current.get(key) === handler) {
        registry.current.delete(key);
      }
    };
  }, []);

  return (
    <KeyboardContext.Provider value={{ register }}>
      {children}
    </KeyboardContext.Provider>
  );
}

export function useKeyboardContext(): KeyboardContextType {
  const ctx = useContext(KeyboardContext);
  if (!ctx) throw new Error('useKeyboardContext must be inside KeyboardProvider');
  return ctx;
}
