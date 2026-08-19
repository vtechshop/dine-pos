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
import { SubscriptionExpiredPage } from './pages/SubscriptionExpiredPage';
import { TermsPage }    from './pages/legal/TermsPage';
import { PrivacyPage }  from './pages/legal/PrivacyPage';
import { RefundPage }   from './pages/legal/RefundPage';
import { ShippingPage } from './pages/legal/ShippingPage';
import { ContactPage }  from './pages/legal/ContactPage';
import { DashboardPage } from './pages/DashboardPage';
import { TablesPage } from './pages/TablesPage';
import { KitchenPage } from './pages/KitchenPage';
import { CashierPage } from './pages/CashierPage';
import { CustomerDisplayPage } from './pages/CustomerDisplayPage';
// Heavy pages — code-split to reduce initial JS parse time
const OrdersPage       = lazy(() => import('./pages/OrdersPage').then(m => ({ default: m.OrdersPage })));
const ProductsPage     = lazy(() => import('./pages/ProductsPage').then(m => ({ default: m.ProductsPage })));
const InventoryPage              = lazy(() => import('./pages/InventoryPage').then(m => ({ default: m.InventoryPage })));
const InventoryIntelligencePage  = lazy(() => import('./pages/InventoryIntelligencePage').then(m => ({ default: m.InventoryIntelligencePage })));
const PaymentSettingsPage        = lazy(() => import('./pages/PaymentSettingsPage').then(m => ({ default: m.PaymentSettingsPage })));
const CustomersPage    = lazy(() => import('./pages/CustomersPage').then(m => ({ default: m.CustomersPage })));
const CampaignsPage    = lazy(() => import('./pages/CampaignsPage').then(m => ({ default: m.CampaignsPage })));
const ReportsPage      = lazy(() => import('./pages/ReportsPage').then(m => ({ default: m.ReportsPage })));
const SettingsPage     = lazy(() => import('./pages/SettingsPage').then(m => ({ default: m.SettingsPage })));
const ReservationsPage = lazy(() => import('./pages/ReservationsPage').then(m => ({ default: m.ReservationsPage })));
const OnlineOrdersPage = lazy(() => import('./pages/OnlineOrdersPage').then(m => ({ default: m.OnlineOrdersPage })));
const IntegrationsPage = lazy(() => import('./pages/IntegrationsPage').then(m => ({ default: m.IntegrationsPage })));
const MenuSyncPage          = lazy(() => import('./pages/MenuSyncPage').then(m => ({ default: m.MenuSyncPage })));
const ModifierGroupsPage    = lazy(() => import('./pages/ModifierGroupsPage').then(m => ({ default: m.ModifierGroupsPage })));
const VendorsPage           = lazy(() => import('./pages/VendorsPage').then(m => ({ default: m.VendorsPage })));
const PurchaseOrdersPage    = lazy(() => import('./pages/PurchaseOrdersPage').then(m => ({ default: m.PurchaseOrdersPage })));
const GRNPage               = lazy(() => import('./pages/GRNPage').then(m => ({ default: m.GRNPage })));
const VendorLedgerPage      = lazy(() => import('./pages/VendorLedgerPage').then(m => ({ default: m.VendorLedgerPage })));
const VendorReturnsPage     = lazy(() => import('./pages/VendorReturnsPage').then(m => ({ default: m.VendorReturnsPage })));
const CouponsPage           = lazy(() => import('./pages/CouponsPage').then(m => ({ default: m.CouponsPage })));
const GiftVouchersPage      = lazy(() => import('./pages/GiftVouchersPage').then(m => ({ default: m.GiftVouchersPage })));
const AuditLogsPage         = lazy(() => import('./pages/AuditLogsPage').then(m => ({ default: m.AuditLogsPage })));
const AIMenuImportPage      = lazy(() => import('./pages/AIMenuImportPage').then(m => ({ default: m.AIMenuImportPage })));
// AI Platform pages — admin only, code-split
const AIDashboardPage       = lazy(() => import('./pages/ai/AIDashboardPage').then(m => ({ default: m.AIDashboardPage })));
const MorningBriefPage      = lazy(() => import('./pages/ai/MorningBriefPage').then(m => ({ default: m.MorningBriefPage })));
const AIReportsPage         = lazy(() => import('./pages/ai/AIReportsPage').then(m => ({ default: m.AIReportsPage })));
const AIChatPage            = lazy(() => import('./pages/ai/AIChatPage').then(m => ({ default: m.AIChatPage })));
const ForecastPage          = lazy(() => import('./pages/ai/ForecastPage').then(m => ({ default: m.ForecastPage })));
const AlertsPage            = lazy(() => import('./pages/ai/AlertsPage').then(m => ({ default: m.AlertsPage })));
const RecommendationsPage   = lazy(() => import('./pages/ai/RecommendationsPage').then(m => ({ default: m.RecommendationsPage })));
const PurchaseAssistantPage = lazy(() => import('./pages/ai/PurchaseAssistantPage').then(m => ({ default: m.PurchaseAssistantPage })));

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

// Redirect cashier away from admin/kitchen pages to their own POS interface
function CashierRedirect({ children }: { children: React.ReactNode }) {
  const { role } = useAuth();
  if (role === 'cashier') return <Navigate to="/cashier" replace />;
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
                  <Route path="/subscription-expired" element={<SubscriptionExpiredPage />} />

                  {/* Public legal pages — no auth required */}
                  <Route path="/terms"    element={<TermsPage />} />
                  <Route path="/privacy"  element={<PrivacyPage />} />
                  <Route path="/refund"   element={<RefundPage />} />
                  <Route path="/shipping" element={<ShippingPage />} />
                  <Route path="/contact"  element={<ContactPage />} />

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
                    <Route path="/dashboard"   element={<CashierRedirect><DashboardPage /></CashierRedirect>} />
                    <Route path="/tables"      element={<CashierRedirect><TablesPage /></CashierRedirect>} />
                    <Route path="/kitchen"     element={<CashierRedirect><KitchenPage /></CashierRedirect>} />
                    <Route path="/cashier"     element={<CashierPage />} />
                    <Route path="/orders"      element={<AdminOnly><Suspense fallback={<PageFallback />}><OrdersPage /></Suspense></AdminOnly>} />
                    <Route path="/customers"   element={<AdminOnly><Suspense fallback={<PageFallback />}><CustomersPage /></Suspense></AdminOnly>} />
                    <Route path="/campaigns"   element={<AdminOnly><Suspense fallback={<PageFallback />}><CampaignsPage /></Suspense></AdminOnly>} />
                    <Route path="/products"    element={<AdminOnly><Suspense fallback={<PageFallback />}><ProductsPage /></Suspense></AdminOnly>} />
                    <Route path="/inventory"               element={<AdminOnly><Suspense fallback={<PageFallback />}><InventoryPage /></Suspense></AdminOnly>} />
                    <Route path="/inventory-intelligence"  element={<AdminOnly><Suspense fallback={<PageFallback />}><InventoryIntelligencePage /></Suspense></AdminOnly>} />
                    <Route path="/payments"    element={<AdminOnly><Suspense fallback={<PageFallback />}><PaymentSettingsPage /></Suspense></AdminOnly>} />
                    <Route path="/reports"     element={<AdminOnly><Suspense fallback={<PageFallback />}><ReportsPage /></Suspense></AdminOnly>} />
                    <Route path="/settings"    element={<AdminOnly><Suspense fallback={<PageFallback />}><SettingsPage /></Suspense></AdminOnly>} />
                    <Route path="/reservations"   element={<AdminOnly><Suspense fallback={<PageFallback />}><ReservationsPage /></Suspense></AdminOnly>} />
                    <Route path="/online-orders" element={<AdminOnly><Suspense fallback={<PageFallback />}><OnlineOrdersPage /></Suspense></AdminOnly>} />
                    <Route path="/integrations"  element={<AdminOnly><Suspense fallback={<PageFallback />}><IntegrationsPage /></Suspense></AdminOnly>} />
                    <Route path="/menu-sync"     element={<AdminOnly><Suspense fallback={<PageFallback />}><MenuSyncPage /></Suspense></AdminOnly>} />
                    <Route path="/modifiers"     element={<AdminOnly><Suspense fallback={<PageFallback />}><ModifierGroupsPage /></Suspense></AdminOnly>} />
                    <Route path="/vendors"          element={<AdminOnly><Suspense fallback={<PageFallback />}><VendorsPage /></Suspense></AdminOnly>} />
                    <Route path="/purchase-orders" element={<AdminOnly><Suspense fallback={<PageFallback />}><PurchaseOrdersPage /></Suspense></AdminOnly>} />
                    <Route path="/grn"             element={<AdminOnly><Suspense fallback={<PageFallback />}><GRNPage /></Suspense></AdminOnly>} />
                    <Route path="/vendor-ledger"   element={<AdminOnly><Suspense fallback={<PageFallback />}><VendorLedgerPage /></Suspense></AdminOnly>} />
                    <Route path="/vendor-returns"  element={<AdminOnly><Suspense fallback={<PageFallback />}><VendorReturnsPage /></Suspense></AdminOnly>} />
                    <Route path="/coupons"         element={<AdminOnly><Suspense fallback={<PageFallback />}><CouponsPage /></Suspense></AdminOnly>} />
                    <Route path="/gift-vouchers"   element={<AdminOnly><Suspense fallback={<PageFallback />}><GiftVouchersPage /></Suspense></AdminOnly>} />
                    <Route path="/audit-logs"      element={<AdminOnly><Suspense fallback={<PageFallback />}><AuditLogsPage /></Suspense></AdminOnly>} />
                    <Route path="/ai-menu-import"  element={<AdminOnly><Suspense fallback={<PageFallback />}><AIMenuImportPage /></Suspense></AdminOnly>} />
                    <Route path="/ai"              element={<AdminOnly><Suspense fallback={<PageFallback />}><AIDashboardPage /></Suspense></AdminOnly>} />
                    <Route path="/ai/brief"        element={<AdminOnly><Suspense fallback={<PageFallback />}><MorningBriefPage /></Suspense></AdminOnly>} />
                    <Route path="/ai/reports"      element={<AdminOnly><Suspense fallback={<PageFallback />}><AIReportsPage /></Suspense></AdminOnly>} />
                    <Route path="/ai/chat"         element={<AdminOnly><Suspense fallback={<PageFallback />}><AIChatPage /></Suspense></AdminOnly>} />
                    <Route path="/ai/forecast"     element={<AdminOnly><Suspense fallback={<PageFallback />}><ForecastPage /></Suspense></AdminOnly>} />
                    <Route path="/ai/alerts"       element={<AdminOnly><Suspense fallback={<PageFallback />}><AlertsPage /></Suspense></AdminOnly>} />
                    <Route path="/ai/recommendations" element={<AdminOnly><Suspense fallback={<PageFallback />}><RecommendationsPage /></Suspense></AdminOnly>} />
                    <Route path="/ai/purchase"     element={<AdminOnly><Suspense fallback={<PageFallback />}><PurchaseAssistantPage /></Suspense></AdminOnly>} />

                    <Route path="/waiter"   element={<Navigate to="/dashboard" replace />} />
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
