import mongoose from 'mongoose';
import Product from '../models/Product';
import AggregatorIntegration from '../models/AggregatorIntegration';
import { AggregatorService } from '../services/aggregator/AggregatorService';
import { logger } from './logger';

type Platform = 'swiggy' | 'zomato';
const PLATFORMS: Platform[] = ['swiggy', 'zomato'];

/** What Swiggy / Zomato should show for a dish: an admin per-platform override wins,
 *  otherwise it follows the POS (available, not deleted, and not at 0 stock). */
export function deliveryAvailable(
  p: { isAvailable?: boolean; isDeleted?: boolean; stock?: number; channelAvailability?: Partial<Record<Platform, boolean | null>> },
  platform: Platform,
): boolean {
  const override = p.channelAvailability?.[platform];
  if (override === true || override === false) return override;
  return !!p.isAvailable && !p.isDeleted && p.stock !== 0;
}

/**
 * Send the current in/out-of-stock state of these dishes to every connected delivery
 * platform (Swiggy / Zomato) where the dish has been synced. Runs in the background and
 * never throws — a POS stock change must not fail because a platform is down.
 * The connectors themselves skip the real call unless AGGREGATOR_EXTERNAL_ENABLED=true.
 */
export async function pushDeliveryAvailability(hotelId: string, productIds: Array<string | mongoose.Types.ObjectId>): Promise<void> {
  try {
    const ids = [...new Set(productIds.map(String))].filter(id => mongoose.isValidObjectId(id));
    if (ids.length === 0) return;

    const integrations = await AggregatorIntegration.find({ hotelId, enabled: true, platform: { $in: PLATFORMS } });
    if (integrations.length === 0) return;

    const products = await Product.find({ _id: { $in: ids }, hotelId })
      .select('isAvailable isDeleted stock platformIds channelAvailability').lean() as Array<{
        _id: mongoose.Types.ObjectId; isAvailable?: boolean; isDeleted?: boolean; stock?: number;
        platformIds?: Partial<Record<Platform, string>>;
        channelAvailability?: Partial<Record<Platform, boolean | null>>;
      }>;

    for (const integ of integrations) {
      const platform = integ.platform as Platform;
      for (const p of products) {
        const itemId = p.platformIds?.[platform];
        if (!itemId) continue;   // dish not on this platform's menu yet
        AggregatorService.updateItemAvailability(integ, itemId, deliveryAvailable(p, platform))
          .catch(err => logger.warn('[deliveryAvailability] platform update failed', {
            hotelId, platform, productId: String(p._id), error: String(err),
          }));
      }
    }
  } catch (err) {
    logger.warn('[deliveryAvailability] sync skipped', { hotelId, error: String(err) });
  }
}
