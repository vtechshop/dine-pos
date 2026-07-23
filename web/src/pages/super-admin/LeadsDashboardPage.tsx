// M8 — Lead Dashboard Widgets + M11 Activity Feed
// LIVE: getLeadStats() + socket activity feed via LeadNotificationContext

import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import {
  Users, TrendingUp, Calendar, CheckCircle, XCircle, Clock, Zap, Activity, Bell,
} from 'lucide-react';
import {
  SAPageHeader, SAStat, SASpin, SAError, SABadge, fmtAgo,
} from '../../components/ui/SAShared';
import { getLeadStats, type LeadStats } from '../../api/saLeads';
import { useLeadNotifications, requestLeadNotificationPermission } from '../../context/LeadNotificationContext';

function SocketDot({ connected }: { connected: boolean }) {
  return (
    <span className={`inline-block h-2 w-2 rounded-full ${connected ? 'bg-green-500' : 'bg-amber-400'}`} title={connected ? 'Live' : 'Connecting…'} />
  );
}

export function LeadsDashboardPage() {
  const [stats,   setStats]   = useState<LeadStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');
  const [notifPerm, setNotifPerm] = useState<NotificationPermission>(
    'Notification' in window ? Notification.permission : 'denied',
  );

  const { connected, activityFeed, unreadCount, clearUnread } = useLeadNotifications();

  const enableNotifications = useCallback(async () => {
    const perm = await requestLeadNotificationPermission();
    setNotifPerm(perm);
  }, []);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const s = await getLeadStats();
      setStats(s);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load stats');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (unreadCount > 0) { void load(); clearUnread(); } }, [unreadCount, load, clearUnread]);

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <SAPageHeader
        title="Sales CRM"
        sub="Lead dashboard · activity feed · conversion tracking"
        onRefresh={() => void load()}
        refreshing={loading}
        action={
          <div className="flex items-center gap-3">
            {notifPerm === 'default' && (
              <button
                onClick={enableNotifications}
                className="flex items-center gap-1.5 rounded-lg border border-border bg-canvas px-3 py-1.5 text-xs font-medium text-ink/70 hover:bg-mist transition"
              >
                <Bell size={12} />
                Enable Notifications
              </button>
            )}
            <span className="flex items-center gap-1.5 text-xs text-ink/50">
              <SocketDot connected={connected} />
              {connected ? 'Live' : 'Connecting…'}
            </span>
          </div>
        }
      />

      <div className="flex-1 overflow-y-auto px-8 py-6 space-y-8">
        {error && <SAError message={error} onRetry={() => void load()} />}

        {loading ? <SASpin /> : stats && (
          <>
            {/* M8 — Widgets */}
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-ink/40 mb-3">Overview</p>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <SAStat label="Today" value={stats.todayCount} icon={<Calendar size={16} />} />
                <SAStat label="This Week" value={stats.weekCount} icon={<TrendingUp size={16} />} />
                <SAStat label="This Month" value={stats.monthCount} icon={<Users size={16} />} />
                <SAStat label="Total" value={stats.totalCount} icon={<Activity size={16} />} />
              </div>
            </div>

            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-ink/40 mb-3">Pipeline</p>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <SAStat label="Pending Follow-ups" value={stats.pendingCount} icon={<Clock size={16} />} warn={stats.pendingCount > 0} />
                <SAStat label="Won" value={stats.wonCount} icon={<CheckCircle size={16} />} accent={stats.wonCount > 0} />
                <SAStat label="Lost" value={stats.lostCount} icon={<XCircle size={16} />} />
                <SAStat label="Conversion Rate" value={`${stats.conversionRate}%`} icon={<Zap size={16} />} accent />
              </div>
            </div>

            {/* Quick links */}
            <div className="flex flex-wrap gap-3">
              {[
                { to: '/super-admin/leads',         label: 'All Leads' },
                { to: '/super-admin/leads/demos',    label: 'Demo Requests' },
                { to: '/super-admin/leads/followups',label: 'Follow Ups' },
                { to: '/super-admin/leads/pipeline', label: 'Pipeline View' },
              ].map(({ to, label }) => (
                <Link
                  key={to}
                  to={to}
                  className="px-4 py-2 rounded-lg border border-border bg-canvas text-sm font-medium text-ink/70 hover:bg-mist hover:text-ink transition"
                >
                  {label}
                </Link>
              ))}
            </div>
          </>
        )}

        {/* M11 — Live Activity Feed */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs font-bold uppercase tracking-wider text-ink/40">Live Activity Feed</p>
            {unreadCount > 0 && (
              <SABadge label={`${unreadCount} new`} variant="blue" />
            )}
          </div>

          {activityFeed.length === 0 ? (
            <div className="rounded-xl border border-border bg-canvas p-8 text-center">
              <Activity size={24} className="mx-auto mb-2 text-ink/20" />
              <p className="text-sm text-ink/40">Waiting for new leads…</p>
              <p className="text-xs text-ink/30 mt-1">
                {connected ? 'Connected — new leads will appear here instantly' : 'Connecting to live feed…'}
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {activityFeed.map(item => (
                <Link
                  key={item.id + item.ts}
                  to={`/super-admin/leads/${item.lead._id}`}
                  className="flex items-center gap-3 rounded-xl border border-border bg-canvas px-4 py-3 hover:bg-mist transition"
                >
                  <div className="h-8 w-8 rounded-full bg-brand/10 flex items-center justify-center shrink-0">
                    <Users size={14} className="text-brand" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-ink truncate">{item.message}</p>
                    <p className="text-xs text-ink/40">{item.lead.phone} · {item.lead.city || item.lead.email}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <SABadge
                      label={item.lead.priority}
                      variant={item.lead.priority === 'high' ? 'red' : item.lead.priority === 'medium' ? 'amber' : 'gray'}
                    />
                    <span className="text-xs text-ink/40 whitespace-nowrap">{fmtAgo(item.ts)}</span>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
