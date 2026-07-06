import AuditLog from '../models/AuditLog';
import { AuthRequest } from '../middleware/auth';

// Fire-and-forget — never blocks the response. Audit failures are silently swallowed.

// For authenticated routes where authMiddleware has already populated req fields.
export const logAudit = (
  req: AuthRequest,
  action: string,
  targetType: string,
  targetId = '',
  metadata: Record<string, any> = {},
): void => {
  AuditLog.create({
    hotelId:    req.hotelId   || '',
    actorId:    req.cashierId || req.waiterId || req.hotelId || '',
    actorRole:  req.role      || 'admin',
    action,
    targetType,
    targetId,
    metadata,
    ip: (req as any).ip || '',
  }).catch(() => {});
};

// For pre-auth routes (login endpoints) where req.hotelId is not yet set.
export const logAuditRaw = (params: {
  hotelId:    string;
  actorId?:   string;
  actorRole?: string;
  action:     string;
  targetType: string;
  targetId?:  string;
  metadata?:  Record<string, any>;
  ip?:        string;
}): void => {
  AuditLog.create({
    hotelId:    params.hotelId,
    actorId:    params.actorId    || params.hotelId,
    actorRole:  params.actorRole  || 'admin',
    action:     params.action,
    targetType: params.targetType,
    targetId:   params.targetId   || '',
    metadata:   params.metadata   || {},
    ip:         params.ip         || '',
  }).catch(() => {});
};
