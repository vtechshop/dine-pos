import { useState, type FormEvent } from 'react';
import { Navigate, Link } from 'react-router-dom';
import { Eye, EyeOff, ShieldCheck } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { Spinner } from '../../components/ui/Spinner';

export function SuperAdminLoginPage() {
  const { role, isAuthenticated, loginSuperAdmin } = useAuth();
  const [userId,   setUserId]   = useState('');
  const [password, setPassword] = useState('');
  const [showPwd,  setShowPwd]  = useState(false);
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState<string | null>(null);

  if (isAuthenticated && role === 'superadmin') {
    return <Navigate to="/super-admin/hotels" replace />;
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await loginSuperAdmin(userId.trim(), password);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-mist px-4">
      <div className="w-full max-w-sm">

        <div className="mb-8 text-center">
          <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-ink shadow-md">
            <ShieldCheck className="h-7 w-7 text-canvas" strokeWidth={1.5} />
          </div>
          <h1 className="text-2xl font-bold text-ink">Super Admin</h1>
          <p className="mt-1 text-sm text-ink/50">Dine POS administration portal</p>
        </div>

        <div className="rounded-2xl border border-border bg-canvas p-8 shadow-sm">
          <form onSubmit={handleSubmit} className="space-y-5">

            <div>
              <label htmlFor="userId" className="block text-sm font-medium text-ink/70">
                Admin ID
              </label>
              <input
                id="userId" type="text" autoComplete="username" required
                value={userId} onChange={e => setUserId(e.target.value)}
                className="mt-1.5 block w-full rounded-lg border border-border bg-canvas px-3.5 py-2.5 text-sm text-ink placeholder-ink/40 outline-none transition focus:border-brand/50 focus:ring-2 focus:ring-brand/20"
                placeholder="Enter admin ID"
              />
            </div>

            <div>
              <label htmlFor="password" className="block text-sm font-medium text-ink/70">
                Password
              </label>
              <div className="relative mt-1.5">
                <input
                  id="password"
                  type={showPwd ? 'text' : 'password'}
                  autoComplete="current-password" required
                  value={password} onChange={e => setPassword(e.target.value)}
                  className="block w-full rounded-lg border border-border bg-canvas px-3.5 py-2.5 pr-10 text-sm text-ink placeholder-ink/40 outline-none transition focus:border-brand/50 focus:ring-2 focus:ring-brand/20"
                  placeholder="Enter password"
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

            {error && (
              <div className="rounded-lg border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-600">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-ink px-4 py-2.5 text-sm font-semibold text-canvas transition hover:bg-ink/80 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading && <Spinner size="sm" />}
              {loading ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
        </div>

        <p className="mt-6 text-center text-xs text-ink/40">
          <Link to="/login" className="hover:text-ink/60 transition">← Hotel staff login</Link>
        </p>
      </div>
    </div>
  );
}
