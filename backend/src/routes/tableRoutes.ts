import { Router, Response } from 'express';
import Table from '../models/Table';
import TableSession from '../models/TableSession';
import { authMiddleware, requireAdmin, requireWaiterOrCashierOrAdmin, AuthRequest } from '../middleware/auth';
import { logAudit } from '../utils/audit';
import { sendError } from '../utils/sendError';

const router = Router();
router.use(authMiddleware);
// requireAdmin is applied per write-route — all authenticated roles can read tables (waiter/kitchen need to see layout)

// GET all tables for hotel — waiter, kitchen, cashier, admin all need to read tables
router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const tables = await Table.find({ hotelId: req.hotelId }).sort({ number: 1 });
    res.json(tables);
  } catch (error) {
    sendError(res, 500, 'Failed to fetch tables', error);
  }
});

// POST create table — admin only
router.post('/', requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const table = new Table({ ...req.body, hotelId: req.hotelId });
    await table.save();
    logAudit(req, 'table.created', 'table', String((table as any)._id), { number: (table as any).number });
    res.status(201).json(table);
  } catch (error: any) {
    if ((error as any).code === 11000) return res.status(400).json({ message: 'Table number already exists' });
    sendError(res, 400, 'Invalid data', error);
  }
});

// PUT update table — admin only
router.put('/:id', requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const table = await Table.findOneAndUpdate(
      { _id: req.params.id, hotelId: req.hotelId },
      req.body,
      { new: true, runValidators: true }
    );
    if (!table) return res.status(404).json({ message: 'Table not found' });
    logAudit(req, 'table.updated', 'table', req.params.id);
    res.json(table);
  } catch (error) {
    sendError(res, 400, 'Invalid data', error);
  }
});

// PATCH table status — waiter/cashier/admin only; kitchen must not change table state
router.patch('/:id/status', requireWaiterOrCashierOrAdmin, async (req: AuthRequest, res: Response) => {
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
    logAudit(req, 'table.status_changed', 'table', req.params.id, { status });
    res.json(table);
  } catch (error) {
    sendError(res, 500, 'Failed to update table status', error);
  }
});

// DELETE table — admin only
router.delete('/:id', requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const openSession = await TableSession.findOne({ tableId: req.params.id, hotelId: req.hotelId, status: 'open' }).lean();
    if (openSession) return res.status(409).json({ message: 'Cannot delete a table with an active session. Close the session first.' });
    const table = await Table.findOneAndDelete({ _id: req.params.id, hotelId: req.hotelId });
    if (!table) return res.status(404).json({ message: 'Table not found' });
    logAudit(req, 'table.deleted', 'table', req.params.id, { number: (table as any).number });
    res.json({ message: 'Table deleted' });
  } catch (error) {
    sendError(res, 500, 'Failed to delete table', error);
  }
});

export default router;
