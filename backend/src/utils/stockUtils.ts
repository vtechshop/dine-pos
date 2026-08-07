import mongoose from 'mongoose';
import Product from '../models/Product';
import Ingredient from '../models/Ingredient';

export const applyIngredientStockChange = async (
  orderItems: { product?: any; quantity: number }[],
  hotelId: string,
  sign: 1 | -1,
  session?: mongoose.ClientSession,
  overrides?: Map<string, number>,
): Promise<Map<string, number>> => {
  const productIds = orderItems.filter(i => i.product).map(i => i.product);
  if (productIds.length === 0) return new Map();

  const productsWithRecipe = await Product.find({
    _id: { $in: productIds }, hotelId, 'recipe.0': { $exists: true },
  }).select('recipe').session(session ?? null);
  if (productsWithRecipe.length === 0) return new Map();

  const recipeDemand = new Map<string, number>();
  for (const item of orderItems) {
    if (!item.product) continue;
    const product = productsWithRecipe.find(p => p._id.toString() === item.product.toString());
    if (!product) continue;
    for (const r of product.recipe) {
      const key = r.ingredient.toString();
      recipeDemand.set(key, (recipeDemand.get(key) || 0) + r.quantity * item.quantity);
    }
  }
  if (recipeDemand.size === 0) return new Map();

  const actualDeltas = new Map<string, number>();

  if (sign === -1) {
    // Read current stocks inside the transaction so the snapshot is consistent
    // with the subsequent $inc — prevents over-deduction if another concurrent
    // order fires between the read and the write.
    const ingredientIds = Array.from(recipeDemand.keys());
    const ingredients = await Ingredient.find(
      { _id: { $in: ingredientIds }, hotelId },
    ).select('_id currentStock').session(session ?? null);

    const stockMap = new Map<string, number>();
    for (const ing of ingredients) {
      stockMap.set(ing._id.toString(), (ing as any).currentStock ?? 0);
    }

    const bulkOps: any[] = [];
    for (const [ingredientId, qty] of recipeDemand) {
      const currentStock = stockMap.get(ingredientId) ?? 0;
      const actual = Math.min(qty, Math.max(0, currentStock));
      actualDeltas.set(ingredientId, actual);
      if (actual <= 0) continue;
      bulkOps.push({
        updateOne: {
          filter: { _id: ingredientId, hotelId },
          update: { $inc: { currentStock: -actual } },
        },
      });
    }
    if (bulkOps.length > 0) {
      await Ingredient.bulkWrite(bulkOps, { session });
    }
  } else {
    // Restoration: use recorded deltas when available so we restore exactly
    // what was taken, not the full recipe amount (which may exceed what was in stock).
    const demand = overrides ?? recipeDemand;
    const bulkOps: any[] = [];
    for (const [ingredientId, qty] of demand) {
      if (qty <= 0) continue;
      actualDeltas.set(ingredientId, qty);
      bulkOps.push({
        updateOne: {
          filter: { _id: ingredientId, hotelId },
          update: { $inc: { currentStock: qty } },
        },
      });
    }
    if (bulkOps.length > 0) {
      await Ingredient.bulkWrite(bulkOps, { session });
    }
  }

  return actualDeltas;
};
