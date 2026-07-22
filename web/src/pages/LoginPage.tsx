import { useState, type FormEvent } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { Eye, EyeOff } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { Spinner } from '../components/ui/Spinner';

type LoginMode = 'admin' | 'cashier';

const APP_VERSION = 'v1.0-rc1';

// All roles land on the table-grid dashboard for the pilot phase.
// Dedicated cashier/waiter/kitchen views are delivered in a future phase.
function roleDestination(_role: string | null): string {
  return '/dashboard';
}

export function LoginPage() {
  const { isAuthenticated, login, loginCashier, role } = useAuth();
  const [mode, setMode]           = useState<LoginMode>('admin');

  // Admin fields
  const [userId, setUserId]       = useState('');
  const [password, setPassword]   = useState('');
  const [showPwd, setShowPwd]     = useState(false);

  // Cashier fields — Hotel ID pre-fills from the device-scoped key written on admin login
  const [hotelId, setHotelId]           = useState(() => localStorage.getItem('pos_device_hotel_id') ?? '');
  const [employeeCode, setEmployeeCode] = useState('');
  const [pin, setPin]                   = useState('');
  const [showPin, setShowPin]           = useState(false);

  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState<string | null>(null);

  if (isAuthenticated) return <Navigate to={roleDestination(role)} replace />;

  function switchMode(next: LoginMode) {
    setMode(next);
    setError(null);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      if (mode === 'admin') {
        await login(userId.trim(), password);
      } else {
        await loginCashier(hotelId.trim(), employeeCode.trim().toUpperCase(), pin);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-mist px-4">
      <div className="w-full max-w-sm">
        {/* Brand */}
        <div className="mb-8 text-center">
          <img
            src="/branding/logo-64.png"
            alt="Dine POS"
            className="mx-auto mb-3 h-14 w-14 rounded-2xl object-contain shadow-md"
          />
          <h1 className="text-2xl font-bold text-ink">Dine POS</h1>
          <p className="mt-1 text-sm text-ink/50">Sign in to your Dine POS account</p>
        </div>

        {/* Card */}
        <div className="rounded-2xl border border-border bg-canvas p-8 shadow-sm">
          {/* Mode tabs */}
          <div className="mb-6 flex overflow-hidden rounded-lg border border-border">
            {(['admin', 'cashier'] as const).map(m => (
              <button
                key={m}
                type="button"
                onClick={() => switchMode(m)}
                className={`flex-1 py-2 text-sm font-medium transition ${
                  mode === m
                    ? 'bg-brand text-canvas'
                    : 'text-ink/60 hover:bg-mist'
                }`}
              >
                {m === 'admin' ? 'Hotel Admin' : 'Cashier'}
              </button>
            ))}
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            {mode === 'admin' ? (
              <>
                {/* User ID */}
                <div>
                  <label htmlFor="userId" className="block text-sm font-medium text-ink/70">
                    Hotel ID / User ID
                  </label>
                  <input
                    id="userId"
                    type="text"
                    autoComplete="username"
                    required
                    value={userId}
                    onChange={e => setUserId(e.target.value)}
                    className="mt-1.5 block w-full rounded-lg border border-border px-3.5 py-2.5 text-sm text-ink placeholder-ink/40 outline-none transition focus:border-brand/50 focus:ring-2 focus:ring-brand/20"
                    placeholder="Enter your ID"
                  />
                </div>

                {/* Password */}
                <div>
                  <label htmlFor="password" className="block text-sm font-medium text-ink/70">
                    Password
                  </label>
                  <div className="relative mt-1.5">
                    <input
                      id="password"
                      type={showPwd ? 'text' : 'password'}
                      autoComplete="current-password"
                      required
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                      className="block w-full rounded-lg border border-border px-3.5 py-2.5 pr-10 text-sm text-ink placeholder-ink/40 outline-none transition focus:border-brand/50 focus:ring-2 focus:ring-brand/20"
                      placeholder="Enter your password"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPwd(v => !v)}
                      className="absolute inset-y-0 right-0 flex items-center px-3 text-ink/40 hover:text-ink/60"
                      tabIndex={-1}
                    >
                      {showPwd ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </div>
              </>
            ) : (
              <>
                {/* Hotel ID */}
                <div>
                  <label htmlFor="cashierHotelId" className="block text-sm font-medium text-ink/70">
                    Hotel System ID
                  </label>
                  <input
                    id="cashierHotelId"
                    type="text"
                    autoComplete="off"
                    required
                    value={hotelId}
                    onChange={e => setHotelId(e.target.value.trim())}
                    className="mt-1.5 block w-full rounded-lg border border-border px-3.5 py-2.5 font-mono text-sm text-ink placeholder-ink/40 outline-none transition focus:border-brand/50 focus:ring-2 focus:ring-brand/20"
                    placeholder="Provided by your hotel admin"
                  />
                  <p className="mt-1 text-[11px] text-ink/40">
                    {hotelId
                      ? 'Auto-filled from this device'
                      : 'Ask your hotel admin for this ID'}
                  </p>
                </div>

                {/* Employee Code */}
                <div>
                  <label htmlFor="employeeCode" className="block text-sm font-medium text-ink/70">
                    Employee Code
                  </label>
                  <input
                    id="employeeCode"
                    type="text"
                    autoComplete="username"
                    required
                    value={employeeCode}
                    onChange={e => setEmployeeCode(e.target.value.toUpperCase())}
                    className="mt-1.5 block w-full rounded-lg border border-border px-3.5 py-2.5 text-sm text-ink placeholder-ink/40 outline-none transition focus:border-brand/50 focus:ring-2 focus:ring-brand/20"
                    placeholder="e.g. CSH01"
                  />
                </div>

                {/* PIN */}
                <div>
                  <label htmlFor="pin" className="block text-sm font-medium text-ink/70">
                    PIN
                  </label>
                  <div className="relative mt-1.5">
                    <input
                      id="pin"
                      type={showPin ? 'text' : 'password'}
                      autoComplete="current-password"
                      inputMode="numeric"
                      required
                      value={pin}
                      onChange={e => setPin(e.target.value)}
                      className="block w-full rounded-lg border border-border px-3.5 py-2.5 pr-10 text-sm text-ink placeholder-ink/40 outline-none transition focus:border-brand/50 focus:ring-2 focus:ring-brand/20"
                      placeholder="Enter your PIN"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPin(v => !v)}
                      className="absolute inset-y-0 right-0 flex items-center px-3 text-ink/40 hover:text-ink/60"
                      tabIndex={-1}
                    >
                      {showPin ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </div>
              </>
            )}

            {/* Error */}
            {error && (
              <div className="rounded-lg border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-600">
                {error}
              </div>
            )}

            {/* Submit */}
            <button
              type="submit"
              disabled={loading}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-brand px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-brand/90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading && <Spinner size="sm" />}
              {loading ? 'Signing in…' : 'Sign in'}
            </button>
          </form>

          {/* Role hint */}
          <p className="mt-5 text-center text-[11px] text-ink/40">
            {mode === 'admin'
              ? 'Hotel Owner · Manager'
              : 'Sign in with your employee code and PIN'}
          </p>
        </div>

        {/* Register link */}
        <p className="mt-4 text-center text-sm text-ink/50">
          New to Dine POS?{' '}
          <Link to="/register" className="font-medium text-brand hover:underline">
            Start Free Trial
          </Link>
        </p>

        {/* Footer */}
        <div className="mt-4 flex flex-col items-center gap-2.5 text-xs text-ink/40">
          <span>
            Need help?{' '}
            <a
              href="mailto:support@dinepos.com"
              className="font-medium text-brand hover:underline"
            >
              Contact Support
            </a>
          </span>
          <button
            type="button"
            className="font-medium text-ink/50 transition hover:text-ink/70"
            onClick={() =>
              setError(
                'To reset your password, contact support at support@dinepos.com',
              )
            }
          >
            Forgot Password
          </button>
          <Link to="/super-admin/login" className="text-ink/40 transition hover:text-ink/60">
            Super Admin
          </Link>
          <span className="text-ink/30">Dine POS · {APP_VERSION}</span>
        </div>
      </div>
    </div>
  );
}
