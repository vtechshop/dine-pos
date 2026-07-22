import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ErrorBoundary } from './components/ui/ErrorBoundary';
import { AuthProvider, useAuth } from './context/AuthContext';
import { SettingsProvider } from './context/SettingsContext';
import { SocketProvider } from './context/SocketContext';
import { KeyboardProvider } from './context/KeyboardContext';
import { LiveOrdersProvider } from './context/LiveOrdersContext';
import { AppLayout } from './components/layout/AppLayout';
import { Spinner } from './components/ui/Spinner';
// Critical path — always bundled (login + dashboard render on first load)
import { LoginPage }            from './pages/LoginPage';
import { RegisterPage }         from './pages/RegisterPage';
import { RegisterSuccessPage }  from './pages/RegisterSuccessPage';
import { SuperAdminLoginPage }  from './pages/super-admin/SuperAdminLoginPage';
import { SuperAdminRoute }      from './components/SuperAdminRoute';
import { SuperAdminLayout }     from './components/layout/SuperAdminLayout';
import { HotelsPage }           from './pages/super-admin/HotelsPage';
import { HotelDetailPage }      from './pages/super-admin/HotelDetailPage';
import { SADashboardPage }      from './pages/super-admin/SADashboardPage';
import { LiveMonitoringPage }   from './pages/super-admin/LiveMonitoringPage';
import { SystemHealthPage }         from './pages/super-admin/SystemHealthPage';
import { VersionManagementPage }    from './pages/super-admin/VersionManagementPage';
import { SANotificationsPage }      from './pages/super-admin/SANotificationsPage';
import { BroadcastCenterPage }      from './pages/super-admin/BroadcastCenterPage';
import { HotelAnalyticsPage }      from './pages/super-admin/HotelAnalyticsPage';
import { HotelHealthPage }         from './pages/super-admin/HotelHealthPage';
import { DashboardPage } from './pages/DashboardPage';
import { TablesPage } from './pages/TablesPage';
import { KitchenPage } from './pages/KitchenPage';
// Heavy pages — code-split to reduce initial JS parse time
const OrdersPage      = lazy(() => import('./pages/OrdersPage').then(m => ({ default: m.OrdersPage })));
const ProductsPage    = lazy(() => import('./pages/ProductsPage').then(m => ({ default: m.ProductsPage })));
const InventoryPage   = lazy(() => import('./pages/InventoryPage').then(m => ({ default: m.InventoryPage })));
const CustomersPage   = lazy(() => import('./pages/CustomersPage').then(m => ({ default: m.CustomersPage })));
const ReportsPage     = lazy(() => import('./pages/ReportsPage').then(m => ({ default: m.ReportsPage })));
const SettingsPage    = lazy(() => import('./pages/SettingsPage').then(m => ({ default: m.SettingsPage })));
const ReservationsPage = lazy(() => import('./pages/ReservationsPage').then(m => ({ default: m.ReservationsPage })));

function PageFallback() {
  return (
    <div className="flex h-full items-center justify-center">
      <Spinner size="lg" />
    </div>
  );
}

// Redirect non-admin roles away from pages they are not permitted to view
function AdminOnly({ children }: { children: React.ReactNode }) {
  const { role } = useAuth();
  if (role !== 'admin') return <Navigate to="/dashboard" replace />;
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
                  <Route path="/login"              element={<LoginPage />} />
                  <Route path="/register"          element={<RegisterPage />} />
                  <Route path="/register/success"  element={<RegisterSuccessPage />} />
                  <Route path="/super-admin/login" element={<SuperAdminLoginPage />} />

                  {/* Super Admin protected routes */}
                  <Route element={<SuperAdminRoute />}>
                    <Route element={<SuperAdminLayout />}>
                      <Route path="/super-admin"            element={<Navigate to="/super-admin/dashboard" replace />} />
                      <Route path="/super-admin/dashboard"  element={<SADashboardPage />} />
                      <Route path="/super-admin/hotels"     element={<HotelsPage />} />
                      <Route path="/super-admin/hotels/:id" element={<HotelDetailPage />} />
                      <Route path="/super-admin/live"       element={<LiveMonitoringPage />} />
                      <Route path="/super-admin/health"     element={<SystemHealthPage />} />
                      <Route path="/super-admin/versions"       element={<VersionManagementPage />} />
                      <Route path="/super-admin/notifications" element={<SANotificationsPage />} />
                      <Route path="/super-admin/broadcast"    element={<BroadcastCenterPage />} />
                      <Route path="/super-admin/analytics"   element={<HotelAnalyticsPage />} />
                      <Route path="/super-admin/hotels/:id/health" element={<HotelHealthPage />} />
                    </Route>
                  </Route>

                  <Route element={<AppLayout />}>
                    <Route index element={<Navigate to="/dashboard" replace />} />
                    <Route path="/dashboard"   element={<DashboardPage />} />
                    <Route path="/tables"      element={<TablesPage />} />
                    <Route path="/kitchen"     element={<KitchenPage />} />
                    <Route path="/orders"      element={<AdminOnly><Suspense fallback={<PageFallback />}><OrdersPage /></Suspense></AdminOnly>} />
                    <Route path="/customers"   element={<AdminOnly><Suspense fallback={<PageFallback />}><CustomersPage /></Suspense></AdminOnly>} />
                    <Route path="/products"    element={<AdminOnly><Suspense fallback={<PageFallback />}><ProductsPage /></Suspense></AdminOnly>} />
                    <Route path="/inventory"   element={<AdminOnly><Suspense fallback={<PageFallback />}><InventoryPage /></Suspense></AdminOnly>} />
                    <Route path="/reports"     element={<AdminOnly><Suspense fallback={<PageFallback />}><ReportsPage /></Suspense></AdminOnly>} />
                    <Route path="/settings"    element={<AdminOnly><Suspense fallback={<PageFallback />}><SettingsPage /></Suspense></AdminOnly>} />
                    <Route path="/reservations" element={<AdminOnly><Suspense fallback={<PageFallback />}><ReservationsPage /></Suspense></AdminOnly>} />

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
