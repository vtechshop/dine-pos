import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import Sidebar from './Sidebar';
import TopBar from './TopBar';

export default function AdminLayout() {
  const { isAuthenticated, role } = useAuth();
  if (!isAuthenticated || role !== 'admin') return <Navigate to="/login" replace />;
  return (
    <div className="flex h-screen overflow-hidden bg-[#FFF6EE]">
      <Sidebar />
      <div className="flex flex-col flex-1 overflow-hidden">
        <TopBar />
        <main className="flex-1 overflow-y-auto p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
