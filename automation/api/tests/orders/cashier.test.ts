/**
 * Cashier Regression Tests (12 journeys)
 *
 * Covers: delivery fee in grandTotal, status-machine transitions, payment patch
 * (tip, cap, split validation), discount RBAC gate, held-bill CRUD, Razorpay
 * completion gate, and shift ownership + closed-shift cash-movement guard.
 *
 * API targets per test are called out inline; tests that hit endpoints or
 * features that are not yet implemented will fail naturally rather than skip.
 */

import { v4 as uuidv4 } from 'uuid';
import { api } from '../../../utils/api-client';
import { authHeaders } from '../../../utils/env';
import { getHotelA } from '../../setup/testEnv';
import {
  createOrder,
  updateOrderStatus,
  createCompletedOrder,
} from '../../helpers/order.helper';
import { cashierPayload, uniquePhone } from '../../../utils/test-data';
import { cashierLogin } from '../../helpers/auth.helper';

describe('Cashier Regression', () => {
  let adminToken: string;
  let kitchenToken: string;
  let waiterToken: string;
  let cashierToken: string;
  let hotelId: string;

  beforeAll(() => {
    const hotelA = getHotelA();
    adminToken = hotelA.adminToken;
    kitchenToken = hotelA.kitchenToken;
    waiterToken = hotelA.waiterToken;
    cashierToken = hotelA.cashierToken;
    hotelId = hotelA.hotelId;
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // CRG-001  Delivery charge included in grandTotal
  // ─────────────────────────────────────────────────────────────────────────────
  describe('CRG-001 Delivery charge in grandTotal', () => {
    it('delivery order stores deliveryFee and grandTotal reflects it', async () => {
      // NOTE: The backend field is 'deliveryFee' (not 'deliveryCharge' as named in the spec).
      // recalcOrderTotals() in orderRoutes does NOT currently add deliveryFee to grandTotal;
      // the grandTotal assertion below will fail naturally if that gap exists.
      const items = [{ productName: 'Biryani', quantity: 1, price: 200, total: 200 }];
      const subtotal = 200;
      // Items carry no taxPercent, so the server computes taxTotal = 0.
      const taxTotal = 0;
      const deliveryFee = 150;

      const res = await api
        .post('/api/orders')
        .set(authHeaders(adminToken))
        .send({
          tableNumber: 'T1',
          customerName: 'Delivery Test',
          customerPhone: uniquePhone(),
          orderSource: 'takeaway',
          items,
          subtotal,
          taxTotal,
          grandTotal: subtotal + taxTotal + deliveryFee,
          paymentMethod: 'cash',
          deliveryFee,
          offlineId: uuidv4(),
        });

      expect(res.status).toBe(201);
      const order = res.body.order || res.body;

      // The deliveryFee field must be persisted on the order document.
      expect(order.deliveryFee).toBe(deliveryFee);

      // grandTotal should equal subtotal + tax + deliveryFee (spec requirement).
      const expectedGrandTotal = Math.round((subtotal + taxTotal + deliveryFee) * 100) / 100;
      expect(order.grandTotal).toBe(expectedGrandTotal);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // CRG-002  Takeaway / quick-service completion from pending
  // ─────────────────────────────────────────────────────────────────────────────
  describe('CRG-002 Takeaway completion from pending', () => {
    it('cashier can complete a takeaway order directly from pending', async () => {
      // API target: PATCH /api/orders/:id/status
      //
      // NOTE: The status route reads (existing as any).orderType for quick-service
      // detection, but the Order model only stores 'orderSource'.  If orderType is
      // undefined the isQuickService flag remains false and the server will return 400
      // instead of 200 — surfacing the orderType/orderSource field mismatch.
      const { orderId } = await createOrder(adminToken, { orderSource: 'takeaway' });

      const res = await api
        .patch(`/api/orders/${orderId}/status`)
        .set(authHeaders(cashierToken))
        .send({ status: 'completed', paymentMethod: 'cash' });

      expect(res.status).toBe(200);
      const order = res.body.order || res.body;
      expect(order.status).toBe('completed');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // CRG-003  Dine-in cannot complete from pending as cashier
  // ─────────────────────────────────────────────────────────────────────────────
  describe('CRG-003 Dine-in cannot complete from pending', () => {
    it('cashier gets 400 when completing a dine-in order still in pending status', async () => {
      // API target: PATCH /api/orders/:id/status
      const { orderId } = await createOrder(adminToken, { orderSource: 'dine-in' });

      const res = await api
        .patch(`/api/orders/${orderId}/status`)
        .set(authHeaders(cashierToken))
        .send({ status: 'completed' });

      expect(res.status).toBe(400);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // CRG-004  Cashier cannot cancel a completed order
  // ─────────────────────────────────────────────────────────────────────────────
  describe('CRG-004 Cancellation of completed order rejected', () => {
    it('returns 400 with a cancel-related message when cashier tries to cancel completed order', async () => {
      // API target: PATCH /api/orders/:id/status
      const { orderId } = await createCompletedOrder(
        adminToken, kitchenToken, waiterToken, cashierToken,
      );

      const res = await api
        .patch(`/api/orders/${orderId}/status`)
        .set(authHeaders(cashierToken))
        .send({ status: 'cancelled' });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/cancel/i);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // CRG-005  Payment PATCH saves tipAmount and it appears in subsequent fetch
  // ─────────────────────────────────────────────────────────────────────────────
  describe('CRG-005 tipAmount persists via PATCH /orders/:id/payment', () => {
    it('tip amount saved on a served order is visible in GET response', async () => {
      // API target: PATCH /api/orders/:id/payment
      //
      // NOTE: The payment PATCH endpoint rejects orders that are already 'completed'
      // (returns 400 "Order is already completed").  The tip must be set while the order
      // is still in 'served' status — before the cashier calls the status → 'completed' PATCH.
      const { orderId } = await createOrder(adminToken);
      await updateOrderStatus(kitchenToken, orderId, 'preparing');
      await updateOrderStatus(kitchenToken, orderId, 'ready');
      await updateOrderStatus(waiterToken, orderId, 'served');

      // Set tip while the order is in 'served' state
      const patchRes = await api
        .patch(`/api/orders/${orderId}/payment`)
        .set(authHeaders(cashierToken))
        .send({ tipAmount: 50 });

      expect(patchRes.status).toBe(200);
      // PATCH /payment returns the updated order document directly (not wrapped in {order:…})
      expect(patchRes.body.tipAmount).toBe(50);

      // Fetch as admin to confirm persistence
      const fetchRes = await api
        .get(`/api/orders/${orderId}`)
        .set(authHeaders(adminToken));
      expect(fetchRes.status).toBe(200);
      const fetched = fetchRes.body.order || fetchRes.body;
      expect(fetched.tipAmount).toBe(50);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // CRG-006  Tip cap enforcement
  // ─────────────────────────────────────────────────────────────────────────────
  describe('CRG-006 Tip cap enforcement', () => {
    it('returns 400 when tipAmount exceeds max(₹500, grandTotal×0.5)', async () => {
      // API target: PATCH /api/orders/:id/payment
      // Default order grandTotal ≈ ₹420 → tipCap = max(500, 210) = 500.
      // A tip of ₹99 999 exceeds any realistic cap.
      const { orderId } = await createOrder(adminToken);
      await updateOrderStatus(kitchenToken, orderId, 'preparing');
      await updateOrderStatus(kitchenToken, orderId, 'ready');
      await updateOrderStatus(waiterToken, orderId, 'served');

      const res = await api
        .patch(`/api/orders/${orderId}/payment`)
        .set(authHeaders(cashierToken))
        .send({ tipAmount: 99999 });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/tip/i);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // CRG-007  Split payment must sum to grandTotal (±₹1)
  // ─────────────────────────────────────────────────────────────────────────────
  describe('CRG-007 Split payment total mismatch rejected', () => {
    it('returns 400 when split amounts exceed grandTotal by more than ₹1', async () => {
      // API target: PATCH /api/orders/:id/payment
      // The backend checks: |splitTotal − grandTotal| > 1 → 400
      const { orderId, body } = await createOrder(adminToken);
      // Use the server-authoritative grandTotal from the creation response
      const serverOrder = body.order || body;
      const grandTotal = serverOrder.grandTotal as number;

      await updateOrderStatus(kitchenToken, orderId, 'preparing');
      await updateOrderStatus(kitchenToken, orderId, 'ready');
      await updateOrderStatus(waiterToken, orderId, 'served');

      const res = await api
        .patch(`/api/orders/${orderId}/payment`)
        .set(authHeaders(cashierToken))
        .send({
          paymentMethod: 'split',
          splitDetails: [
            { method: 'cash', amount: grandTotal + 100 }, // ₹100 over: violates ±1 tolerance
          ],
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/split/i);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // CRG-008  Discount blocked for cashier role
  // ─────────────────────────────────────────────────────────────────────────────
  describe('CRG-008 Discount blocked for cashier role', () => {
    it('returns 403 when cashier submits an order with discountAmount > 0', async () => {
      // API target: POST /api/orders
      // Backend enforces: if (discountAmount > 0 && role !== 'admin') → 403
      const res = await api
        .post('/api/orders')
        .set(authHeaders(cashierToken))
        .send({
          tableNumber: 'T1',
          customerName: 'Discount Test',
          customerPhone: uniquePhone(),
          orderSource: 'dine-in',
          items: [{ productName: 'Tea', quantity: 1, price: 50, total: 50 }],
          subtotal: 50,
          taxTotal: 0,
          grandTotal: 0, // server recalculates; client value is ignored
          discountAmount: 50,
          paymentMethod: 'cash',
          offlineId: uuidv4(),
        });

      expect(res.status).toBe(403);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // CRG-009  Hold bill server-side persistence
  // ─────────────────────────────────────────────────────────────────────────────
  describe('CRG-009 Hold bill persistence', () => {
    it('held bill appears in list after POST and disappears after DELETE', async () => {
      // API targets: POST /api/held-bills, GET /api/held-bills, DELETE /api/held-bills/:id

      // Create a held bill
      const createRes = await api
        .post('/api/held-bills')
        .set(authHeaders(cashierToken))
        .send({
          label: 'Table 7 — customer stepped out',
          items: [
            { productName: 'Coffee', quantity: 2, price: 60, total: 120 },
            { productName: 'Toast',  quantity: 1, price: 40, total: 40  },
          ],
          metadata: { tableNumber: 'T7', note: 'will return in 10 min' },
        });

      expect(createRes.status).toBe(201);
      // The held-bill endpoint returns the document directly (not wrapped)
      const billId = (createRes.body._id ?? createRes.body.bill?._id) as string;
      expect(billId).toBeTruthy();

      // Verify the bill appears in the list
      const listRes = await api
        .get('/api/held-bills')
        .set(authHeaders(cashierToken));

      expect(listRes.status).toBe(200);
      const bills: any[] = listRes.body;
      expect(Array.isArray(bills)).toBe(true);
      expect(bills.some((b: any) => b._id === billId)).toBe(true);

      // Delete the held bill
      const deleteRes = await api
        .delete(`/api/held-bills/${billId}`)
        .set(authHeaders(cashierToken));

      expect(deleteRes.status).toBe(200);

      // Confirm the bill is gone
      const listAfterRes = await api
        .get('/api/held-bills')
        .set(authHeaders(cashierToken));

      expect(listAfterRes.status).toBe(200);
      const billsAfter: any[] = listAfterRes.body;
      expect(billsAfter.some((b: any) => b._id === billId)).toBe(false);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // CRG-010  Razorpay completion gate
  // ─────────────────────────────────────────────────────────────────────────────
  describe('CRG-010 Razorpay completion gate', () => {
    it('returns 400 when completing with razorpay but no verified Payment record exists', async () => {
      // API target: PATCH /api/orders/:id/status
      // The backend queries: Payment.findOne({ orderId, status:'success',
      //   method: { $in: ['razorpay','razorpay_link'] } }).  No such record exists
      // for a freshly created order, so completion must be rejected.
      const { orderId } = await createOrder(adminToken, { orderSource: 'dine-in' });
      await updateOrderStatus(kitchenToken, orderId, 'preparing');
      await updateOrderStatus(kitchenToken, orderId, 'ready');
      await updateOrderStatus(waiterToken, orderId, 'served');

      const res = await api
        .patch(`/api/orders/${orderId}/status`)
        .set(authHeaders(cashierToken))
        .send({ status: 'completed', paymentMethod: 'razorpay' });

      expect(res.status).toBe(400);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // CRG-011 + CRG-012  Shift management
  // ─────────────────────────────────────────────────────────────────────────────
  describe('Shift management', () => {
    // Close any lingering open shift before the shift sub-tests run so that
    // the "one open shift per hotel" constraint does not cause spurious 409s.
    beforeAll(async () => {
      const activeRes = await api
        .get('/api/shifts/active')
        .set(authHeaders(cashierToken));
      if (activeRes.status === 200 && activeRes.body.shift?._id) {
        await api
          .post(`/api/shifts/${activeRes.body.shift._id}/close`)
          .set(authHeaders(cashierToken))
          .send({ actualCash: 0, closingNote: 'pre-test cleanup' })
          .catch(() => { /* ignore — might be owned by a different cashier */ });
        // If the active shift is owned by a different cashier, close it via admin token
        await api
          .post(`/api/shifts/${activeRes.body.shift._id}/close`)
          .set(authHeaders(adminToken))
          .send({ actualCash: 0, closingNote: 'pre-test admin cleanup' })
          .catch(() => { /* best-effort */ });
      }
    });

    // ── CRG-011 ──────────────────────────────────────────────────────────────
    describe('CRG-011 Shift ownership — cashierB cannot close cashierA shift', () => {
      it('returns 403 when a different cashier tries to close another cashier\'s open shift', async () => {
        // API targets: POST /api/shifts/open, POST /api/shifts/:id/close
        //
        // NOTE: These routes require the 'shift' feature flag to be enabled for the hotel.
        // If the feature is absent, the /open call will return a non-201 status and this
        // test will fail at the openRes assertion — surfacing the missing feature config.

        // Create a second cashier (cashierB) at runtime via admin credentials
        const payloadB = cashierPayload({
          // UUID-based suffix ensures uniqueness even across parallel runs
          employeeCode: `CTEST${uuidv4().slice(-6).toUpperCase()}`,
          pin: '7391',
        });
        const createCashierRes = await api
          .post('/api/cashiers')
          .set(authHeaders(adminToken))
          .send(payloadB);
        expect([200, 201]).toContain(createCashierRes.status);

        const cashierBToken = await cashierLogin(
          hotelId,
          payloadB.employeeCode as string,
          payloadB.pin as string,
        );
        expect(cashierBToken).toBeTruthy();

        // CashierA (the global test cashier) opens a shift
        const openRes = await api
          .post('/api/shifts/open')
          .set(authHeaders(cashierToken))
          .send({ openingCash: 1000, openingNote: 'CRG-011 test shift' });
        expect(openRes.status).toBe(201);
        const shiftId = openRes.body.shift._id as string;

        try {
          // CashierB attempts to close cashierA's shift — must be rejected with 403
          const closeRes = await api
            .post(`/api/shifts/${shiftId}/close`)
            .set(authHeaders(cashierBToken))
            .send({ actualCash: 1000 });

          expect(closeRes.status).toBe(403);
        } finally {
          // Cleanup: close the shift as its owner (cashierA) so CRG-012 can open a fresh one
          await api
            .post(`/api/shifts/${shiftId}/close`)
            .set(authHeaders(cashierToken))
            .send({ actualCash: 1000, closingNote: 'CRG-011 owner cleanup' })
            .catch(() => { /* already closed */ });
        }
      });
    });

    // ── CRG-012 ──────────────────────────────────────────────────────────────
    describe('CRG-012 Cash movement blocked on closed shift', () => {
      it('returns 400 when posting a cash movement against a closed shift', async () => {
        // API targets: POST /api/shifts/open, POST /api/shifts/:id/close,
        //              POST /api/shifts/:id/movements
        //
        // NOTE: Requires the 'shift' feature flag to be enabled for the hotel.

        // Open a shift
        const openRes = await api
          .post('/api/shifts/open')
          .set(authHeaders(cashierToken))
          .send({ openingCash: 500, openingNote: 'CRG-012 test shift' });
        expect(openRes.status).toBe(201);
        const shiftId = openRes.body.shift._id as string;

        // Close the shift immediately
        const closeRes = await api
          .post(`/api/shifts/${shiftId}/close`)
          .set(authHeaders(cashierToken))
          .send({ actualCash: 500, closingNote: 'CRG-012 immediate close' });
        expect(closeRes.status).toBe(200);

        // Attempt to record a cash-in movement on the now-closed shift
        const movRes = await api
          .post(`/api/shifts/${shiftId}/movements`)
          .set(authHeaders(cashierToken))
          .send({ type: 'cash_in', amount: 100, reason: 'Extra cash' });

        expect(movRes.status).toBe(400);
        expect(movRes.body.message).toMatch(/closed/i);
      });
    });
  });
});
