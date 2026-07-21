import { Outlet, Navigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { TopBar } from './TopBar';
import { Sidebar } from './Sidebar';
import { RightPanel } from './RightPanel';
import { StatusBar } from './StatusBar';

/**
 * Fixed desktop layout — the primary shell for all authenticated pages.
 *
 * ┌── TopBar ────────────────────────────────────────────────────────────┐
 * ├── Sidebar ──┬── Main Content (Outlet) ────┬── Right Panel (Live) ──┤
 * ├── Status Bar ────────────────────────────────────────────────────────┤
 */
export function AppLayout() {
  const { isAuthenticated } = useAuth();

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-ink">
      {/* ── Top bar ──────────────────────────────────────────────────── */}
      <TopBar />

      {/* ── Content row ──────────────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden">
        {/* Navigation sidebar */}
        <Sidebar />

        {/* Main page content — each page controls its own scroll */}
        <main className="flex flex-1 flex-col overflow-hidden bg-mist">
          <Outlet />
        </main>

        {/* Live orders panel */}
        <RightPanel />
      </div>

      {/* ── Status bar ───────────────────────────────────────────────── */}
      <StatusBar />
    </div>
  );
}
