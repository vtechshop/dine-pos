import { useState } from 'react';
import { ArrowRightLeft, X } from 'lucide-react';
import type { Guest, SessionSummary } from '../../types';

interface Props {
  guest: Guest;
  currentSessionId: string;
  openSessions: SessionSummary[];
  onConfirm: (targetSessionId: string) => Promise<void>;
  onClose: () => void;
}

export function TransferGuestModal({ guest, currentSessionId, openSessions, onConfirm, onClose }: Props) {
  const [targetSessionId, setTargetSessionId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const candidates = openSessions.filter(s => s._id !== currentSessionId);

  async function handleConfirm() {
    if (!targetSessionId || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onConfirm(targetSessionId);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Transfer failed');
    } finally {
      setBusy(false);
    }
  }

  const target = candidates.find(s => s._id === targetSessionId);

  return (
    <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/60 px-4">
      <div className="w-full max-w-sm rounded-xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
          <div className="flex items-center gap-2 text-gray-800">
            <ArrowRightLeft size={16} className="text-purple-500" />
            <span className="font-semibold text-sm">Transfer Guest</span>
          </div>
          <button onClick={onClose} className="rounded-lg p-1 text-gray-400 hover:bg-gray-100">
            <X size={16} />
          </button>
        </div>

        <div className="px-5 py-4 space-y-4">
          <div className="rounded-lg bg-gray-50 px-3 py-2 text-sm">
            <p className="text-xs text-gray-500 mb-1">Transferring</p>
            <p className="font-medium text-gray-800">{guest.displayLabel}</p>
          </div>

          <div>
            <p className="text-xs font-medium text-gray-500 mb-2">Move to table</p>
            <div className="max-h-52 overflow-y-auto space-y-1.5 pr-1">
              {candidates.length === 0 ? (
                <p className="text-xs text-gray-400 text-center py-4">No other open tables available.</p>
              ) : (
                candidates.map(s => (
                  <button
                    key={s._id}
                    onClick={() => setTargetSessionId(s._id)}
                    className={`w-full flex items-center justify-between rounded-lg border px-3 py-2.5 text-sm transition-colors ${
                      targetSessionId === s._id
                        ? 'border-purple-500 bg-purple-50 text-purple-800'
                        : 'border-gray-200 bg-white text-gray-700 hover:border-gray-300 hover:bg-gray-50'
                    }`}
                  >
                    <span className="font-medium">{s.tableNumber}</span>
                    <span className="text-xs text-gray-500">{s.activeGuestCount} guest{s.activeGuestCount !== 1 ? 's' : ''}</span>
                  </button>
                ))
              )}
            </div>
          </div>

          {target && (
            <div className="rounded-lg border border-purple-200 bg-purple-50 px-3 py-2 text-xs text-purple-700">
              <strong>{guest.displayLabel}</strong> and their orders will move to table{' '}
              <strong>{target.tableNumber}</strong>.
            </div>
          )}

          {error && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{error}</p>
          )}
        </div>

        <div className="flex gap-2 border-t border-gray-100 px-5 py-3">
          <button
            onClick={onClose}
            className="flex-1 rounded-lg border border-gray-200 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={!targetSessionId || busy}
            className="flex-1 rounded-lg bg-purple-600 py-2 text-sm font-medium text-white transition-colors hover:bg-purple-700 disabled:opacity-40"
          >
            {busy ? 'Transferring…' : 'Confirm Transfer'}
          </button>
        </div>
      </div>
    </div>
  );
}
