import { useState, useRef } from 'react';
import { Navigate } from 'react-router-dom';
import { Loader2, ChevronRight, Eye, EyeOff } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

export default function LoginPage() {
  const { isAuthenticated, login } = useAuth();
  const [userId,   setUserId]   = useState('');
  const [password, setPassword] = useState('');
  const [showPw,   setShowPw]   = useState(false);
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState('');
  const pwRef = useRef<HTMLInputElement>(null);

  if (isAuthenticated) return <Navigate to="/dashboard" replace />;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userId.trim() || !password.trim()) { setError('Enter your user ID and password.'); return; }
    setLoading(true);
    setError('');
    try {
      await login(userId.trim(), password);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Login failed. Check your credentials.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#1C0800] flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="flex flex-col items-center mb-8 gap-3">
          <div className="h-14 w-14 bg-[#E8380D] rounded-2xl flex items-center justify-center shadow-lg">
            <ChevronRight size={24} className="text-white" />
          </div>
          <div className="text-center">
            <h1 className="text-white text-2xl font-black">DinePOS</h1>
            <p className="text-[#92745E] text-sm">Admin Portal</p>
          </div>
        </div>

        {/* Card */}
        <div className="bg-white rounded-2xl shadow-2xl p-8">
          <h2 className="text-lg font-black text-[#1C0800] mb-6">Sign in</h2>
          {error && (
            <div className="mb-4 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700 font-semibold">
              {error}
            </div>
          )}
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div>
              <label className="block text-xs font-bold text-[#92745E] uppercase tracking-wide mb-1">User ID</label>
              <input
                type="text"
                value={userId}
                onChange={e => setUserId(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && pwRef.current?.focus()}
                placeholder="admin@restaurant.com"
                autoFocus
                className="w-full rounded-lg border border-[#E8D5C0] px-3 py-2.5 text-sm text-[#1C0800] placeholder-[#C4A090] focus:outline-none focus:border-[#E8380D] focus:ring-1 focus:ring-[#E8380D]"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-[#92745E] uppercase tracking-wide mb-1">Password</label>
              <div className="relative">
                <input
                  ref={pwRef}
                  type={showPw ? 'text' : 'password'}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full rounded-lg border border-[#E8D5C0] px-3 py-2.5 pr-10 text-sm text-[#1C0800] placeholder-[#C4A090] focus:outline-none focus:border-[#E8380D] focus:ring-1 focus:ring-[#E8380D]"
                />
                <button
                  type="button"
                  onClick={() => setShowPw(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[#92745E] hover:text-[#1C0800]"
                >
                  {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>
            <button
              type="submit"
              disabled={loading}
              className="mt-2 w-full rounded-lg bg-[#E8380D] hover:bg-[#C42F08] text-white font-bold py-2.5 text-sm flex items-center justify-center gap-2 disabled:opacity-60 transition-colors"
            >
              {loading && <Loader2 size={16} className="animate-spin" />}
              {loading ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
        </div>
        <p className="text-center text-[#664433] text-xs mt-6">Admin access only · DinePOS v1.0</p>
      </div>
    </div>
  );
}
