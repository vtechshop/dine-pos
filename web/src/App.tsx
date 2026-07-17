import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ErrorBoundary } from './components/ui/ErrorBoundary';
import { AuthProvider } from './context/AuthContext';
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

// Placeholder for unimplemented routes — renders until each phase delivers the page
function ComingSoon({ page }: { page: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center text-center">
      <p className="text-2xl font-bold text-[#1C0800]/20">{page}</p>
      <p className="mt-2 text-sm text-[#1C0800]/15">This module will be available in a future phase.</p>
    </div>
  );
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
                    <Route path="/dashboard"    element={<DashboardPage />} />

                    {/* ── Role entry points (app.dinepos.com) ────────────────
                        Each role lands here after login. Placeholder until
                        the role-specific UI is built in a future phase.
                        Do NOT add admin.dinepos.com routes here — that is
                        a completely separate deployment.
                    ────────────────────────────────────────────────────── */}
                    <Route path="/cashier"       element={<ComingSoon page="Cashier Dashboard" />} />
                    <Route path="/waiter"        element={<ComingSoon page="Waiter Dashboard" />} />
                    <Route path="/kitchen"       element={<ComingSoon page="Kitchen Display" />} />

                    {/* ── Placeholder routes — replace with real pages in future phases */}
                    <Route path="/orders"        element={<ComingSoon page="Orders" />} />
                    <Route path="/tables"        element={<ComingSoon page="Tables" />} />
                    <Route path="/customers"      element={<CustomersPage />} />
                    <Route path="/products"      element={<ProductsPage />} />
                    <Route path="/inventory"     element={<InventoryPage />} />
                    <Route path="/reports"        element={<ReportsPage />} />
                    <Route path="/settings"      element={<SettingsPage />} />
                    <Route path="/reservations"  element={<ComingSoon page="Reservations" />} />
                    <Route path="/cleaning"      element={<ComingSoon page="Cleaning" />} />
                    <Route path="/online"        element={<ComingSoon page="Online Orders" />} />

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
