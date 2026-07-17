import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { SettingsProvider } from './context/SettingsContext';
import { SocketProvider } from './context/SocketContext';
import { AppLayout } from './components/layout/AppLayout';
import { LoginPage } from './pages/LoginPage';
import { DashboardPage } from './pages/DashboardPage';

export function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <SettingsProvider>
          <SocketProvider>
            <Routes>
              <Route path="/login" element={<LoginPage />} />
              <Route element={<AppLayout />}>
                <Route index element={<Navigate to="/dashboard" replace />} />
                <Route path="/dashboard" element={<DashboardPage />} />
                {/* Placeholder: all unimplemented routes redirect to dashboard */}
                <Route path="*" element={<Navigate to="/dashboard" replace />} />
              </Route>
            </Routes>
          </SocketProvider>
        </SettingsProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
