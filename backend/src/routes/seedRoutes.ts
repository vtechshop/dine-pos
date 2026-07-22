import { Router, Response } from 'express';
import mongoose from 'mongoose';
import Category from '../models/Category';
import Product from '../models/Product';
import { authMiddleware, requireAdmin, AuthRequest } from '../middleware/auth';

const router = Router();

// POST /api/seed — seeds demo categories + products for the logged-in hotel
router.post('/', authMiddleware, requireAdmin, async (req: AuthRequest, res: Response) => {
  const hotelId = new mongoose.Types.ObjectId(req.hotelId!);
  try {
    // Drop the global unique index on name if it exists (leftover from old schema)
    // In a multi-tenant app, names can repeat across hotels — this index is wrong
    try { await Category.collection.dropIndex('name_1'); } catch { /* index doesn't exist, fine */ }

    // Remove orphaned categories inserted without a hotelId (broken earlier seeds)
    await Category.deleteMany({ hotelId: { $exists: false } });
    await Category.deleteMany({ hotelId: null });

    const existing = await Category.countDocuments({ hotelId });
    if (existing > 0) {
      return res.json({ message: 'Data already seeded for this hotel', alreadySeeded: true });
    }

    // Use create() so Mongoose fully validates and casts each document
    const meals     = await Category.create({ hotelId, name: 'Meals',          icon: 'restaurant',           color: '#FF6B35', sortOrder: 1, isActive: true, isDeleted: false });
    const biryani   = await Category.create({ hotelId, name: 'Biryani',        icon: 'lunch-dining',         color: '#E91E63', sortOrder: 2, isActive: true, isDeleted: false });
    const starters  = await Category.create({ hotelId, name: 'Starters',       icon: 'local-fire-department',color: '#FF5722', sortOrder: 3, isActive: true, isDeleted: false });
    const drinks    = await Category.create({ hotelId, name: 'Drinks',         icon: 'local-cafe',           color: '#4CAF50', sortOrder: 4, isActive: true, isDeleted: false });
    const snacks    = await Category.create({ hotelId, name: 'Snacks',         icon: 'fastfood',             color: '#FF9800', sortOrder: 5, isActive: true, isDeleted: false });
    const desserts  = await Category.create({ hotelId, name: 'Desserts',       icon: 'cake',                 color: '#9C27B0', sortOrder: 6, isActive: true, isDeleted: false });
    const juices    = await Category.create({ hotelId, name: 'Juice & Shakes', icon: 'local-bar',            color: '#00BCD4', sortOrder: 7, isActive: true, isDeleted: false });

    const base = { hotelId, taxPercent: 5, isAvailable: true, isDeleted: false, stock: -1 };

    await Product.create([
      // MEALS
      { ...base, name: 'Veg Meals',       price: 80,  category: meals._id,    isVeg: true,  shortCode: 'VM',  description: 'Full veg meal with rice, dal, sabzi, roti & dessert',       image: 'https://images.unsplash.com/photo-1546833999-b9f581a1996d?w=400&h=300&fit=crop' },
      { ...base, name: 'Non-Veg Meals',   price: 120, category: meals._id,    isVeg: false, shortCode: 'NVM', description: 'Chicken curry with rice, roti, salad & raita',                image: 'https://images.unsplash.com/photo-1585937421612-70a008356fbe?w=400&h=300&fit=crop' },
      { ...base, name: 'Chapati (2 pcs)', price: 20,  category: meals._id,    isVeg: true,  shortCode: 'CHP', description: 'Soft fresh-made whole wheat chapatis',                       image: 'https://images.unsplash.com/photo-1565557623262-b51c2513a641?w=400&h=300&fit=crop' },
      // BIRYANI
      { ...base, name: 'Chicken Biryani', price: 180, category: biryani._id,  isVeg: false, shortCode: 'CB',  description: 'Dum-style Hyderabadi chicken biryani with raita & mirchi',   image: 'https://images.unsplash.com/photo-1563379091339-03b21ab4a4f8?w=400&h=300&fit=crop' },
      { ...base, name: 'Mutton Biryani',  price: 280, category: biryani._id,  isVeg: false, shortCode: 'MB',  description: 'Slow-cooked mutton biryani — our house special',             image: 'https://images.unsplash.com/photo-1589302168068-964664d93dc0?w=400&h=300&fit=crop' },
      { ...base, name: 'Veg Biryani',     price: 120, category: biryani._id,  isVeg: true,  shortCode: 'VB',  description: 'Aromatic basmati rice with seasonal veggies & whole spices',  image: 'https://images.unsplash.com/photo-1630409351241-e90e7f5e434d?w=400&h=300&fit=crop' },
      // STARTERS
      { ...base, name: 'Chicken 65',      price: 160, category: starters._id, isVeg: false, shortCode: 'C65', description: 'Crispy spiced chicken deep-fried — Bangalore style',         image: 'https://images.unsplash.com/photo-1574071318508-1cdbab80d002?w=400&h=300&fit=crop' },
      { ...base, name: 'Gobi Manchurian', price: 120, category: starters._id, isVeg: true,  shortCode: 'GM',  description: 'Cauliflower in tangy Indo-Chinese sauce',                    image: 'https://images.unsplash.com/photo-1645177628172-a94c1f96e6db?w=400&h=300&fit=crop' },
      { ...base, name: 'Paneer Tikka',    price: 150, category: starters._id, isVeg: true,  shortCode: 'PT',  description: 'Marinated cottage cheese grilled in tandoor with mint chutney', image: 'https://images.unsplash.com/photo-1567188040759-fb8a883dc6d8?w=400&h=300&fit=crop' },
      // DRINKS
      { ...base, name: 'Tea',             price: 15,  category: drinks._id,   isVeg: true,  shortCode: 'TEA', description: 'Freshly brewed masala chai',                                 image: 'https://images.unsplash.com/photo-1571934811356-5cc061b6821f?w=400&h=300&fit=crop' },
      { ...base, name: 'Coffee',          price: 20,  category: drinks._id,   isVeg: true,  shortCode: 'COF', description: 'Filter coffee or espresso, your choice',                    image: 'https://images.unsplash.com/photo-1509042239860-f550ce710b93?w=400&h=300&fit=crop' },
      { ...base, name: 'Badam Milk',      price: 40,  category: drinks._id,   isVeg: true,  shortCode: 'BDM', description: 'Chilled almond milk sweetened with saffron',                 image: 'https://images.unsplash.com/photo-1550583724-b2692b85b150?w=400&h=300&fit=crop' },
      { ...base, name: 'Pepsi (Bottle)',  price: 40,  category: drinks._id,   isVeg: true,  shortCode: 'PEP', taxPercent: 12, description: 'Chilled 750ml Pepsi bottle',                 image: 'https://images.unsplash.com/photo-1629203851122-3726ecdf080e?w=400&h=300&fit=crop' },
      // SNACKS
      { ...base, name: 'Samosa (2 pcs)',  price: 30,  category: snacks._id,   isVeg: true,  shortCode: 'SAM', description: 'Crispy potato-stuffed samosas with green chutney',           image: 'https://images.unsplash.com/photo-1601050690117-94f5f6fa8bd7?w=400&h=300&fit=crop' },
      { ...base, name: 'Vada (2 pcs)',    price: 25,  category: snacks._id,   isVeg: true,  shortCode: 'VDA', description: 'Crispy medu vada served with sambar & coconut chutney',     image: 'https://images.unsplash.com/photo-1630383249896-424e482df921?w=400&h=300&fit=crop' },
      { ...base, name: 'Egg Puff',        price: 25,  category: snacks._id,   isVeg: false, shortCode: 'EPF', description: 'Flaky puff pastry with spiced egg filling',                  image: 'https://images.unsplash.com/photo-1555507036-ab1f4038808a?w=400&h=300&fit=crop' },
      // DESSERTS
      { ...base, name: 'Gulab Jamun (2 pcs)', price: 40, category: desserts._id, isVeg: true, shortCode: 'GJ',  description: 'Soft melt-in-mouth jamuns soaked in rose syrup',          image: 'https://images.unsplash.com/photo-1606471191009-63994c53433b?w=400&h=300&fit=crop' },
      { ...base, name: 'Ice Cream Cup',        price: 60, category: desserts._id, isVeg: true, shortCode: 'ICE', taxPercent: 18, description: 'Scoops of your favourite flavour with wafer', image: 'https://images.unsplash.com/photo-1497034825429-c343d7c6a68f?w=400&h=300&fit=crop' },
      // JUICE & SHAKES
      { ...base, name: 'Fresh Lime Juice', price: 30, category: juices._id, isVeg: true, shortCode: 'FLJ', description: 'Cold pressed lime with mint — sweet or salted',                image: 'https://images.unsplash.com/photo-1621263764928-df1444c5e859?w=400&h=300&fit=crop' },
      { ...base, name: 'Mango Shake',      price: 50, category: juices._id, isVeg: true, shortCode: 'MS',  description: 'Thick Alphonso mango blended with chilled milk',              image: 'https://images.unsplash.com/photo-1623065422902-30a2d299bbe4?w=400&h=300&fit=crop' },
      { ...base, name: 'Frooti (Pack)',    price: 20, category: juices._id, isVeg: true, shortCode: 'FRT', taxPercent: 12, description: 'Chilled mango drink pack',                     image: 'https://images.unsplash.com/photo-1534353473418-4cfa6c56fd38?w=400&h=300&fit=crop' },
    ]);

    res.json({ message: 'Demo data loaded!', data: { categories: 7, products: 21 } });
  } catch (error: any) {
    console.error('Seed error:', error?.message || error);
    res.status(500).json({ message: error?.message || 'Seed failed', error: error?.toString() });
  }
});

// DELETE — wipe only this hotel's categories + products (requires auth)
router.delete('/', authMiddleware, requireAdmin, async (req: AuthRequest, res: Response) => {
  const hotelId = new mongoose.Types.ObjectId(req.hotelId!);
  try {
    await Promise.all([
      Category.deleteMany({ hotelId }),
      Product.deleteMany({ hotelId }),
    ]);
    res.json({ message: 'All categories and products cleared for this hotel.' });
  } catch (error: any) {
    console.error('Seed reset error:', error?.message || error);
    res.status(500).json({ message: error?.message || 'Reset failed' });
  }
});

export default router;
