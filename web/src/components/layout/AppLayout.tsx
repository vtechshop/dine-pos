import { useState } from 'react';
import { Outlet, Navigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { TopBar } from './TopBar';
import { Sidebar } from './Sidebar';
import { RightPanel } from './RightPanel';
import { StatusBar } from './StatusBar';

export function AppLayout() {
  const { isAuthenticated } = useAuth();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-ink">
      <TopBar onMenuClick={() => setSidebarOpen(true)} />

      <div className="flex flex-1 overflow-hidden">
        <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />

        <main className="flex flex-1 flex-col overflow-hidden bg-mist">
          <Outlet />
        </main>

        <RightPanel />
      </div>

      <StatusBar />
    </div>
  );
}
