import { useState } from 'react';
import { GitMerge, X } from 'lucide-react';
import type { Guest } from '../../types';

interface Props {
  sourceGuest: Guest;
  activeGuests: Guest[];
  onConfirm: (targetId: string) => Promise<void>;
  onClose: () => void;
}

export function MergeGuestModal({ sourceGuest, activeGuests, onConfirm, onClose }: Props) {
  const [targetId, setTargetId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const targets = activeGuests.filter(g => g._id !== sourceGuest._id && g.status === 'active');
  const target = targets.find(g => g._id === targetId);

  async function handleConfirm() {
    if (!targetId || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onConfirm(targetId);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Merge failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/60 px-4">
      <div className="w-full max-w-sm rounded-xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
          <div className="flex items-center gap-2 text-gray-800">
            <GitMerge size={16} className="text-[#E8380D]" />
            <span className="font-semibold text-sm">Merge Guest</span>
          </div>
          <button onClick={onClose} className="rounded-lg p-1 text-gray-400 hover:bg-gray-100">
            <X size={16} />
          </button>
        </div>

        <div className="px-5 py-4 space-y-4">
          <div className="rounded-lg bg-gray-50 px-3 py-2 text-sm">
            <p className="text-xs text-gray-500 mb-1">Moving orders from</p>
            <p className="font-medium text-gray-800">{sourceGuest.displayLabel}</p>
          </div>

          <div>
            <p className="text-xs font-medium text-gray-500 mb-2">Merge into</p>
            <div className="space-y-1.5">
              {targets.length === 0 ? (
                <p className="text-xs text-gray-400 text-center py-2">No other active guests to merge into.</p>
              ) : (
                targets.map(g => (
                  <button
                    key={g._id}
                    onClick={() => setTargetId(g._id)}
                    className={`w-full flex items-center justify-between rounded-lg border px-3 py-2.5 text-sm transition-colors ${
                      targetId === g._id
                        ? 'border-[#E8380D] bg-[#E8380D]/5 text-[#1C0800]'
                        : 'border-gray-200 bg-white text-gray-700 hover:border-gray-300 hover:bg-gray-50'
                    }`}
                  >
                    <span className="font-medium">{g.displayLabel}</span>
                    <span className="text-xs text-gray-500">₹{g.totalAmount.toFixed(2)}</span>
                  </button>
                ))
              )}
            </div>
          </div>

          {target && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
              All orders from <strong>{sourceGuest.displayLabel}</strong> will move to{' '}
              <strong>{target.displayLabel}</strong>. This cannot be undone.
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
            disabled={!targetId || busy}
            className="flex-1 rounded-lg bg-[#E8380D] py-2 text-sm font-medium text-white transition-colors hover:bg-[#E8380D]/90 disabled:opacity-40"
          >
            {busy ? 'Merging…' : 'Confirm Merge'}
          </button>
        </div>
      </div>
    </div>
  );
}
