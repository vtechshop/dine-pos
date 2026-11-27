// Phase 5 · Batch 4: one way to price the lines of a guest's QR / kiosk order, used by
// POST /api/public/qr/orders and the legacy POST /api/public/orders.
//
//  - P4-QR-04  an item that is unavailable, deleted or unknown refuses the whole order and the
//              guest is told which one (it used to be dropped silently and the rest charged);
//  - P4-QR-09  each line keeps the guest's instruction (e.g. "nut allergy") for the kitchen;
//  - new       the chosen size and add-ons are priced and saved, by the same rules as the POS
//              (orderRoutes.validateAndEnrichItems): a size's own price, plus each add-on's price.
//              Without a size the QR / kiosk channel price applies when set, else the base price.
//
// Only server-side values go on the saved line; nothing else from the client's line is copied.
// Tax per line is unit × quantity × tax % (unrounded); the order rounds the sums to paise,
// exactly as before.
import mongoose from 'mongoose';
import Product from '../models/Product';
import ModifierGroup from '../models/ModifierGroup';

export interface QrPricingRefusal {
  status:       400 | 409;
  code:         'INVALID_ITEM' | 'ITEM_UNAVAILABLE';
  message:      string;
  unavailable?: { product: string; name: string }[];
}

/** Exactly one of the two is set. */
export interface QrPricingOutcome {
  result:  QrPricedItems | null;
  refusal: QrPricingRefusal | null;
}

export interface QrPricedItems {
  validatedItems: any[];
  subtotal:       number;
  taxTotal:       number;
}

const isId = (v: unknown) => mongoose.isValidObjectId(String(v ?? ''));
const nameList = (names: string[]) =>
  names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;

const OPTION_GONE = 'One of the options you chose is no longer available. Please remove the item from your cart and add it again.';

export async function priceQrItems(
  clientItems: any[],
  hotelId: string,
  source: 'qr' | 'kiosk' | 'dine-in',
): Promise<QrPricingOutcome> {
  if (clientItems.some(ci => !ci || !isId(ci.product))) {
    return { result: null, refusal: { status: 400, code: 'INVALID_ITEM', message: 'Your cart has an item that is not on the menu. Please remove it and try again.' } };
  }

  const ids = [...new Set(clientItems.map(ci => String(ci.product)))];
  const groupIds = [...new Set(clientItems.flatMap(ci => (Array.isArray(ci.selectedModifiers) ? ci.selectedModifiers : []))
    .map((m: any) => m?.modifierGroupId).filter(isId).map(String))];

  const [products, groups] = await Promise.all([
    Product.find({ _id: { $in: ids }, hotelId })
      .select('_id name price taxPercent channelPrices variants isAvailable isDeleted hsnCode').lean(),
    groupIds.length
      ? ModifierGroup.find({ _id: { $in: groupIds }, hotelId, isDeleted: false, isActive: true }).lean()
      : Promise.resolve([]),
  ]);
  const productMap = new Map<string, any>(products.map((p: any) => [String(p._id), p]));
  const groupMap   = new Map<string, any>((groups as any[]).map(g => [String(g._id), g]));

  // P4-QR-04: refuse and name every line that can no longer be ordered
  const unavailable: { product: string; name: string }[] = [];
  for (const ci of clientItems) {
    const p = productMap.get(String(ci.product));
    if (!p || p.isDeleted === true || p.isAvailable === false) {
      const name = String(p?.name ?? ci.name ?? ci.productName ?? 'An item').slice(0, 60);
      if (!unavailable.some(u => u.product === String(ci.product))) unavailable.push({ product: String(ci.product), name });
    }
  }
  if (unavailable.length) {
    const names = unavailable.map(u => u.name);
    return { result: null, refusal: {
      status: 409, code: 'ITEM_UNAVAILABLE', unavailable,
      message: `Sorry, ${nameList(names)} ${names.length === 1 ? 'is' : 'are'} no longer available. Please remove ${names.length === 1 ? 'it' : 'them'} from your cart and try again.`,
    } };
  }

  let subtotal = 0;
  let taxTotal = 0;
  const validatedItems: any[] = [];

  for (const ci of clientItems) {
    const prod = productMap.get(String(ci.product));
    const qty  = Math.max(1, Math.floor(Number(ci.quantity) || 1));

    let unitPrice: number;
    let variantId = '';
    let variantName = '';
    if (ci.variantId) {
      const v = isId(ci.variantId) ? (prod.variants ?? []).find((x: any) => String(x._id) === String(ci.variantId)) : null;
      if (!v) return { result: null, refusal: { status: 409, code: 'ITEM_UNAVAILABLE', message: OPTION_GONE } };
      unitPrice   = Number(v.price) || 0;
      variantId   = String(v._id);
      variantName = String(v.name ?? '');
    } else {
      const channel = source === 'kiosk' ? prod.channelPrices?.kiosk : source === 'qr' ? prod.channelPrices?.qr : null;
      unitPrice = (channel && channel > 0) ? channel : (Number(prod.price) || 0);
    }

    const selectedModifiers: any[] = [];
    for (const m of (Array.isArray(ci.selectedModifiers) ? ci.selectedModifiers : [])) {
      const group  = isId(m?.modifierGroupId) ? groupMap.get(String(m.modifierGroupId)) : null;
      const option = group && isId(m?.modifierOptionId)
        ? (group.options ?? []).find((o: any) => String(o._id) === String(m.modifierOptionId))
        : null;
      if (!group || !option || option.isActive === false) {
        return { result: null, refusal: { status: 409, code: 'ITEM_UNAVAILABLE', message: OPTION_GONE } };
      }
      const price = Math.max(0, Number(option.price) || 0);
      unitPrice += price;
      selectedModifiers.push({
        modifierGroupId:    String(group._id),
        modifierGroupName:  group.name,
        modifierOptionId:   String(option._id),
        modifierOptionName: option.name,
        modifierPrice:      price,
        modifierTotal:      +(price * qty).toFixed(2),
      });
    }

    const taxPercent = prod.taxPercent || 0;
    const taxAmt = (unitPrice * qty * taxPercent) / 100;
    validatedItems.push({
      product:     prod._id,
      productName: prod.name,
      quantity:    qty,
      price:       unitPrice,
      taxPercent,
      taxAmount:   +taxAmt.toFixed(2),
      total:       +(unitPrice * qty + taxAmt).toFixed(2),
      hsnCode:     prod.hsnCode || '',
      variantId,
      variantName,
      selectedModifiers,
      notes:       String(ci.notes ?? '').trim().slice(0, 200),
    });
    subtotal += unitPrice * qty;
    taxTotal += taxAmt;
  }

  return { result: { validatedItems, subtotal, taxTotal }, refusal: null };
}
