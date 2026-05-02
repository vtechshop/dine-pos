import { Router, Response } from 'express';
import Table from '../models/Table';
import { authMiddleware, AuthRequest } from '../middleware/auth';

const router = Router();
router.use(authMiddleware);

// GET all tables for hotel
router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const tables = await Table.find({ hotelId: req.hotelId }).sort({ number: 1 });
    res.json(tables);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error });
  }
});

// POST create table
router.post('/', async (req: AuthRequest, res: Response) => {
  try {
    const table = new Table({ ...req.body, hotelId: req.hotelId });
    await table.save();
    res.status(201).json(table);
  } catch (error: any) {
    if (error.code === 11000) return res.status(400).json({ message: 'Table number already exists' });
    res.status(400).json({ message: 'Invalid data', error });
  }
});

// PUT update table (position, capacity, name, shape)
router.put('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const table = await Table.findOneAndUpdate(
      { _id: req.params.id, hotelId: req.hotelId },
      req.body,
      { new: true, runValidators: true }
    );
    if (!table) return res.status(404).json({ message: 'Table not found' });
    res.json(table);
  } catch (error) {
    res.status(400).json({ message: 'Invalid data', error });
  }
});

// PATCH table status
router.patch('/:id/status', async (req: AuthRequest, res: Response) => {
  const { status, currentOrderId } = req.body;
  const allowed = ['available', 'occupied', 'reserved', 'inactive'];
  if (!allowed.includes(status)) return res.status(400).json({ message: 'Invalid status' });
  try {
    const update: any = { status };
    if (status === 'available') update.currentOrderId = null;
    if (currentOrderId) update.currentOrderId = currentOrderId;

    const table = await Table.findOneAndUpdate(
      { _id: req.params.id, hotelId: req.hotelId },
      update,
      { new: true }
    );
    if (!table) return res.status(404).json({ message: 'Table not found' });
    res.json(table);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error });
  }
});

// DELETE table
router.delete('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const table = await Table.findOneAndDelete({ _id: req.params.id, hotelId: req.hotelId });
    if (!table) return res.status(404).json({ message: 'Table not found' });
    res.json({ message: 'Table deleted' });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error });
  }
});

export default router;
