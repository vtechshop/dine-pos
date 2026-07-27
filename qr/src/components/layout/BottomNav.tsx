import { NavLink } from 'react-router-dom';
import { UtensilsCrossed, ClipboardList, Receipt } from 'lucide-react';
import { useGuest } from '../../context/GuestContext.tsx';
import { useMenu } from '../../context/MenuContext.tsx';

export function BottomNav() {
  const { hasOrdered, guestToken } = useGuest();
  const { features } = useMenu();
  const tableSessions = features?.tableSessions ?? false;

  return (
    <nav
      className="fixed bottom-0 inset-x-0 z-30 bg-white border-t border-[#E8D5C0] flex"
      style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
    >
      <NavLink
        to="/"
        end
        className={({ isActive }) =>
          `flex-1 flex flex-col items-center py-3 gap-0.5 text-[10px] font-semibold transition-colors ${
            isActive ? 'text-[#E8380D]' : 'text-[#1C0800]/40'
          }`
        }
      >
        <UtensilsCrossed size={20} />
        Menu
      </NavLink>

      {hasOrdered && (
        <NavLink
          to="/orders"
          className={({ isActive }) =>
            `flex-1 flex flex-col items-center py-3 gap-0.5 text-[10px] font-semibold transition-colors ${
              isActive ? 'text-[#E8380D]' : 'text-[#1C0800]/40'
            }`
          }
        >
          <ClipboardList size={20} />
          Orders
        </NavLink>
      )}

      {tableSessions && !!guestToken && hasOrdered && (
        <NavLink
          to="/bill"
          className={({ isActive }) =>
            `flex-1 flex flex-col items-center py-3 gap-0.5 text-[10px] font-semibold transition-colors ${
              isActive ? 'text-[#E8380D]' : 'text-[#1C0800]/40'
            }`
          }
        >
          <Receipt size={20} />
          Bill
        </NavLink>
      )}
    </nav>
  );
}
