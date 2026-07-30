import mongoose from 'mongoose';
import Product from '../models/Product';
import Ingredient from '../models/Ingredient';

export const applyIngredientStockChange = async (
  orderItems: { product?: any; quantity: number }[],
  hotelId: string,
  sign: 1 | -1,
  session?: mongoose.ClientSession,
): Promise<void> => {
  const productIds = orderItems.filter(i => i.product).map(i => i.product);
  if (productIds.length === 0) return;

  const productsWithRecipe = await Product.find({
    _id: { $in: productIds }, hotelId, 'recipe.0': { $exists: true },
  }).select('recipe').session(session ?? null);
  if (productsWithRecipe.length === 0) return;

  const deltas = new Map<string, number>();
  for (const item of orderItems) {
    if (!item.product) continue;
    const product = productsWithRecipe.find(p => p._id.toString() === item.product.toString());
    if (!product) continue;
    for (const r of product.recipe) {
      const key = r.ingredient.toString();
      deltas.set(key, (deltas.get(key) || 0) + r.quantity * item.quantity);
    }
  }
  if (deltas.size === 0) return;

  const bulkOps = Array.from(deltas.entries()).map(([ingredientId, qty]) => ({
    updateOne: {
      filter: { _id: ingredientId, hotelId },
      update: sign === -1
        ? [{ $set: { currentStock: { $max: [{ $subtract: ['$currentStock', qty] }, 0] } } }]
        : { $inc: { currentStock: qty } },
    },
  }));
  await Ingredient.bulkWrite(bulkOps as any, { session });
};
