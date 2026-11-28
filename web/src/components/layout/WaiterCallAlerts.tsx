import { useEffect, useState } from 'react';
import { BellRing, X } from 'lucide-react';
import { useSocket } from '../../context/SocketContext';

// Phase 5 · Batch 4 (P4-QR-14): a QR guest's "Call waiter" request reaches the web POS.
// The server already sends `new_message` to the hotel's staff room; the web app had no
// listener. Each request stays on screen until a staff member dismisses it.

interface WaiterCall {
  id:          string;
  tableNumber: string;
  text:        string;
  at:          string;
}

interface ChatPayload {
  _id?:         string;
  tableNumber?: string;
  sender?:      string;
  message?:     string;
  createdAt?:   string;
}

const MAX_SHOWN = 5;

export function WaiterCallAlerts() {
  const { socket } = useSocket();
  const [calls, setCalls] = useState<WaiterCall[]>([]);

  useEffect(() => {
    if (!socket) return;
    const onMessage = (m: ChatPayload) => {
      if (m?.sender !== 'customer' || !m.tableNumber) return;
      const text = String(m.message ?? '').replace(/^\[Waiter Request\]\s*/, '').trim() || 'Needs assistance';
      const call: WaiterCall = {
        id:          String(m._id ?? `${m.tableNumber}-${Date.now()}`),
        tableNumber: String(m.tableNumber),
        text,
        at:          m.createdAt ?? new Date().toISOString(),
      };
      setCalls(prev => (prev.some(c => c.id === call.id) ? prev : [call, ...prev].slice(0, MAX_SHOWN)));
    };
    socket.on('new_message', onMessage);
    return () => { socket.off('new_message', onMessage); };
  }, [socket]);

  if (calls.length === 0) return null;

  return (
    <div className="pointer-events-none fixed right-4 top-16 z-[60] flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2" aria-live="assertive">
      {calls.map(c => (
        <div key={c.id} role="alert" className="pointer-events-auto flex items-start gap-3 rounded-xl border border-amber-300 bg-amber-50 p-3 shadow-lg">
          <BellRing size={18} className="mt-0.5 flex-shrink-0 text-amber-600" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-amber-900">Waiter call · Table {c.tableNumber}</p>
            <p className="text-sm text-amber-800">{c.text}</p>
            <p className="mt-0.5 text-xs text-amber-700/70">
              {new Date(c.at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setCalls(prev => prev.filter(x => x.id !== c.id))}
            className="rounded p-1 text-amber-700 hover:bg-amber-100"
            aria-label={`Dismiss waiter call from table ${c.tableNumber}`}
          >
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}
