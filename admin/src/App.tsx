import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import AdminLayout from './components/layout/AdminLayout';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import QRManagementPage from './pages/QRManagementPage';
import StaffManagementPage from './pages/StaffManagementPage';
import IntegrationsAdminPage from './pages/IntegrationsAdminPage';
import OnlineOrdersAdminPage from './pages/OnlineOrdersAdminPage';
import MenuChannelsPage from './pages/MenuChannelsPage';
import SettlementPage from './pages/SettlementPage';
import StaffAnalyticsPage from './pages/StaffAnalyticsPage';
import QRAnalyticsPage from './pages/QRAnalyticsPage';
import AuditLogPage from './pages/AuditLogPage';
import ReportsPage from './pages/ReportsPage';
import SettingsPage from './pages/SettingsPage';

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route element={<AdminLayout />}>
            <Route index element={<Navigate to="/dashboard" replace />} />
            <Route path="/dashboard"       element={<DashboardPage />} />
            <Route path="/qr"              element={<QRManagementPage />} />
            <Route path="/staff"           element={<StaffManagementPage />} />
            <Route path="/integrations"    element={<IntegrationsAdminPage />} />
            <Route path="/online-orders"   element={<OnlineOrdersAdminPage />} />
            <Route path="/menu-channels"   element={<MenuChannelsPage />} />
            <Route path="/settlement"      element={<SettlementPage />} />
            <Route path="/staff-analytics" element={<StaffAnalyticsPage />} />
            <Route path="/qr-analytics"    element={<QRAnalyticsPage />} />
            <Route path="/audit"           element={<AuditLogPage />} />
            <Route path="/reports"         element={<ReportsPage />} />
            <Route path="/settings"        element={<SettingsPage />} />
          </Route>
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
