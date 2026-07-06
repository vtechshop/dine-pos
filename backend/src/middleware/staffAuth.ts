import { Response, NextFunction } from 'express';
import { AuthRequest } from './auth';
import Waiter from '../models/Waiter';
import Cashier from '../models/Cashier';
import Settings from '../models/Settings';

// Verifies the staff account is still active in the database.
// Must run AFTER authMiddleware (needs req.role, req.hotelId, req.waiterId, req.cashierId).
// Admin tokens (role === undefined) are skipped — hotel status is already checked by authMiddleware.
// On DB error, fails open so a transient outage doesn't lock out operating staff.
export const requireActiveStaff = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    if (req.role === 'waiter') {
      if (!req.waiterId) {
        res.status(401).json({ code: 'INVALID_TOKEN', message: 'Invalid token. Please login again.' });
        return;
      }
      const exists = await Waiter.exists({ _id: req.waiterId, hotelId: req.hotelId, isActive: true });
      if (!exists) {
        res.status(401).json({ code: 'STAFF_DEACTIVATED', message: 'Your account has been deactivated. Contact admin.' });
        return;
      }
    } else if (req.role === 'cashier') {
      if (!req.cashierId) {
        res.status(401).json({ code: 'INVALID_TOKEN', message: 'Invalid token. Please login again.' });
        return;
      }
      const exists = await Cashier.exists({ _id: req.cashierId, hotelId: req.hotelId, isActive: true });
      if (!exists) {
        res.status(401).json({ code: 'STAFF_DEACTIVATED', message: 'Your account has been deactivated. Contact admin.' });
        return;
      }
    } else if (req.role === 'kitchen') {
      // Kitchen uses a shared PIN — if admin clears kitchenPin, revoke all active kitchen JWTs
      const settings = await Settings.findOne({ hotelId: req.hotelId }).select('kitchenPin').lean();
      if (!settings || !(settings as any).kitchenPin) {
        res.status(401).json({ code: 'STAFF_DEACTIVATED', message: 'Kitchen access has been disabled. Contact admin.' });
        return;
      }
    }
    next();
  } catch {
    next(); // DB hiccup — fail open, same pattern as hotel status cache
  }
};
