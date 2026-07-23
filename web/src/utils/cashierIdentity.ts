function parseJwtPayload(key: string): Record<string, unknown> {
  try {
    const token = localStorage.getItem(key) ?? '';
    if (!token) return {};
    return JSON.parse(atob(token.split('.')[1])) as Record<string, unknown>;
  } catch { return {}; }
}

function bestPayload(): Record<string, unknown> {
  const p = parseJwtPayload('pos_cashier_token');
  return Object.keys(p).length > 0 ? p : parseJwtPayload('pos_token');
}

export function getCashierName(): string {
  return (bestPayload().name as string | undefined) ?? 'Cashier';
}

export function getCashierId(): string {
  const p = bestPayload();
  return (
    (p.employeeCode as string | undefined) ??
    (p.sub as string | undefined) ??
    ''
  );
}
