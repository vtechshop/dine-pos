import { useState, useEffect, useCallback, Fragment } from 'react';
import { Outlet, Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useSocket } from '../../context/SocketContext';
import { TopBar } from './TopBar';
import { Sidebar } from './Sidebar';
import { RightPanel } from './RightPanel';
import { StatusBar } from './StatusBar';
import { WaiterCallAlerts } from './WaiterCallAlerts';
import { MaintenancePage } from '../../pages/MaintenancePage';
import { getPublicRemoteConfig } from '../../api/remoteConfig';


export function AppLayout() {
  const { isAuthenticated, logout, role } = useAuth();
  const { socket } = useSocket();
  const { pathname } = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  // Bumped by the top-bar Refresh button: re-mounts the page so it loads fresh data.
  const [refreshKey, setRefreshKey] = useState(0);
  const [maintenance, setMaintenance] = useState<{ active: boolean; message: string } | null>(null);

  const fetchMaintenance = useCallback(async () => {
    try {
      const config = await getPublicRemoteConfig();
      setMaintenance({ active: config.maintenanceMode, message: config.maintenanceMessage });
    } catch { /* fail open — do not block login screen */ }
  }, []);

  useEffect(() => {
    if (!isAuthenticated) return;
    fetchMaintenance();
  }, [isAuthenticated, fetchMaintenance]);

  useEffect(() => {
    if (!socket) return;
    const handler = (data: { active: boolean; message: string }) => {
      setMaintenance({ active: data.active, message: data.message });
    };
    socket.on('maintenance_update', handler);
    return () => { socket.off('maintenance_update', handler); };
  }, [socket]);

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }
  // Phase 5 · Batch 7 (P4-AUTH-02): a Super Admin session has no hotel — keep it in Super Admin
  if (role === 'superadmin') {
    return <Navigate to="/super-admin/hotels" replace />;
  }

  if (maintenance?.active) {
    return (
      <MaintenancePage
        message={maintenance.message}
        onLogout={logout}
        onRetry={fetchMaintenance}
      />
    );
  }

  return (
    <div data-print-expand className="flex h-full flex-col overflow-hidden bg-mist">
      {/* data-print-hide / data-print-expand: see index.css (P4-RPT-10) */}
      <div data-print-hide className="contents">
        <TopBar onMenuClick={() => setSidebarOpen(true)} onRefresh={() => setRefreshKey(k => k + 1)} />
      </div>

      <div data-print-expand className="flex flex-1 overflow-hidden">
        <div data-print-hide className="contents">
          <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />
        </div>

        <main data-print-expand className="flex min-w-0 flex-1 flex-col overflow-hidden bg-mist">
          {/* Pages size themselves with h-full; this wrapper is what's left
              below the banner, so the banner can't push their bottom off-screen. */}
          <div data-print-expand className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <Fragment key={refreshKey}><Outlet /></Fragment>
          </div>
        </main>

        {/* The cashier POS has its own order summary on the right; the kitchen
            display needs the full width */}
        {!pathname.startsWith('/cashier') && role !== 'kitchen' && (
          <div data-print-hide className="contents"><RightPanel key={refreshKey} /></div>
        )}
      </div>

      <StatusBar />
      {/* Phase 5 · Batch 4: QR guests' waiter calls (not on the kitchen display) */}
      {role !== 'kitchen' && <WaiterCallAlerts />}
    </div>
  );
}
