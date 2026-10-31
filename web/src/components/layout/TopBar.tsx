import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Hotel, LogOut, User, Menu } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useSocket } from '../../context/SocketContext';
import { useSettings } from '../../context/SettingsContext';
import { NotificationBell } from '../ui/NotificationBell';
import { PlatformStatus } from './PlatformStatus';
import { GlobalSearch } from './GlobalSearch';
import { BroadcastBell } from '../ui/BroadcastBell';
import { LiveBadge } from '../ui/LiveBadge';
import { TrialBanner } from './TrialBanner';

export function TopBar({ onMenuClick }: { onMenuClick?: () => void }) {
  const { hotelName, logout, role } = useAuth();
  const { connected, reconnecting } = useSocket();
  const { settings } = useSettings();
  const aggregatorEnabled = !!settings?.features?.aggregator;
  const [confirmLogout, setConfirmLogout] = useState(false);

  const roleLabel = role
    ? role.charAt(0).toUpperCase() + role.slice(1)
    : 'Admin';

  return (
    <>
      <header className="flex h-14 shrink-0 items-center justify-between gap-2 border-b border-border bg-canvas px-3 sm:px-5">
        {/* Brand — on phones: logo + hotel name only, so the right-hand controls fit */}
        <div className="flex min-w-0 items-center gap-1.5 sm:gap-2.5">
          {/* Hamburger — mobile only */}
          <button
            onClick={onMenuClick}
            aria-label="Open navigation"
            className="rounded-lg p-1.5 text-ink/50 hover:bg-mist hover:text-ink md:hidden"
          >
            <Menu size={18} />
          </button>

          {/* Brand → home ("/" redirects to each role's start page) */}
          <Link
            to="/"
            aria-label="Go to home"
            className="flex min-w-0 items-center gap-2 rounded-lg transition-opacity hover:opacity-80 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/60 sm:gap-2.5"
          >
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-brand">
              <Hotel size={14} className="text-white" />
            </div>
            <span className={`whitespace-nowrap text-base font-bold tracking-tight text-ink ${hotelName ? 'hidden sm:inline' : ''}`}>Dine POS</span>
            {hotelName && (
              <>
                <span className="hidden text-ink/25 sm:inline">/</span>
                <span className="min-w-0 truncate text-sm font-medium text-ink/85 sm:max-w-48 sm:font-normal sm:text-ink/65" title={hotelName}>{hotelName}</span>
              </>
            )}
          </Link>
        </div>

        {/* Pages can portal a compact toolbar here (the cashier screen puts its KPI strip here) */}
        {/* Wide screens only — the cashier screen uses it from 1024px up */}
        <div id="topbar-page-slot" className="hidden min-w-0 flex-1 items-center px-4 lg:flex" />

        {/* Right controls */}
        <div className="flex shrink-0 items-center gap-0.5 sm:gap-1">
          {/* Global search — reservations / orders / customers / tables (admin-only API) */}
          {role === 'admin' && <div className="mr-2"><GlobalSearch /></div>}

          {/* Swiggy / Zomato status — integrations API is admin-only + feature-gated */}
          {role === 'admin' && aggregatorEnabled && <PlatformStatus />}

          {/* Free-trial days left (was a full-width banner) */}
          <TrialBanner />

          {/* Notification bell — live orders (all roles) */}
          <NotificationBell />
          {/* Broadcast bell — SA announcements (admin only) */}
          {role === 'admin' && <BroadcastBell />}

          {/* Socket status badge */}
          <div className="mx-1 sm:mx-2">
            {connected ? (
              <LiveBadge label="Live" />
            ) : reconnecting ? (
              <span className="animate-pulse rounded-full bg-amber-500 px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest text-white">
                Reconnecting
              </span>
            ) : (
              <span className="rounded-full bg-mist px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest text-ink/45">
                Offline
              </span>
            )}
          </div>

          <div className="h-4 w-px bg-border" />

          {/* User / sign-out */}
          <div className="flex items-center gap-1.5 pl-1">
            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-brand/20 ring-1 ring-brand/30">
              <User size={13} className="text-brand" />
            </div>
            <span className="hidden text-sm text-ink/70 sm:block">{roleLabel}</span>
            <button
              data-testid="logout-btn"
              onClick={() => setConfirmLogout(true)}
              aria-label="Sign out"
              className="ml-1 rounded-lg p-1.5 text-ink/45 transition-colors hover:bg-mist hover:text-ink"
            >
              <LogOut size={15} />
            </button>
          </div>
        </div>
      </header>

      {/* Logout confirmation */}
      {confirmLogout && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-72 rounded-2xl bg-canvas p-6 shadow-2xl">
            <h3 className="text-base font-bold text-ink mb-1">Sign out?</h3>
            <p className="text-xs text-ink/60 mb-4">
              Your session will end. Any open tables remain unaffected.
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setConfirmLogout(false)}
                className="flex-1 rounded-xl border border-border py-2.5 text-sm font-medium text-ink/70 transition-colors hover:bg-mist"
              >
                Cancel
              </button>
              <button
                data-testid="logout-confirm-btn"
                onClick={logout}
                className="flex-1 rounded-xl bg-brand py-2.5 text-sm font-bold text-white transition-colors hover:bg-brand/90"
              >
                Sign out
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
