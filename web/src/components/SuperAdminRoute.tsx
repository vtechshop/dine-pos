import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export function SuperAdminRoute() {
  const { role, isAuthenticated } = useAuth();
  if (!isAuthenticated || role !== 'superadmin') {
    return <Navigate to="/super-admin/login" replace />;
  }
  return <Outlet />;
}
