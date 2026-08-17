import mongoose from 'mongoose';
import Coupon from '../models/Coupon';
import Product from '../models/Product';

export interface CouponResult {
  couponId:       mongoose.Types.ObjectId;
  couponCode:     string;
  couponDiscount: number;
}

/**
 * Validates a coupon code server-side and returns the authoritative discount.
 * Returns null when couponCode is absent/empty.
 * Throws with a code property (COUPON_*) on validation failure.
 *
 * @param couponCode     - raw code from client
 * @param hotelId        - always from req.hotelId (JWT — never trust client)
 * @param orderTotal     - subtotal + taxTotal before any discounts
 * @param enrichedItems  - items after validateAndEnrichItems (for scope check)
 */
export async function resolveCoupon(
  couponCode: string | undefined | null,
  hotelId: string,
  orderTotal: number,
  enrichedItems: Array<{ product?: mongoose.Types.ObjectId | string }> = [],
): Promise<CouponResult | null> {
  if (!couponCode || !String(couponCode).trim()) return null;

  const code = String(couponCode).trim().toUpperCase();
  const now  = new Date();

  const coupon = await Coupon.findOne({
    hotelId:   new mongoose.Types.ObjectId(hotelId),
    code,
    isActive:  true,
    isDeleted: false,
  }).lean();

  if (!coupon) {
    const e = new Error('Invalid or inactive coupon code');
    (e as any).code = 'COUPON_NOT_FOUND';
    throw e;
  }

  if (coupon.validFrom > now) {
    const e = new Error('Coupon is not yet active');
    (e as any).code = 'COUPON_INACTIVE';
    throw e;
  }

  if (coupon.validUntil && coupon.validUntil < now) {
    const e = new Error('Coupon has expired');
    (e as any).code = 'COUPON_EXPIRED';
    throw e;
  }

  if (coupon.usageLimit > 0 && coupon.usageCount >= coupon.usageLimit) {
    const e = new Error('Coupon usage limit reached');
    (e as any).code = 'COUPON_USAGE_LIMIT';
    throw e;
  }

  if (coupon.minOrderValue > 0 && orderTotal < coupon.minOrderValue) {
    const e = new Error(`Minimum order value ₹${coupon.minOrderValue} required for this coupon`);
    (e as any).code = 'MIN_ORDER_VALUE';
    throw e;
  }

  // ── Scope: applicable products + categories ──────────────────────────────────
  const hasProductScope  = coupon.applicableProducts.length > 0;
  const hasCategoryScope = coupon.applicableCategories.length > 0;

  if (hasProductScope || hasCategoryScope) {
    const itemProductIds = enrichedItems
      .filter(i => i.product)
      .map(i => String(i.product));

    if (hasProductScope) {
      const allowedSet = new Set(coupon.applicableProducts.map(String));
      if (!itemProductIds.some(id => allowedSet.has(id))) {
        const e = new Error('No items in this order qualify for this coupon');
        (e as any).code = 'COUPON_NOT_APPLICABLE';
        throw e;
      }
    }

    if (hasCategoryScope && itemProductIds.length > 0) {
      const prods = await Product.find({
        _id:     { $in: itemProductIds.map(id => new mongoose.Types.ObjectId(id)) },
        hotelId,
      }).select('_id category').lean();
      const allowedCats = new Set(coupon.applicableCategories.map(String));
      const hasMatch = (prods as any[]).some(
        (p: any) => p.category && allowedCats.has(String(p.category)),
      );
      if (!hasMatch) {
        const e = new Error('No items in this order qualify for this coupon');
        (e as any).code = 'COUPON_NOT_APPLICABLE';
        throw e;
      }
    }
  }

  // ── Discount calculation ──────────────────────────────────────────────────────
  let couponDiscount = 0;
  if (coupon.type === 'percent') {
    couponDiscount = (orderTotal * coupon.value) / 100;
    if (coupon.maxDiscount > 0) couponDiscount = Math.min(couponDiscount, coupon.maxDiscount);
  } else {
    couponDiscount = coupon.value;
  }
  couponDiscount = Math.min(couponDiscount, orderTotal);
  couponDiscount = Math.round(couponDiscount * 100) / 100;

  return {
    couponId:       coupon._id as mongoose.Types.ObjectId,
    couponCode:     coupon.code,
    couponDiscount,
  };
}
