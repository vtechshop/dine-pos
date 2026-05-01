import { Router, Request, Response } from 'express';
import Product from '../models/Product';
import Category from '../models/Category';
import Settings from '../models/Settings';
import mongoose from 'mongoose';

const router = Router();

// GET /api/public/menu?hotel=<hotelId>
// Public menu — no auth needed, used by customer kiosk / QR menu
router.get('/', async (req: Request, res: Response) => {
  try {
    const hotelIdParam = req.query.hotel as string | undefined;

    let hotelId: mongoose.Types.ObjectId | undefined;
    if (hotelIdParam && mongoose.Types.ObjectId.isValid(hotelIdParam)) {
      hotelId = new mongoose.Types.ObjectId(hotelIdParam);
    }

    const catFilter: any = { isActive: true, isDeleted: false };
    const prodFilter: any = { isAvailable: true, isDeleted: false };
    const settingsFilter: any = {};

    if (hotelId) {
      catFilter.hotelId = hotelId;
      prodFilter.hotelId = hotelId;
      settingsFilter.hotelId = hotelId;
    }

    const [categories, products, settingsDoc] = await Promise.all([
      Category.find(catFilter).sort({ sortOrder: 1 }),
      Product.find(prodFilter).populate('category', 'name icon color').sort({ name: 1 }),
      Settings.findOne(settingsFilter),
    ]);

    const settings = settingsDoc || { hotelName: 'My Hotel', address: '', phone: '', currencySymbol: '₹' };

    res.json({
      hotel: {
        name: settings.hotelName,
        address: settings.address,
        phone: settings.phone,
        currency: settings.currencySymbol,
      },
      categories,
      products,
      cachedAt: new Date().toISOString(),
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load menu' });
  }
});

export default router;
