// Display label for an order's tableNumber.
// Waiters send a bare number ("6"); admin billing sends the table's name ("Table 6"),
// and parcel orders carry "Takeaway" / "Swiggy" / "Zomato". Only a bare number gets "Table ".
export const tableLabel = (tableNumber?: string | number | null): string => {
  const t = String(tableNumber ?? '').trim();
  if (!t) return '';
  return /^\d+[A-Za-z]?$/.test(t) ? `Table ${t}` : t;
};
