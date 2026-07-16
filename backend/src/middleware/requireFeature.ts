import { Response, NextFunction } from 'express';
import { AuthRequest } from './auth';
import { resolveHotelStatus } from './auth';
import { IFeatureFlags } from '../models/Hotel';

// BooleanFeatureKey restricts requireFeature() to boolean-typed flags only.
// Non-boolean flags (e.g. customerIdentification, which is a string enum)
// must be checked directly in route handlers, not via this middleware.
type BooleanFeatureKey = {
  [K in keyof IFeatureFlags]: IFeatureFlags[K] extends boolean ? K : never;
}[keyof IFeatureFlags];

// Defaults mirror the Hotel schema defaults exactly.
// customerIdentification and other non-boolean flags are excluded from this map
// because requireFeature() only operates on boolean flags.
const FEATURE_DEFAULTS: Record<BooleanFeatureKey, boolean> = {
  // ── Existing flags ───────────────────────────────────────────────────────
  payment:      false,
  reservations: true,
  customerChat: true,
  qrOrdering:   true,
  expenses:     true,
  reports:      true,
  tables:       true,
  ingredients:  false,
  waste:        false,
  aggregator:   false,
  // ── Architecture v1.1 additions ─────────────────────────────────────────
  tableSessions:          false,
  customerDatabase:       false,
  loyaltyProgram:         false,
  birthdayOffers:         false,
  whatsappNotifications:  false,
  smsNotifications:       false,
  digitalReceipts:        false,
  customerOrderHistory:   false,
  marketingCampaigns:     false,
};

/**
 * Middleware factory — returns 403 if the hotel's boolean feature flag is disabled.
 * Reads from the Redis status cache (warm on first request, cached for 45 s).
 * Must run after authMiddleware (needs req.hotelId).
 *
 * NOTE: Only accepts boolean feature keys. For string-enum flags like
 * customerIdentification, check hotel.features directly in the route handler.
 */
export const requireFeature = (feature: BooleanFeatureKey) =>
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    if (!req.hotelId) {
      res.status(401).json({ message: 'Authentication required' });
      return;
    }

    try {
      const entry = await resolveHotelStatus(req.hotelId);
      const features = (entry.features ?? {}) as Partial<Record<BooleanFeatureKey, boolean>>;
      const enabled: boolean = feature in features
        ? Boolean(features[feature])
        : FEATURE_DEFAULTS[feature];

      if (!enabled) {
        res.status(403).json({
          code: 'FEATURE_DISABLED',
          message: `The '${feature}' feature is not enabled for your plan. Contact support to upgrade.`,
        });
        return;
      }

      next();
    } catch {
      res.status(503).json({ message: 'Service temporarily unavailable. Please try again.' });
    }
  };
