import { LogOut, Building2 } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';

export default function TopBar() {
  const { hotelName, logout } = useAuth();
  return (
    <header className="h-14 bg-white border-b border-[#E8D5C0] flex items-center justify-between px-6 shrink-0">
      <div className="flex items-center gap-2 text-sm text-[#92745E]">
        <Building2 size={16} />
        <span className="font-semibold text-[#1C0800]">{hotelName ?? 'Admin Portal'}</span>
      </div>
      <button
        onClick={logout}
        className="flex items-center gap-1.5 text-xs font-semibold text-[#92745E] hover:text-[#E8380D] transition-colors"
      >
        <LogOut size={14} />
        Sign out
      </button>
    </header>
  );
}
