import { useState, useEffect, useRef } from 'react';
import { GitBranch, ChevronDown, Building2, Loader2, AlertCircle } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { getBranchContext, switchBranch, type BranchContext } from '../api/branches';

export function BranchSwitcher() {
  const { hotelId, hotelName, orgHotelId, orgHotelName, isInBranchContext, switchToBranch, switchToOrg } = useAuth();

  const [context, setContext]   = useState<BranchContext | null>(null);
  const [open, setOpen]         = useState(false);
  const [switching, setSwitching] = useState(false);
  const [error, setError]       = useState<string | null>(null);
  const dropdownRef             = useRef<HTMLDivElement>(null);

  // Reload context whenever hotelId changes (after switching)
  useEffect(() => {
    let cancelled = false;
    getBranchContext()
      .then(ctx => { if (!cancelled) setContext(ctx); })
      .catch(() => {}); // silently ignore — single-branch hotels just won't render
    return () => { cancelled = true; };
  }, [hotelId]);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  // Only render if this hotel has branches
  if (!context || context.branches.length === 0) return null;

  const activeName = isInBranchContext ? hotelName : (orgHotelName || context.orgHotelName || hotelName);
  const activeLabel = isInBranchContext ? 'Branch' : 'Headquarters';

  const handleSwitchToBranch = async (branchId: string) => {
    if (branchId === hotelId) { setOpen(false); return; }
    setSwitching(true);
    setError(null);
    try {
      const data = await switchBranch(branchId);
      switchToBranch({
        branchToken:        data.branchToken,
        branchRefreshToken: data.branchRefreshToken,
        branchId:           data.branchId,
        branchName:         data.branchName,
        orgHotelId:         data.orgHotelId,
        orgHotelName:       data.orgHotelName,
      });
      // Full reload: clears all React state, reconnects socket with branch JWT,
      // eliminates stale CashierContext (cart, shift, heldBills) from previous branch.
      window.location.reload();
    } catch (e: any) {
      setError(e?.message || 'Failed to switch branch');
      setSwitching(false);
    }
    // Note: setSwitching(false) is intentionally omitted on success — the reload makes it moot.
  };

  const handleSwitchToOrg = async () => {
    if (!isInBranchContext) { setOpen(false); return; }
    await switchToOrg();
    // Full reload: ensures socket reconnects with HQ JWT and all branch-specific state is cleared.
    // If switchToOrg() failed (refresh expired), it already cleared auth — reload will show login page.
    window.location.reload();
  };

  return (
    <div ref={dropdownRef} className="relative mx-3 mb-2">
      <button
        onClick={() => setOpen(v => !v)}
        className="flex w-full items-center gap-2 rounded-lg border border-white/10 bg-white/[0.05] px-3 py-2 text-left text-xs text-white/80 hover:bg-white/[0.10] transition-colors"
        disabled={switching}
      >
        <GitBranch size={13} className="shrink-0 text-white/50" />
        <span className="flex-1 truncate leading-tight">
          <span className="block text-[9px] uppercase tracking-widest text-white/40">{activeLabel}</span>
          <span className="block truncate font-medium text-white/90">{activeName}</span>
        </span>
        {switching
          ? <Loader2 size={13} className="shrink-0 animate-spin text-white/40" />
          : <ChevronDown size={13} className={`shrink-0 text-white/40 transition-transform ${open ? 'rotate-180' : ''}`} />
        }
      </button>

      {error && (
        <div className="mt-1 flex items-center gap-1.5 rounded-lg bg-red-500/15 px-2 py-1.5 text-[10px] text-red-300">
          <AlertCircle size={11} />
          <span>{error}</span>
        </div>
      )}

      {open && (
        <div className="absolute left-0 right-0 top-full z-50 mt-1 rounded-lg border border-white/10 bg-[#1c1c1e] py-1 shadow-xl">
          {/* HQ option */}
          <button
            onClick={handleSwitchToOrg}
            className={`flex w-full items-center gap-2 px-3 py-2 text-left text-xs transition-colors hover:bg-white/[0.08] ${!isInBranchContext ? 'text-white' : 'text-white/60'}`}
          >
            <Building2 size={12} className="shrink-0" />
            <span className="flex-1 truncate">
              <span className="block text-[9px] uppercase tracking-widest text-white/35">Headquarters</span>
              <span className="block truncate">{context.orgHotelName}</span>
            </span>
            {!isInBranchContext && <span className="text-[9px] text-green-400">active</span>}
          </button>

          {context.branches.length > 0 && (
            <div className="mx-2 my-1 border-t border-white/[0.06]" />
          )}

          {context.branches.map(branch => {
            const isActive = isInBranchContext && hotelId === branch._id;
            const isSuspended = branch.status === 'suspended';
            return (
              <button
                key={branch._id}
                onClick={() => !isSuspended && handleSwitchToBranch(branch._id)}
                disabled={isSuspended || switching}
                className={`flex w-full items-center gap-2 px-3 py-2 text-left text-xs transition-colors ${
                  isSuspended
                    ? 'cursor-not-allowed opacity-40'
                    : isActive
                      ? 'text-white hover:bg-white/[0.08]'
                      : 'text-white/60 hover:bg-white/[0.08] hover:text-white'
                }`}
              >
                <GitBranch size={12} className="shrink-0" />
                <span className="flex-1 truncate">
                  {branch.branchCode && (
                    <span className="block text-[9px] uppercase tracking-widest text-white/35">{branch.branchCode}</span>
                  )}
                  <span className="block truncate">{branch.branchName || branch.hotelName}</span>
                </span>
                {isActive && <span className="text-[9px] text-green-400">active</span>}
                {isSuspended && <span className="text-[9px] text-red-400">off</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
