const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const isValidDateParam = (s: string): boolean =>
  ISO_DATE_RE.test(s) && !isNaN(new Date(s).getTime());
