import { useEffect, useRef } from 'react';
import { useKeyboardContext, type ShortcutKey } from '../context/KeyboardContext';

/**
 * Register a keyboard shortcut for the lifetime of the calling component.
 *
 * Uses last-registration-wins semantics, so a modal that registers Escape
 * will capture it before the parent that also registered Escape.
 *
 * @param key     - The shortcut key to listen for.
 * @param handler - Callback invoked when the key fires. Stable ref — safe to
 *                  pass an inline arrow function without useCallback.
 * @param enabled - Set to false to temporarily disable without unmounting.
 */
export function useShortcut(
  key: ShortcutKey,
  handler: () => void,
  enabled = true,
): void {
  const { register } = useKeyboardContext();
  const handlerRef   = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    if (!enabled) return;
    return register(key, () => handlerRef.current());
  }, [key, register, enabled]);
}
