import { useState, useEffect, useCallback } from 'react';
import { Outlet, Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useSocket } from '../../context/SocketContext';
import { TopBar } from './TopBar';
import { Sidebar } from './Sidebar';
import { RightPanel } from './RightPanel';
import { StatusBar } from './StatusBar';
import { MaintenancePage } from '../../pages/MaintenancePage';
import { getPublicRemoteConfig } from '../../api/remoteConfig';


export function AppLayout() {
  const { isAuthenticated, logout } = useAuth();
  const { socket } = useSocket();
  const { pathname } = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);
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
    <div className="flex h-full flex-col overflow-hidden bg-mist">
      <TopBar onMenuClick={() => setSidebarOpen(true)} />

      <div className="flex flex-1 overflow-hidden">
        <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />

        <main className="flex min-w-0 flex-1 flex-col overflow-hidden bg-mist">
          {/* Pages size themselves with h-full; this wrapper is what's left
              below the banner, so the banner can't push their bottom off-screen. */}
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <Outlet />
          </div>
        </main>

        {/* The cashier POS has its own order summary on the right */}
        {!pathname.startsWith('/cashier') && <RightPanel />}
      </div>

      <StatusBar />
    </div>
  );
}
