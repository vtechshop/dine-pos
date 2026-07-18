import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ErrorBoundary } from './components/ui/ErrorBoundary';
import { AuthProvider, useAuth } from './context/AuthContext';
import { SettingsProvider } from './context/SettingsContext';
import { SocketProvider } from './context/SocketContext';
import { KeyboardProvider } from './context/KeyboardContext';
import { LiveOrdersProvider } from './context/LiveOrdersContext';
import { AppLayout } from './components/layout/AppLayout';
import { LoginPage } from './pages/LoginPage';
import { DashboardPage } from './pages/DashboardPage';
import { ProductsPage } from './pages/ProductsPage';
import { InventoryPage } from './pages/InventoryPage';
import { CustomersPage } from './pages/CustomersPage';
import { ReportsPage } from './pages/ReportsPage';
import { SettingsPage } from './pages/SettingsPage';
import { OrdersPage } from './pages/OrdersPage';
import { TablesPage } from './pages/TablesPage';
import { KitchenPage } from './pages/KitchenPage';
import { ReservationsPage } from './pages/ReservationsPage';

// Redirect non-admin roles away from pages they are not permitted to view
function AdminOnly({ children }: { children: React.ReactNode }) {
  const { role } = useAuth();
  if (role !== null && role !== 'admin') return <Navigate to="/dashboard" replace />;
  return <>{children}</>;
}

export function App() {
  return (
    <ErrorBoundary>
    <BrowserRouter>
      <AuthProvider>
        <SettingsProvider>
          <SocketProvider>
            {/*
              KeyboardProvider registers a single window keydown listener.
              Components use useShortcut(key, handler) to claim shortcuts.
              Last registration wins — modal components naturally take precedence.

              LiveOrdersProvider subscribes to socket 'new_order' events and
              maintains the ordered list consumed by RightPanel + NotificationBell.
              It must be inside SocketProvider.
            */}
            <KeyboardProvider>
              <LiveOrdersProvider>
                <Routes>
                  <Route path="/login" element={<LoginPage />} />

                  <Route element={<AppLayout />}>
                    <Route index element={<Navigate to="/dashboard" replace />} />
                    <Route path="/dashboard"   element={<DashboardPage />} />
                    <Route path="/orders"      element={<AdminOnly><OrdersPage /></AdminOnly>} />
                    <Route path="/tables"      element={<TablesPage />} />
                    <Route path="/customers"   element={<AdminOnly><CustomersPage /></AdminOnly>} />
                    <Route path="/products"    element={<AdminOnly><ProductsPage /></AdminOnly>} />
                    <Route path="/inventory"   element={<AdminOnly><InventoryPage /></AdminOnly>} />
                    <Route path="/reports"     element={<AdminOnly><ReportsPage /></AdminOnly>} />
                    <Route path="/settings"    element={<AdminOnly><SettingsPage /></AdminOnly>} />
                    <Route path="/reservations" element={<AdminOnly><ReservationsPage /></AdminOnly>} />
                    <Route path="/kitchen"     element={<KitchenPage />} />

                    {/* Role landing pages redirect to dashboard until role-specific views are built */}
                    <Route path="/cashier" element={<Navigate to="/dashboard" replace />} />
                    <Route path="/waiter"  element={<Navigate to="/dashboard" replace />} />

                    <Route path="*" element={<Navigate to="/dashboard" replace />} />
                  </Route>
                </Routes>
              </LiveOrdersProvider>
            </KeyboardProvider>
          </SocketProvider>
        </SettingsProvider>
      </AuthProvider>
    </BrowserRouter>
    </ErrorBoundary>
  );
}
