/**
 * Payment Release — exactly-once new_order + KOT
 *
 * Verifies the full end-to-end payment lifecycle for all three payment paths:
 *
 *   1. Kiosk + Cash   → new_order emitted immediately on order creation
 *   2. QR + Razorpay  → payment_pending until qr-verify; exactly 1 new_order
 *   3. Kiosk+Razorpay → payment_pending until qr-verify; exactly 1 new_order
 *   4. Race condition  → qr-verify + webhook simultaneously → exactly 1 release
 *
 * Requirements:
 *   - Backend running via `node start-test.js` (sets NODE_ENV=test + RAZORPAY_TEST_BYPASS=true)
 *   - MongoDB test database (MONGODB_TEST_URI in .env.test)
 *   - Socket.IO accessible (SOCKET_URL in .env.test, defaults to TEST_API_URL)
 *
 * Payment gateway:
 *   RAZORPAY_TEST_BYPASS=true causes RazorpayGateway to:
 *     - createPayment()  → return a fake but deterministic order ID (no live API call)
 *     - verifyPayment()  → after HMAC check passes, return success (no live payments.fetch())
 *   Webhook signature is a real HMAC-SHA256 computed with the known test webhook secret —
 *   no bypass needed; Razorpay.validateWebhookSignature() is a pure local computation.
 *
 * KOT assertion:
 *   scheduleKOTPrint() is fire-and-forget. Without a registered printer in the test environment
 *   it logs a warning and returns. The proxy assertion is: order.status === 'pending' AND
 *   exactly 1 new_order socket event (scheduleKOTPrint is always called exactly once after
 *   the atomic findOneAndUpdate succeeds, co-located with the socket emit in the same branch).
 */

import crypto from 'crypto';
import { api } from '../../../utils/api-client';
import { authHeaders, superAdminHeaders } from '../../../utils/env';
import { createConnectedSocket, TestSocket } from '../../../utils/socket-client';
import { getHotelA } from '../../setup/testEnv';

// ── Test gateway credentials (known to both the test and the backend) ─────────
// These are stored in PaymentGatewayConfig via the hotel admin API, which
// encrypts them with the backend's PAYMENT_ENCRYPTION_KEY. The test never
// touches the raw ciphertext — it only needs the plaintext to compute HMACs.

const TEST_API_KEY      = 'rzp_test_PAYREL_TESTKEY00001';
const TEST_API_SECRET   = 'payrel_test_api_secret_00000001';
const TEST_WEBHOOK_SEC  = 'payrel_test_webhook_secret_00001';

// ── HMAC helpers ──────────────────────────────────────────────────────────────

/** Signature expected by qr-verify: HMAC(apiSecret, "${razorpayOrderId}|${razorpayPaymentId}") */
function signPayment(razorpayOrderId: string, razorpayPaymentId: string): string {
  return crypto
    .createHmac('sha256', TEST_API_SECRET)
    .update(`${razorpayOrderId}|${razorpayPaymentId}`)
    .digest('hex');
}

/** Signature expected by webhook: HMAC(webhookSecret, rawBody) */
function signWebhook(rawBody: string): string {
  return crypto
    .createHmac('sha256', TEST_WEBHOOK_SEC)
    .update(rawBody)
    .digest('hex');
}

// ── Suite ─────────────────────────────────────────────────────────────────────

describe('Payment Release — exactly-once new_order + KOT', () => {
  let adminToken : string;
  let hotelId    : string;
  let productId  : string;
  let gwConfigId : string;
  let socket     : TestSocket;

  beforeAll(async () => {
    const hotelA = getHotelA();
    adminToken = hotelA.adminToken;
    hotelId    = hotelA.hotelId;

    // Use the first product already created by globalSetup.
    productId = hotelA.products[0]?.id;
    if (!productId) {
      throw new Error('[payment-release] hotelA.products[0] not found — check globalSetup');
    }

    // Enable kiosk feature (required by menuRoutes security guard).
    await api
      .put(`/api/superadmin/hotels/${hotelId}/features`)
      .set(superAdminHeaders)
      .send({ kiosk: true });

    // Remove any existing razorpay config so the POST below doesn't 409.
    const listRes = await api
      .get('/api/payment-gateway-configs')
      .set(authHeaders(adminToken));
    if (listRes.status === 200) {
      const existing = (listRes.body as any[]).filter(
        (c: any) => c.gatewayType === 'razorpay' && !c.isDeleted
      );
      for (const c of existing) {
        await api
          .delete(`/api/payment-gateway-configs/${c._id}`)
          .set(authHeaders(adminToken));
      }
    }

    // Create a test Razorpay gateway config with known credentials.
    // The backend encrypts apiSecret and webhookSecret server-side.
    const gwRes = await api
      .post('/api/payment-gateway-configs')
      .set(authHeaders(adminToken))
      .send({
        gatewayType:   'razorpay',
        displayName:   'Test Razorpay (CI)',
        apiKey:        TEST_API_KEY,
        apiSecret:     TEST_API_SECRET,
        webhookSecret: TEST_WEBHOOK_SEC,
        environment:   'sandbox',
      });
    expect([200, 201]).toContain(gwRes.status);
    gwConfigId = (gwRes.body as any)._id;

    // Activate the new config (newly created configs start inactive).
    const toggleRes = await api
      .patch(`/api/payment-gateway-configs/${gwConfigId}/toggle`)
      .set(authHeaders(adminToken));
    expect([200, 201]).toContain(toggleRes.status);

    // Connect a socket to the hotel room — used to count new_order events.
    socket = await createConnectedSocket(adminToken, hotelId);
  }, 30_000);

  afterAll(async () => {
    socket?.disconnect();
    if (gwConfigId) {
      await api
        .delete(`/api/payment-gateway-configs/${gwConfigId}`)
        .set(authHeaders(adminToken));
    }
  });

  // ── 1. Kiosk + Cash ─────────────────────────────────────────────────────────
  // Cash kiosk orders bypass the payment gateway entirely and are released
  // immediately. The new_order event must fire before the HTTP response
  // returns (it's in the same request handler). We wait for it with a short timeout.

  it('PAY-001 Kiosk + cash → order status=pending + exactly 1 new_order immediately', async () => {
    socket.clearEvents();
    const eventPromise = socket.waitForEvent('new_order', 5_000);

    const res = await api.post('/api/public/orders').send({
      hotelId,
      orderSource:   'kiosk',
      paymentMethod: 'cash',
      items:         [{ product: productId, quantity: 1 }],
      customerName:  'PAY-001 Kiosk Cash',
    });
    expect(res.status).toBe(201);

    const order = res.body.order ?? res.body;
    expect(order.status).toBe('pending');
    expect(order.paymentMethod).toBe('cash');

    // Socket event must arrive (server emits in the same request handler)
    const evt: any = await eventPromise;
    expect(evt._id || evt.orderNumber).toBeTruthy();

    // Wait 500 ms to confirm exactly 1 event — no second emission
    await new Promise(r => setTimeout(r, 500));
    expect(socket.getEvents('new_order').length).toBe(1);
  }, 15_000);

  // ── 2. QR + Razorpay → qr-verify → exactly 1 new_order ─────────────────────
  // Full happy path: create order → razorpay-order → qr-verify.
  // The test bypass skips the live Razorpay API calls;
  // HMAC signature is real and is validated by the gateway.

  it('PAY-002 QR + Razorpay → qr-verify → order status=pending + exactly 1 new_order', async () => {
    // Step 1: Place order — must land in payment_pending
    const orderRes = await api.post('/api/public/orders').send({
      hotelId,
      orderSource:   'qr',
      paymentMethod: 'razorpay',
      items:         [{ product: productId, quantity: 1 }],
      customerName:  'PAY-002 QR Razorpay',
    });
    expect(orderRes.status).toBe(201);
    const order0 = orderRes.body.order ?? orderRes.body;
    expect(order0.status).toBe('payment_pending');
    const orderId    = order0._id as string;
    const grandTotal = order0.grandTotal as number;
    expect(orderId).toBeTruthy();
    expect(grandTotal).toBeGreaterThan(0);

    // Step 2: Create Razorpay order (returns fake order ID from test bypass)
    const rzpRes = await api.post('/api/public/payments/razorpay-order').send({
      hotelId,
      orderId,
      amount: grandTotal,
    });
    expect([200, 201]).toContain(rzpRes.status);
    const razorpayOrderId       = rzpRes.body.razorpayOrderId as string;
    const internalTransactionId = rzpRes.body.internalTransactionId as string;
    expect(razorpayOrderId).toBeTruthy();
    expect(internalTransactionId).toBeTruthy();

    // Step 3: Compute HMAC for qr-verify (real signature, verified server-side)
    const razorpayPaymentId = `pay_test_${Date.now()}_qr`;
    const signature         = signPayment(razorpayOrderId, razorpayPaymentId);

    socket.clearEvents();
    const eventPromise = socket.waitForEvent('new_order', 5_000);

    // Step 4: Verify payment — atomically releases order
    const verifyRes = await api.post('/api/public/payments/qr-verify').send({
      razorpay_payment_id:  razorpayPaymentId,
      razorpay_order_id:    razorpayOrderId,
      razorpay_signature:   signature,
      internalTransactionId,
      orderId,
      hotelId,
    });
    expect(verifyRes.status).toBe(200);
    expect(verifyRes.body.success).toBe(true);

    // Step 5: Exactly 1 new_order socket event
    const evt: any = await eventPromise;
    expect(evt._id || evt.orderNumber).toBeTruthy();

    await new Promise(r => setTimeout(r, 500));
    expect(socket.getEvents('new_order').length).toBe(1);

    // Step 6: Order now in pending (kitchen-visible) state
    const checkRes = await api
      .get(`/api/orders/${orderId}`)
      .set(authHeaders(adminToken));
    const order1 = checkRes.body.order ?? checkRes.body;
    expect(order1.status).toBe('pending');
  }, 20_000);

  // ── 3. Kiosk + Razorpay → qr-verify → exactly 1 new_order ──────────────────
  // Same flow as QR but orderSource=kiosk.
  // Confirms kiosk Razorpay path also holds to payment_pending until verified.

  it('PAY-003 Kiosk + Razorpay → qr-verify → order status=pending + exactly 1 new_order', async () => {
    const orderRes = await api.post('/api/public/orders').send({
      hotelId,
      orderSource:   'kiosk',
      paymentMethod: 'razorpay',
      items:         [{ product: productId, quantity: 1 }],
      customerName:  'PAY-003 Kiosk Razorpay',
    });
    expect(orderRes.status).toBe(201);
    const order0 = orderRes.body.order ?? orderRes.body;
    expect(order0.status).toBe('payment_pending');
    const orderId    = order0._id as string;
    const grandTotal = order0.grandTotal as number;

    const rzpRes = await api.post('/api/public/payments/razorpay-order').send({
      hotelId,
      orderId,
      amount: grandTotal,
    });
    expect([200, 201]).toContain(rzpRes.status);
    const razorpayOrderId       = rzpRes.body.razorpayOrderId as string;
    const internalTransactionId = rzpRes.body.internalTransactionId as string;

    const razorpayPaymentId = `pay_test_${Date.now()}_ksk`;
    const signature         = signPayment(razorpayOrderId, razorpayPaymentId);

    socket.clearEvents();
    const eventPromise = socket.waitForEvent('new_order', 5_000);

    const verifyRes = await api.post('/api/public/payments/qr-verify').send({
      razorpay_payment_id:  razorpayPaymentId,
      razorpay_order_id:    razorpayOrderId,
      razorpay_signature:   signature,
      internalTransactionId,
      orderId,
      hotelId,
    });
    expect(verifyRes.status).toBe(200);
    expect(verifyRes.body.success).toBe(true);

    const evt: any = await eventPromise;
    expect(evt._id || evt.orderNumber).toBeTruthy();

    await new Promise(r => setTimeout(r, 500));
    expect(socket.getEvents('new_order').length).toBe(1);

    const checkRes = await api
      .get(`/api/orders/${orderId}`)
      .set(authHeaders(adminToken));
    const order1 = checkRes.body.order ?? checkRes.body;
    expect(order1.status).toBe('pending');
  }, 20_000);

  // ── 4. Race: qr-verify + webhook simultaneously → exactly 1 release ─────────
  // Fires both paths concurrently via Promise.all.
  // The atomic Order.findOneAndUpdate({ status:'payment_pending' }) ensures
  // exactly one caller gets qrReleased !== null and emits new_order.
  //
  // Webhook path uses real HMAC (no test bypass needed — verifyWebhook is a
  // local Razorpay.validateWebhookSignature() call, no live API).
  // qr-verify path uses HMAC + test bypass (skips payments.fetch()).

  it('PAY-004 Race: qr-verify + webhook simultaneously → exactly 1 new_order released', async () => {
    // Place order → payment_pending
    const orderRes = await api.post('/api/public/orders').send({
      hotelId,
      orderSource:   'qr',
      paymentMethod: 'razorpay',
      items:         [{ product: productId, quantity: 1 }],
      customerName:  'PAY-004 Race Condition',
    });
    expect(orderRes.status).toBe(201);
    const order0 = orderRes.body.order ?? orderRes.body;
    const orderId    = order0._id as string;
    const grandTotal = order0.grandTotal as number;

    // Create Razorpay payment record
    const rzpRes = await api.post('/api/public/payments/razorpay-order').send({
      hotelId,
      orderId,
      amount: grandTotal,
    });
    expect([200, 201]).toContain(rzpRes.status);
    const razorpayOrderId       = rzpRes.body.razorpayOrderId       as string;
    const internalTransactionId = rzpRes.body.internalTransactionId as string;

    // A distinct fake payment ID (different from the fake order ID returned by createPayment).
    // The gateway lookup in the webhook falls back to gatewayOrderId when
    // gatewayTransactionId doesn't match — so both paths find the same Payment record.
    const razorpayPaymentId = `pay_test_${Date.now()}_race`;
    const verifySignature   = signPayment(razorpayOrderId, razorpayPaymentId);

    // Webhook event — identical to what Razorpay sends on payment.captured
    const webhookPayload = {
      event: 'payment.captured',
      payload: {
        payment: {
          entity: {
            id:       razorpayPaymentId,
            order_id: razorpayOrderId,
            status:   'captured',
            method:   'upi',
          },
        },
      },
    };
    const rawBody    = JSON.stringify(webhookPayload);
    const webhookSig = signWebhook(rawBody);

    socket.clearEvents();

    // Fire both simultaneously
    const [verifyRes, webhookRes] = await Promise.all([
      api.post('/api/public/payments/qr-verify').send({
        razorpay_payment_id:  razorpayPaymentId,
        razorpay_order_id:    razorpayOrderId,
        razorpay_signature:   verifySignature,
        internalTransactionId,
        orderId,
        hotelId,
      }),
      api
        .post(`/api/payment-webhooks/razorpay/${hotelId}`)
        .set({
          'x-razorpay-signature': webhookSig,
          'Content-Type':         'application/json',
        })
        .send(webhookPayload),
    ]);

    // Both must complete without server errors
    expect([200, 201]).toContain(verifyRes.status);
    expect([200, 201]).toContain(webhookRes.status);

    // Allow 1 s for any in-flight socket emissions to land
    await new Promise(r => setTimeout(r, 1_000));

    // Exactly 1 new_order event despite 2 concurrent release attempts
    const events = socket.getEvents('new_order');
    expect(events.length).toBe(1);

    // Order is in exactly one final state — pending
    const checkRes = await api
      .get(`/api/orders/${orderId}`)
      .set(authHeaders(adminToken));
    const order1 = checkRes.body.order ?? checkRes.body;
    expect(order1.status).toBe('pending');
  }, 20_000);
});
