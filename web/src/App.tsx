import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ErrorBoundary } from './components/ui/ErrorBoundary';
import { AuthProvider, useAuth } from './context/AuthContext';
import { SettingsProvider } from './context/SettingsContext';
import { SocketProvider } from './context/SocketContext';
import { KeyboardProvider } from './context/KeyboardContext';
import { LiveOrdersProvider } from './context/LiveOrdersContext';
import { CashierProvider } from './context/CashierContext';
import { NotificationProvider } from './context/NotificationContext';
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
import { AggregatorDashboardPage } from './pages/super-admin/AggregatorDashboardPage';
import { AggregatorHotelsPage }    from './pages/super-admin/AggregatorHotelsPage';
import { AggregatorMonitorPage }   from './pages/super-admin/AggregatorMonitorPage';
import { AggregatorOrdersPage }    from './pages/super-admin/AggregatorOrdersPage';
import { AggregatorSettlementPage }from './pages/super-admin/AggregatorSettlementPage';
import { AggregatorWebhooksPage }  from './pages/super-admin/AggregatorWebhooksPage';
import { AggregatorSettingsPage }  from './pages/super-admin/AggregatorSettingsPage';
import { AggregatorAuditPage }     from './pages/super-admin/AggregatorAuditPage';
import { AggregatorReportsPage }   from './pages/super-admin/AggregatorReportsPage';
import { LeadsDashboardPage }      from './pages/super-admin/LeadsDashboardPage';
import { LeadsPage }               from './pages/super-admin/LeadsPage';
import { DemoRequestsPage }        from './pages/super-admin/DemoRequestsPage';
import { FollowUpsPage }           from './pages/super-admin/FollowUpsPage';
import { LeadDetailPage }          from './pages/super-admin/LeadDetailPage';
import { LeadPipelinePage }        from './pages/super-admin/LeadPipelinePage';
import { DashboardPage } from './pages/DashboardPage';
import { TablesPage } from './pages/TablesPage';
import { KitchenPage } from './pages/KitchenPage';
import { CashierPage } from './pages/CashierPage';
import { CustomerDisplayPage } from './pages/CustomerDisplayPage';
// Heavy pages — code-split to reduce initial JS parse time
const OrdersPage       = lazy(() => import('./pages/OrdersPage').then(m => ({ default: m.OrdersPage })));
const ProductsPage     = lazy(() => import('./pages/ProductsPage').then(m => ({ default: m.ProductsPage })));
const InventoryPage    = lazy(() => import('./pages/InventoryPage').then(m => ({ default: m.InventoryPage })));
const CustomersPage    = lazy(() => import('./pages/CustomersPage').then(m => ({ default: m.CustomersPage })));
const ReportsPage      = lazy(() => import('./pages/ReportsPage').then(m => ({ default: m.ReportsPage })));
const SettingsPage     = lazy(() => import('./pages/SettingsPage').then(m => ({ default: m.SettingsPage })));
const ReservationsPage = lazy(() => import('./pages/ReservationsPage').then(m => ({ default: m.ReservationsPage })));
const OnlineOrdersPage = lazy(() => import('./pages/OnlineOrdersPage').then(m => ({ default: m.OnlineOrdersPage })));
const IntegrationsPage = lazy(() => import('./pages/IntegrationsPage').then(m => ({ default: m.IntegrationsPage })));
const MenuSyncPage     = lazy(() => import('./pages/MenuSyncPage').then(m => ({ default: m.MenuSyncPage })));

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
                <CashierProvider>
                <NotificationProvider>
                <Routes>
                  <Route path="/login"              element={<LoginPage />} />
                  <Route path="/register"          element={<RegisterPage />} />
                  <Route path="/register/success"  element={<RegisterSuccessPage />} />
                  <Route path="/super-admin/login" element={<SuperAdminLoginPage />} />
                  <Route path="/customer-display"  element={<CustomerDisplayPage />} />

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
                      <Route path="/super-admin/analytics"          element={<HotelAnalyticsPage />} />
                      <Route path="/super-admin/hotels/:id/health" element={<HotelHealthPage />} />
                      {/* Lead CRM — M1-M14 */}
                      <Route path="/super-admin/leads/dashboard" element={<LeadsDashboardPage />} />
                      <Route path="/super-admin/leads"           element={<LeadsPage />} />
                      <Route path="/super-admin/leads/demos"     element={<DemoRequestsPage />} />
                      <Route path="/super-admin/leads/followups" element={<FollowUpsPage />} />
                      <Route path="/super-admin/leads/pipeline"  element={<LeadPipelinePage />} />
                      <Route path="/super-admin/leads/:id"       element={<LeadDetailPage />} />
                      {/* Aggregator — M1-M15 */}
                      <Route path="/super-admin/aggregator"             element={<AggregatorDashboardPage />} />
                      <Route path="/super-admin/aggregator/hotels"      element={<AggregatorHotelsPage />} />
                      <Route path="/super-admin/aggregator/monitor"     element={<AggregatorMonitorPage />} />
                      <Route path="/super-admin/aggregator/orders"      element={<AggregatorOrdersPage />} />
                      <Route path="/super-admin/aggregator/settlement"  element={<AggregatorSettlementPage />} />
                      <Route path="/super-admin/aggregator/webhooks"    element={<AggregatorWebhooksPage />} />
                      <Route path="/super-admin/aggregator/settings"    element={<AggregatorSettingsPage />} />
                      <Route path="/super-admin/aggregator/audit"       element={<AggregatorAuditPage />} />
                      <Route path="/super-admin/aggregator/reports"     element={<AggregatorReportsPage />} />
                    </Route>
                  </Route>

                  <Route element={<AppLayout />}>
                    <Route index element={<Navigate to="/dashboard" replace />} />
                    <Route path="/dashboard"   element={<DashboardPage />} />
                    <Route path="/tables"      element={<TablesPage />} />
                    <Route path="/kitchen"     element={<KitchenPage />} />
                    <Route path="/cashier"     element={<CashierPage />} />
                    <Route path="/orders"      element={<AdminOnly><Suspense fallback={<PageFallback />}><OrdersPage /></Suspense></AdminOnly>} />
                    <Route path="/customers"   element={<AdminOnly><Suspense fallback={<PageFallback />}><CustomersPage /></Suspense></AdminOnly>} />
                    <Route path="/products"    element={<AdminOnly><Suspense fallback={<PageFallback />}><ProductsPage /></Suspense></AdminOnly>} />
                    <Route path="/inventory"   element={<AdminOnly><Suspense fallback={<PageFallback />}><InventoryPage /></Suspense></AdminOnly>} />
                    <Route path="/reports"     element={<AdminOnly><Suspense fallback={<PageFallback />}><ReportsPage /></Suspense></AdminOnly>} />
                    <Route path="/settings"    element={<AdminOnly><Suspense fallback={<PageFallback />}><SettingsPage /></Suspense></AdminOnly>} />
                    <Route path="/reservations"   element={<AdminOnly><Suspense fallback={<PageFallback />}><ReservationsPage /></Suspense></AdminOnly>} />
                    <Route path="/online-orders" element={<AdminOnly><Suspense fallback={<PageFallback />}><OnlineOrdersPage /></Suspense></AdminOnly>} />
                    <Route path="/integrations"  element={<AdminOnly><Suspense fallback={<PageFallback />}><IntegrationsPage /></Suspense></AdminOnly>} />
                    <Route path="/menu-sync"     element={<AdminOnly><Suspense fallback={<PageFallback />}><MenuSyncPage /></Suspense></AdminOnly>} />

                    <Route path="/waiter"  element={<Navigate to="/dashboard" replace />} />
                    <Route path="*" element={<Navigate to="/dashboard" replace />} />
                  </Route>
                </Routes>
                </NotificationProvider>
                </CashierProvider>
              </LiveOrdersProvider>
            </KeyboardProvider>
          </SocketProvider>
        </SettingsProvider>
      </AuthProvider>
    </BrowserRouter>
    </ErrorBoundary>
  );
}
