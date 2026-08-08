import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { CalendarCheck, User, X } from 'lucide-react';
import { useLeadNotifications } from '../../context/LeadNotificationContext';
import type { ActivityFeedItem } from '../../context/LeadNotificationContext';

const DISMISS_MS = 6000;

export function LeadToast() {
  const { activityFeed }                           = useLeadNotifications();
  const [current, setCurrent]                      = useState<ActivityFeedItem | null>(null);
  const [visible,  setVisible]                     = useState(false);
  const seenIdRef  = useRef<string>('');
  const timerRef   = useRef<ReturnType<typeof setTimeout> | null>(null);
  const navigate   = useNavigate();

  useEffect(() => {
    const latest = activityFeed[0];
    if (!latest || latest.id === seenIdRef.current) return;

    seenIdRef.current = latest.id;
    setCurrent(latest);
    setVisible(true);

    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setVisible(false), DISMISS_MS);
  }, [activityFeed]);

  useEffect(() => {
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, []);

  if (!visible || !current) return null;

  const isDemo  = current.lead.source === 'website_demo';
  const label   = isDemo ? 'Demo Request' : 'Contact Form';
  const Icon    = isDemo ? CalendarCheck : User;
  const iconBg  = isDemo ? 'bg-brand/10' : 'bg-green-100';
  const iconCls = isDemo ? 'text-brand'  : 'text-green-600';

  return (
    <div
      role="alert"
      aria-live="polite"
      onClick={() => { navigate('/super-admin/leads'); setVisible(false); }}
      className="fixed bottom-5 right-5 z-[9999] w-72 cursor-pointer overflow-hidden rounded-xl border border-border bg-canvas shadow-2xl transition-all hover:shadow-brand/10"
    >
      <div className="flex items-start gap-3 p-4">
        <div className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${iconBg}`}>
          <Icon size={14} className={iconCls} />
        </div>

        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-bold uppercase tracking-widest text-ink/40">{label}</p>
          <p className="mt-0.5 truncate text-sm font-semibold text-ink">
            {current.lead.companyName || current.lead.ownerName}
          </p>
          {current.lead.phone && (
            <p className="mt-0.5 text-[11px] text-ink/50">{current.lead.phone}</p>
          )}
          <p className="mt-1 text-[10px] text-brand">View in Sales CRM →</p>
        </div>

        <button
          onClick={e => { e.stopPropagation(); setVisible(false); }}
          aria-label="Dismiss"
          className="shrink-0 rounded p-0.5 text-ink/30 hover:text-ink/60"
        >
          <X size={13} />
        </button>
      </div>

      {/* Progress bar */}
      <div className="h-0.5 w-full bg-mist">
        <div
          className="h-full bg-brand"
          style={{ animation: `lead-toast-shrink ${DISMISS_MS}ms linear forwards` }}
        />
      </div>

      <style>{`
        @keyframes lead-toast-shrink {
          from { width: 100%; }
          to   { width: 0%; }
        }
      `}</style>
    </div>
  );
}
