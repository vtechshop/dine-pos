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
// SA pages — lazy-loaded so they are excluded from the critical-path bundle.
// Hotel staff never navigate to /super-admin, so these modules are dead weight
// on the initial parse unless explicitly routed to.
const HotelsPage            = lazy(() => import('./pages/super-admin/HotelsPage').then(m => ({ default: m.HotelsPage })));
const HotelDetailPage       = lazy(() => import('./pages/super-admin/HotelDetailPage').then(m => ({ default: m.HotelDetailPage })));
const SADashboardPage       = lazy(() => import('./pages/super-admin/SADashboardPage').then(m => ({ default: m.SADashboardPage })));
const LiveMonitoringPage    = lazy(() => import('./pages/super-admin/LiveMonitoringPage').then(m => ({ default: m.LiveMonitoringPage })));
const SystemHealthPage      = lazy(() => import('./pages/super-admin/SystemHealthPage').then(m => ({ default: m.SystemHealthPage })));
const VersionManagementPage = lazy(() => import('./pages/super-admin/VersionManagementPage').then(m => ({ default: m.VersionManagementPage })));
const SANotificationsPage   = lazy(() => import('./pages/super-admin/SANotificationsPage').then(m => ({ default: m.SANotificationsPage })));
const BroadcastCenterPage   = lazy(() => import('./pages/super-admin/BroadcastCenterPage').then(m => ({ default: m.BroadcastCenterPage })));
const HotelAnalyticsPage    = lazy(() => import('./pages/super-admin/HotelAnalyticsPage').then(m => ({ default: m.HotelAnalyticsPage })));
const HotelHealthPage       = lazy(() => import('./pages/super-admin/HotelHealthPage').then(m => ({ default: m.HotelHealthPage })));
const AggregatorDashboardPage  = lazy(() => import('./pages/super-admin/AggregatorDashboardPage').then(m => ({ default: m.AggregatorDashboardPage })));
const AggregatorHotelsPage     = lazy(() => import('./pages/super-admin/AggregatorHotelsPage').then(m => ({ default: m.AggregatorHotelsPage })));
const AggregatorMonitorPage    = lazy(() => import('./pages/super-admin/AggregatorMonitorPage').then(m => ({ default: m.AggregatorMonitorPage })));
const AggregatorOrdersPage     = lazy(() => import('./pages/super-admin/AggregatorOrdersPage').then(m => ({ default: m.AggregatorOrdersPage })));
const AggregatorSettlementPage = lazy(() => import('./pages/super-admin/AggregatorSettlementPage').then(m => ({ default: m.AggregatorSettlementPage })));
const AggregatorWebhooksPage   = lazy(() => import('./pages/super-admin/AggregatorWebhooksPage').then(m => ({ default: m.AggregatorWebhooksPage })));
const AggregatorSettingsPage   = lazy(() => import('./pages/super-admin/AggregatorSettingsPage').then(m => ({ default: m.AggregatorSettingsPage })));
const AggregatorAuditPage      = lazy(() => import('./pages/super-admin/AggregatorAuditPage').then(m => ({ default: m.AggregatorAuditPage })));
const AggregatorReportsPage    = lazy(() => import('./pages/super-admin/AggregatorReportsPage').then(m => ({ default: m.AggregatorReportsPage })));
const LeadsDashboardPage    = lazy(() => import('./pages/super-admin/LeadsDashboardPage').then(m => ({ default: m.LeadsDashboardPage })));
const LeadsPage             = lazy(() => import('./pages/super-admin/LeadsPage').then(m => ({ default: m.LeadsPage })));
const DemoRequestsPage      = lazy(() => import('./pages/super-admin/DemoRequestsPage').then(m => ({ default: m.DemoRequestsPage })));
const FollowUpsPage         = lazy(() => import('./pages/super-admin/FollowUpsPage').then(m => ({ default: m.FollowUpsPage })));
const LeadDetailPage        = lazy(() => import('./pages/super-admin/LeadDetailPage').then(m => ({ default: m.LeadDetailPage })));
const LeadPipelinePage      = lazy(() => import('./pages/super-admin/LeadPipelinePage').then(m => ({ default: m.LeadPipelinePage })));
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
                    <Route element={<Suspense fallback={<PageFallback />}><SuperAdminLayout /></Suspense>}>
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
