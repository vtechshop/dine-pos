import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchIntegrations } from '../../api/aggregator';
import type { AggregatorIntegration, AggregatorPlatform } from '../../api/aggregator';
import { useSocket } from '../../context/SocketContext';

const LABELS: Record<AggregatorPlatform, string> = {
  swiggy: 'Swiggy',
  zomato: 'Zomato',
};

const REFRESH_MS = 60_000;

type Status = 'online' | 'offline' | 'error';

// Backend only knows integration state (enabled + connectionStatus), not
// whether the store is open on the platform's own app.
function statusOf(i: AggregatorIntegration): { status: Status; hint: string } {
  if (!i.enabled)                        return { status: 'offline', hint: 'Integration disabled' };
  if (i.connectionStatus === 'connected') return { status: 'online',  hint: 'Connected — receiving orders' };
  if (i.connectionStatus === 'error')     return { status: 'error',   hint: i.lastTestMessage || 'Connection error' };
  return { status: 'offline', hint: 'Enabled but not connected' };
}

const DOT: Record<Status, string> = {
  online:  'bg-emerald-400',
  offline: 'bg-white/30',
  error:   'bg-red-500',
};

const TEXT: Record<Status, string> = {
  online:  'text-emerald-300',
  offline: 'text-white/40',
  error:   'text-red-400',
};

/** Swiggy / Zomato connection pills for the top bar. Admin-only, aggregator feature only. */
export function PlatformStatus() {
  const navigate = useNavigate();
  const { socket } = useSocket();
  const [integrations, setIntegrations] = useState<AggregatorIntegration[]>([]);

  const load = useCallback(() => {
    fetchIntegrations()
      .then(r => setIntegrations(r.integrations))
      .catch(() => { /* keep last known state */ });
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, REFRESH_MS);
    return () => clearInterval(t);
  }, [load]);

  // An incoming webhook order flips connectionStatus to 'connected' server-side.
  useEffect(() => {
    if (!socket) return;
    socket.on('new_delivery_order', load);
    return () => { socket.off('new_delivery_order', load); };
  }, [socket, load]);

  if (integrations.length === 0) return null;

  return (
    <div className="mr-1 hidden items-center gap-1 md:flex">
      {integrations.map(i => {
        const { status, hint } = statusOf(i);
        const label = LABELS[i.platform] ?? i.platform;
        return (
          <button
            key={i.platform}
            type="button"
            onClick={() => navigate('/integrations')}
            title={`${label}: ${hint}`}
            className="flex items-center gap-1.5 rounded-full bg-white/[0.06] px-2.5 py-1 text-[11px] font-medium text-white/75 transition-colors hover:bg-white/[0.12]"
          >
            <span className={`h-1.5 w-1.5 rounded-full ${DOT[status]}`} />
            {label}
            <span className={`font-semibold ${TEXT[status]}`}>
              {status === 'online' ? 'Online' : status === 'error' ? 'Error' : 'Offline'}
            </span>
          </button>
        );
      })}
    </div>
  );
}
