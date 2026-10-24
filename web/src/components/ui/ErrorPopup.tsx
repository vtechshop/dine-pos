import { useEffect } from 'react';
import { AlertCircle, X } from 'lucide-react';

interface Props {
  message: string | null;
  onClose: () => void;
  /** Auto-dismiss after this many ms (0 = stay until closed). */
  autoHideMs?: number;
}

/**
 * Floating error popup, pinned to the top of the screen so it's seen even when
 * the form is scrolled to the Save button at the bottom.
 */
export function ErrorPopup({ message, onClose, autoHideMs = 6000 }: Props) {
  useEffect(() => {
    if (!message || !autoHideMs) return;
    const t = setTimeout(onClose, autoHideMs);
    return () => clearTimeout(t);
  }, [message, autoHideMs, onClose]);

  if (!message) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 top-4 z-[70] flex justify-center px-4">
      <div
        role="alert"
        className="pointer-events-auto flex w-full max-w-md items-start gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 shadow-xl"
      >
        <AlertCircle size={18} className="mt-0.5 shrink-0 text-red-600" />
        <p className="flex-1 text-sm font-medium text-red-700">{message}</p>
        <button
          onClick={onClose}
          aria-label="Dismiss"
          className="shrink-0 rounded-md p-0.5 text-red-400 hover:bg-red-100 hover:text-red-600"
        >
          <X size={16} />
        </button>
      </div>
    </div>
  );
}
