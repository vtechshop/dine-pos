import { Router, Response } from 'express';
import KitchenStation from '../models/KitchenStation';
import Product from '../models/Product';
import { authMiddleware, requireAdmin, AuthRequest } from '../middleware/auth';
import { sendError } from '../utils/sendError';

const router = Router();
router.use(authMiddleware);

// GET /api/kitchen-stations — list all stations for hotel (all authenticated roles)
router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const stations = await KitchenStation.find({ hotelId: req.hotelId }).sort({ sortOrder: 1, name: 1 });
    res.json(stations);
  } catch (error) {
    sendError(res, 500, 'Server error', error);
  }
});

// POST /api/kitchen-stations — create station (admin only)
router.post('/', requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { name, sortOrder, isActive } = req.body;
    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ message: 'Station name is required' });
    }
    const existing = await KitchenStation.findOne({ hotelId: req.hotelId, name: name.trim() });
    if (existing) return res.status(409).json({ message: 'A station with this name already exists' });

    const station = new KitchenStation({
      hotelId:   req.hotelId,
      name:      name.trim(),
      isActive:  isActive !== undefined ? Boolean(isActive) : true,
      sortOrder: typeof sortOrder === 'number' ? sortOrder : 0,
    });
    await station.save();
    res.status(201).json(station);
  } catch (error) {
    sendError(res, 400, 'Invalid data', error);
  }
});

// PUT /api/kitchen-stations/:id — update station (admin only)
router.put('/:id', requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const update: Record<string, unknown> = {};
    if (req.body.name      !== undefined) update.name      = String(req.body.name).trim();
    if (req.body.isActive  !== undefined) update.isActive  = Boolean(req.body.isActive);
    if (req.body.sortOrder !== undefined) update.sortOrder = Number(req.body.sortOrder);

    if (Object.keys(update).length === 0) {
      return res.status(400).json({ message: 'Provide at least one field to update' });
    }

    const station = await KitchenStation.findOneAndUpdate(
      { _id: req.params.id, hotelId: req.hotelId },
      update,
      { new: true, runValidators: true },
    );
    if (!station) return res.status(404).json({ message: 'Station not found' });
    res.json(station);
  } catch (error) {
    sendError(res, 400, 'Invalid data', error);
  }
});

// DELETE /api/kitchen-stations/:id — delete station (admin only)
// Clears the station assignment from all products in this hotel.
router.delete('/:id', requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const station = await KitchenStation.findOneAndDelete({ _id: req.params.id, hotelId: req.hotelId });
    if (!station) return res.status(404).json({ message: 'Station not found' });

    // Remove station reference from any product that was assigned to it
    await Product.updateMany(
      { hotelId: req.hotelId, kitchenStation: req.params.id },
      { $unset: { kitchenStation: '' } },
    );

    res.json({ message: 'Station deleted' });
  } catch (error) {
    sendError(res, 500, 'Server error', error);
  }
});

export default router;
