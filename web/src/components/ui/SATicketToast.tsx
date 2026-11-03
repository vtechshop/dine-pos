import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { LifeBuoy, X } from 'lucide-react';
import { useSATickets } from '../../context/SATicketsContext';
import type { SupportTicket } from '../../api/saTickets';

const DISMISS_MS = 8000;

/** Bottom-right pop-up when a hotel opens a ticket or replies to one. */
export function SATicketToast() {
  const { latestNew } = useSATickets();
  const navigate = useNavigate();
  const [shown, setShown]     = useState<SupportTicket | null>(null);
  const [visible, setVisible] = useState(false);
  const lastKey = useRef('');
  const timer   = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!latestNew) return;
    const key = `${latestNew._id}:${latestNew.replies.length}`;
    if (key === lastKey.current) return;
    lastKey.current = key;
    setShown(latestNew);
    setVisible(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setVisible(false), DISMISS_MS);
  }, [latestNew]);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  if (!visible || !shown) return null;
  const isReply = shown.replies.length > 0;

  return (
    <div
      role="alert"
      aria-live="polite"
      onClick={() => { navigate(`/super-admin/tickets?id=${shown._id}`); setVisible(false); }}
      className="fixed bottom-24 right-5 z-[9999] w-80 cursor-pointer overflow-hidden rounded-xl border border-red-200 bg-canvas shadow-2xl"
    >
      <div className="flex items-start gap-3 p-4">
        <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-red-50">
          <LifeBuoy size={15} className="text-red-600" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-bold uppercase tracking-widest text-red-600/80">
            {isReply ? 'Hotel replied' : 'New support ticket'}
          </p>
          <p className="mt-0.5 truncate text-sm font-semibold text-ink">{shown.subject}</p>
          <p className="mt-0.5 truncate text-[11px] text-ink/55">{shown.hotelName} · {shown.hotelPhone}</p>
          <p className="mt-1 text-[10px] text-brand">Open ticket →</p>
        </div>
        <button
          type="button"
          onClick={e => { e.stopPropagation(); setVisible(false); }}
          aria-label="Dismiss"
          className="shrink-0 rounded p-0.5 text-ink/30 hover:text-ink/60"
        >
          <X size={13} />
        </button>
      </div>
    </div>
  );
}
