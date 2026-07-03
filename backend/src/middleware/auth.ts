import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import Hotel from '../models/Hotel';
import RefreshToken from '../models/RefreshToken';

export interface AuthRequest extends Request {
  hotelId?: string;
  hotelName?: string;
}

const JWT_SECRET = process.env.JWT_SECRET || 'hotelbillingpos_secret_key_change_in_production';

// ── Per-hotel status cache ────────────────────────────────────────────────────
// Avoids a DB round-trip on every authenticated request.
// TTL is short (45 s) so suspensions take effect quickly without polling.
interface StatusEntry { status: string; expiresAt: number }
const _statusCache = new Map<string, StatusEntry>();
const STATUS_TTL_MS = 45_000;

async function resolveHotelStatus(hotelId: string): Promise<string> {
  const now = Date.now();
  const cached = _statusCache.get(hotelId);
  if (cached && cached.expiresAt > now) return cached.status;

  const hotel = await Hotel.findById(hotelId).select('status trialEndDate').lean();
  if (!hotel) return 'not_found';

  let status = (hotel as any).status as string;

  // Auto-detect expired trial even if the background cron hasn't run yet
  if (status === 'trial' && (hotel as any).trialEndDate && (hotel as any).trialEndDate < new Date()) {
    status = 'expired';
    Hotel.findByIdAndUpdate(hotelId, { status: 'expired' }).catch(() => {});
  }

  _statusCache.set(hotelId, { status, expiresAt: now + STATUS_TTL_MS });
  return status;
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
    const decoded = jwt.verify(token, JWT_SECRET) as { hotelId: string; hotelName: string };
    req.hotelId = decoded.hotelId;
    req.hotelName = decoded.hotelName;

    // Check current hotel status — a live JWT is not enough
    let status: string;
    try {
      status = await resolveHotelStatus(decoded.hotelId);
    } catch {
      // DB hiccup: fail open so a momentary outage doesn't lock out paying customers
      console.error('[authMiddleware] status cache lookup failed for', decoded.hotelId);
      next();
      return;
    }

    switch (status) {
      case 'not_found':
        res.status(401).json({ message: 'Hotel account not found. Please contact support.' });
        return;
      case 'suspended':
        res.status(403).json({ code: 'ACCOUNT_SUSPENDED', message: 'Your account has been suspended. Please contact support.' });
        return;
      case 'expired':
        res.status(403).json({ code: 'TRIAL_EXPIRED', message: 'Your trial has expired. Please subscribe to continue.' });
        return;
      case 'pending':
      case 'rejected':
        res.status(403).json({ code: 'ACCOUNT_INACTIVE', message: 'Your account is not active. Please contact support.' });
        return;
    }

    next();
  } catch {
    res.status(401).json({ message: 'Invalid or expired session. Please login again.' });
  }
};

export const generateToken = (hotelId: string, hotelName: string): string => {
  return jwt.sign({ hotelId, hotelName }, JWT_SECRET, { expiresIn: '24h' });
};

export const generateKitchenToken = (hotelId: string): string => {
  return jwt.sign({ hotelId, role: 'kitchen' }, JWT_SECRET, { expiresIn: '12h' });
};

export const generateRefreshToken = async (hotelId: string): Promise<string> => {
  const token = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days
  await RefreshToken.create({ token, hotelId, expiresAt });
  return token;
};
