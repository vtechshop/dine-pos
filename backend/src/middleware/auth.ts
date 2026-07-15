import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import Hotel from '../models/Hotel';
import RefreshToken from '../models/RefreshToken';

export interface AuthRequest extends Request {
  hotelId?: string;
  hotelName?: string;
  role?: string;
  waiterId?: string;
  waiterName?: string;
  cashierId?: string;
  cashierName?: string;
}

const JWT_SECRET = process.env.JWT_SECRET!;

// ── Per-hotel status cache ────────────────────────────────────────────────────
// Short TTL (45 s) so suspensions / plan changes take effect quickly.
interface StatusEntry {
  status: string;
  expiresAt: number;
  hotelName: string;
  expiredOn: string | null;
  subscriptionType: string;
}

const _statusCache = new Map<string, StatusEntry>();
const STATUS_TTL_MS = 45_000;

async function resolveHotelStatus(hotelId: string): Promise<StatusEntry> {
  const now = Date.now();
  const cached = _statusCache.get(hotelId);
  if (cached && cached.expiresAt > now) return cached;

  const hotel = await Hotel.findById(hotelId)
    .select('status trialEndDate subscriptionType subscriptionEndDate hotelName')
    .lean();

  if (!hotel) {
    return { status: 'not_found', expiresAt: now + STATUS_TTL_MS, hotelName: '', expiredOn: null, subscriptionType: 'trial' };
  }

  const h = hotel as any;
  let status: string = h.status;
  let expiredOn: string | null = null;

  // Auto-expire: trial past its end date
  if (status === 'trial') {
    const end = h.subscriptionEndDate || h.trialEndDate;
    if (end && new Date(end) < new Date()) {
      status = 'expired';
      expiredOn = new Date(end).toISOString();
      Hotel.findByIdAndUpdate(hotelId, { status: 'expired' }).catch(() => {});
    }
  }

  // Auto-expire: active subscription past its end date
  if (status === 'active') {
    const end = h.subscriptionEndDate || h.planExpiryDate;
    if (end && new Date(end) < new Date()) {
      status = 'expired';
      expiredOn = new Date(end).toISOString();
      Hotel.findByIdAndUpdate(hotelId, { status: 'expired' }).catch(() => {});
    }
  }

  // Record expiredOn for trial/active without auto-expire (already expired status)
  if (status === 'expired' && !expiredOn) {
    const end = h.subscriptionEndDate || h.trialEndDate || h.planExpiryDate;
    expiredOn = end ? new Date(end).toISOString() : null;
  }

  const entry: StatusEntry = {
    status,
    expiresAt: now + STATUS_TTL_MS,
    hotelName: h.hotelName || '',
    expiredOn,
    subscriptionType: h.subscriptionType || 'trial',
  };

  _statusCache.set(hotelId, entry);
  return entry;
}

// Call this after any super-admin action that changes hotel status so the
// new status takes effect immediately rather than waiting for TTL expiry.
export const invalidateStatusCache = (hotelId: string): void => {
  _statusCache.delete(hotelId);
};

// ── Auth middleware ───────────────────────────────────────────────────────────
export const authMiddleware = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ message: 'Authentication required. Please login.' });
    return;
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as {
      hotelId: string; hotelName?: string; role?: string;
      waiterId?: string; waiterName?: string;
      cashierId?: string; cashierName?: string;
    };
    req.hotelId     = decoded.hotelId;
    req.hotelName   = decoded.hotelName;
    req.role        = decoded.role;
    req.waiterId    = decoded.waiterId;
    req.waiterName  = decoded.waiterName;
    req.cashierId   = decoded.cashierId;
    req.cashierName = decoded.cashierName;

    // Check current hotel status — a live JWT is not enough
    let entry: StatusEntry;
    try {
      entry = await resolveHotelStatus(decoded.hotelId);
    } catch {
      console.error('[authMiddleware] status cache lookup failed for', decoded.hotelId);
      res.status(503).json({ message: 'Service temporarily unavailable. Please try again.' });
      return;
    }

    const { status, hotelName, expiredOn, subscriptionType } = entry;

    switch (status) {
      case 'not_found':
        res.status(401).json({ message: 'Hotel account not found. Please contact support.' });
        return;

      case 'pending':
        res.status(403).json({
          code: 'HOTEL_PENDING_APPROVAL',
          message: 'Your registration is under review. Please wait for approval.',
        });
        return;

      case 'rejected':
        res.status(403).json({
          code: 'HOTEL_REJECTED',
          message: 'Your registration was rejected. Please contact support or resubmit.',
        });
        return;

      case 'suspended':
        res.status(403).json({
          code: 'HOTEL_SUSPENDED',
          message: 'Your account has been suspended. Please contact support.',
          hotelName,
        });
        return;

      case 'expired': {
        const isTrial = subscriptionType === 'trial' || !subscriptionType;
        res.status(403).json({
          code: isTrial ? 'TRIAL_EXPIRED' : 'PLAN_EXPIRED',
          message: isTrial
            ? 'Your free trial has ended. Please subscribe to continue.'
            : 'Your subscription has expired. Please renew to continue.',
          hotelName,
          expiredOn,
          subscriptionType,
        });
        return;
      }
    }

    // trial and active: allow
    next();
  } catch {
    res.status(401).json({ message: 'Invalid or expired session. Please login again.' });
  }
};

// ── Role guard middleware ─────────────────────────────────────────────────────
export const requireAdmin = (req: AuthRequest, res: Response, next: NextFunction): void => {
  if (req.role !== 'admin') {
    res.status(403).json({ message: 'Access denied. Admin only.' });
    return;
  }
  next();
};

export const requireKitchenOrAdmin = (req: AuthRequest, res: Response, next: NextFunction): void => {
  if (req.role !== 'kitchen' && req.role !== 'admin') {
    res.status(403).json({ message: 'Access denied.' });
    return;
  }
  next();
};

export const requireWaiterOrAdmin = (req: AuthRequest, res: Response, next: NextFunction): void => {
  if (req.role !== 'waiter' && req.role !== 'admin') {
    res.status(403).json({ message: 'Access denied.' });
    return;
  }
  next();
};

export const requireCashierOrAdmin = (req: AuthRequest, res: Response, next: NextFunction): void => {
  if (req.role !== 'cashier' && req.role !== 'admin') {
    res.status(403).json({ message: 'Access denied.' });
    return;
  }
  next();
};

// Waiter, cashier, or admin can create/manage orders — kitchen is read-only for orders
export const requireWaiterOrCashierOrAdmin = (req: AuthRequest, res: Response, next: NextFunction): void => {
  if (req.role !== 'waiter' && req.role !== 'cashier' && req.role !== 'admin') {
    res.status(403).json({ message: 'Access denied.' });
    return;
  }
  next();
};

export const generateToken = (hotelId: string, hotelName: string): string => {
  return jwt.sign({ hotelId, hotelName, role: 'admin' }, JWT_SECRET, { expiresIn: '24h' });
};

export const generateKitchenToken = (hotelId: string): string => {
  return jwt.sign({ hotelId, role: 'kitchen' }, JWT_SECRET, { expiresIn: '12h' });
};

export const generateWaiterToken = (hotelId: string, waiterId: string, waiterName: string): string => {
  return jwt.sign({ hotelId, role: 'waiter', waiterId, waiterName }, JWT_SECRET, { expiresIn: '12h' });
};

export const generateCashierToken = (hotelId: string, cashierId: string, cashierName: string): string => {
  return jwt.sign({ hotelId, role: 'cashier', cashierId, cashierName }, JWT_SECRET, { expiresIn: '12h' });
};

export const generateRefreshToken = async (hotelId: string): Promise<string> => {
  const token = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  await RefreshToken.create({ token, hotelId, expiresAt });
  return token;
};
