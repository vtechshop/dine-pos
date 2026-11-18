/**
 * DinePOS subscription price: standard is ₹14,000/year, and the billing webhook
 * records what Razorpay actually charged — read from the plan on the
 * subscription — so hotels still renewing on an older ₹12,000 plan are not
 * recorded at the new price.
 */
jest.mock('../../src/server', () => {
  const chain: any = { emit: jest.fn() };
  chain.to = jest.fn(() => chain);
  return { io: { to: jest.fn(() => chain), sockets: { sockets: new Map(), adapter: { rooms: new Map() } } } };
});

// Fake Razorpay: plan prices and subscription → plan, no network.
const mockPlans: Record<string, number> = {};          // plan_id → paise
const mockSubPlans: Record<string, string> = {};       // sub_id → plan_id
let mockRazorpayDown = false;
jest.mock('razorpay', () => jest.fn().mockImplementation(() => ({
  plans: {
    fetch: jest.fn(async (id: string) => {
      if (mockRazorpayDown) throw new Error('network down');
      if (!(id in mockPlans)) throw new Error('plan not found');
      return { id, item: { amount: mockPlans[id] } };
    }),
  },
  subscriptions: {
    fetch: jest.fn(async (id: string) => {
      if (mockRazorpayDown) throw new Error('network down');
      return { id, plan_id: mockSubPlans[id] };
    }),
  },
})));

process.env.RAZORPAY_SAAS_KEY_ID         = 'rzp_test_key';
process.env.RAZORPAY_SAAS_KEY_SECRET     = 'rzp_test_secret';
process.env.RAZORPAY_SAAS_WEBHOOK_SECRET = 'saas-webhook-test-secret';

import { startDb, stopDb, clearDb, createHotel } from './harness';
import express from 'express';
import crypto from 'crypto';
import request from 'supertest';
import Subscription from '../../src/models/Subscription';
import { SAAS_STANDARD_PRICE_INR, getYearlyPriceForPlan } from '../../src/utils/planLimits';

jest.setTimeout(120_000);

// eslint-disable-next-line @typescript-eslint/no-require-imports
const webhookRoutes = require('../../src/routes/saasBillingWebhookRoutes').default;

// Same raw-body capture as server.ts, so signatures can be checked.
const app = express();
app.use(express.json({ verify: (req, _res, buf) => { (req as any).rawBody = buf.toString('utf8'); } }));
app.use('/api/saas/webhook', webhookRoutes);

function send(body: object) {
  const raw = JSON.stringify(body);
  const sig = crypto.createHmac('sha256', process.env.RAZORPAY_SAAS_WEBHOOK_SECRET!).update(raw).digest('hex');
  return request(app).post('/api/saas/webhook')
    .set('Content-Type', 'application/json').set('X-Razorpay-Signature', sig).send(raw);
}

const activated = (subId: string, planId: string) => ({
  event: 'subscription.activated',
  payload: { subscription: { entity: { id: subId, plan_id: planId, current_start: 1_790_000_000, current_end: 1_821_536_000 } } },
});
// Renewal events carry the invoice only — no plan id.
const renewed = (subId: string, invoiceId: string) => ({
  event: 'invoice.paid',
  payload: { invoice: { entity: { id: invoiceId, subscription_id: subId } } },
});

beforeAll(startDb);
afterAll(stopDb);
afterEach(async () => { mockRazorpayDown = false; await clearDb(); });

test('standard price is ₹14,000 a year', () => {
  expect(SAAS_STANDARD_PRICE_INR).toBe(14_000);
  expect(getYearlyPriceForPlan('standard')).toBe(14_000);
});

test('new subscription on the ₹14,000 plan is recorded at ₹14,000', async () => {
  mockPlans.plan_std14 = 1_400_000;
  const hotel = await createHotel({ status: 'trial', rzpSubscriptionId: 'sub_new' });

  const res = await send(activated('sub_new', 'plan_std14'));
  expect(res.status).toBe(200);
  const sub = await Subscription.findOne({ hotelId: hotel._id }).lean();
  expect(sub?.amount).toBe(14_000);
  expect(sub?.rzpPlanId).toBe('plan_std14');
});

test('renewal on an old ₹12,000 plan is recorded at ₹12,000, not the new price', async () => {
  mockPlans.plan_std12 = 1_200_000;
  mockSubPlans.sub_old = 'plan_std12';
  const hotel = await createHotel({ rzpSubscriptionId: 'sub_old' });

  const res = await send(renewed('sub_old', 'inv_old_1'));
  expect(res.status).toBe(200);
  const sub = await Subscription.findOne({ hotelId: hotel._id, rzpInvoiceId: 'inv_old_1' }).lean();
  expect(sub?.amount).toBe(12_000);
  expect(sub?.isRenewal).toBe(true);
});

test('custom-price plan is recorded at its own price', async () => {
  mockPlans.plan_custom9 = 900_000;
  const hotel = await createHotel({ status: 'trial', rzpSubscriptionId: 'sub_custom', saasAnnualPrice: 9_000, rzpCustomPlanId: 'plan_custom9' });

  await send(activated('sub_custom', 'plan_custom9')).expect(200);
  const sub = await Subscription.findOne({ hotelId: hotel._id }).lean();
  expect(sub?.amount).toBe(9_000);
});

describe('Razorpay unreachable', () => {
  test('renewal keeps what this subscription was charged last time', async () => {
    const hotel = await createHotel({ rzpSubscriptionId: 'sub_down_old' });
    await Subscription.create({
      hotelId: hotel._id, plan: 'standard', status: 'active', startDate: new Date('2025-11-01'), endDate: new Date('2026-11-01'),
      amount: 12_000, currency: 'INR', paymentMethod: 'razorpay_subscription', billingCycle: 'yearly',
      rzpSubscriptionId: 'sub_down_old', rzpInvoiceId: 'inv_prev', paidAt: new Date('2025-11-01'), isRenewal: false,
    });
    mockRazorpayDown = true;

    await send(renewed('sub_down_old', 'inv_down_2')).expect(200);
    const sub = await Subscription.findOne({ rzpInvoiceId: 'inv_down_2' }).lean();
    expect(sub?.amount).toBe(12_000);
  });

  test('hotel with a custom price uses that price', async () => {
    const hotel = await createHotel({ rzpSubscriptionId: 'sub_down_custom', saasAnnualPrice: 10_000 });
    mockRazorpayDown = true;

    await send(renewed('sub_down_custom', 'inv_down_c')).expect(200);
    const sub = await Subscription.findOne({ hotelId: hotel._id }).lean();
    expect(sub?.amount).toBe(10_000);
  });

  test('brand-new standard subscription falls back to ₹14,000', async () => {
    const hotel = await createHotel({ status: 'trial', rzpSubscriptionId: 'sub_down_new' });
    mockRazorpayDown = true;

    await send(activated('sub_down_new', 'plan_unknown')).expect(200);
    const sub = await Subscription.findOne({ hotelId: hotel._id }).lean();
    expect(sub?.amount).toBe(14_000);
  });
});
