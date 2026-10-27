import type { Request, Response, NextFunction } from 'express';

// Blocks MongoDB operator injection: a body or query value like
// { "hotelId": { "$ne": null } } or ?table[$ne]=x would otherwise reach
// Model.find({...}) as a query operator and match other records / tenants.
// Request input never legitimately carries "$"-prefixed keys, so drop them.
function stripOperators(value: unknown, depth = 0): unknown {
  if (depth > 20 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) value[i] = stripOperators(value[i], depth + 1);
    return value;
  }
  for (const key of Object.keys(value as Record<string, unknown>)) {
    if (key.startsWith('$')) {
      delete (value as Record<string, unknown>)[key];
    } else {
      (value as Record<string, unknown>)[key] = stripOperators((value as Record<string, unknown>)[key], depth + 1);
    }
  }
  return value;
}

export function sanitizeRequest(req: Request, _res: Response, next: NextFunction): void {
  if (req.body && typeof req.body === 'object') stripOperators(req.body);
  if (req.query && typeof req.query === 'object') stripOperators(req.query);
  if (req.params && typeof req.params === 'object') stripOperators(req.params);
  next();
}

export { stripOperators };
