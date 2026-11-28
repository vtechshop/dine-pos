// Phase 5 · Batch 7 (P4-AUTH-01/02): send a session to its own area BEFORE the app first renders.
// The route guards in App.tsx redirect too, but only after React has drawn the page, so a waiter or
// Super Admin session briefly opened the cashier POS / dashboard first. This runs synchronously at
// start-up from what the session stored, and only rewrites the address (no reload, no data).

const PUBLIC = ['/login', '/register', '/support', '/customer-display', '/subscription-expired'];
const isPublic = (p: string) => PUBLIC.some(x => p === x || p.startsWith(`${x}/`));

/** Where a stored session must not be, and where it goes instead (null = stay). */
export function bootRedirect(path: string, store: Pick<Storage, 'getItem'>): string | null {
  if (isPublic(path)) return null;
  const role = store.getItem('pos_role');
  if (role === 'superadmin' && store.getItem('sa_token')) {
    return path.startsWith('/super-admin') ? null : '/super-admin/hotels';
  }
  if (role === 'waiter' && store.getItem('pos_token')) {
    // a waiter's only web screen is Tables (and Help)
    return path === '/tables' || path === '/help' || path.startsWith('/super-admin') ? null : '/tables';
  }
  return null;
}

export function applyBootRedirect(): void {
  try {
    const to = bootRedirect(window.location.pathname, window.localStorage);
    if (to) window.history.replaceState(null, '', to);
  } catch { /* storage blocked: the in-app guards still apply */ }
}
