/**
 * One-time setup script: create the DinePOS SaaS standard ₹12,000/year plan on Razorpay.
 *
 * Run ONCE before going live. Store the returned plan_id as RAZORPAY_PLAN_ID_STANDARD
 * in your production environment variables.
 *
 * Usage:
 *   RAZORPAY_SAAS_KEY_ID=rzp_live_xxx RAZORPAY_SAAS_KEY_SECRET=xxx node src/scripts/create-standard-razorpay-plan.js
 *
 * Or with dotenv:
 *   node -r dotenv/config src/scripts/create-standard-razorpay-plan.js
 */

'use strict';

const Razorpay = require('razorpay');

const keyId     = process.env.RAZORPAY_SAAS_KEY_ID;
const keySecret = process.env.RAZORPAY_SAAS_KEY_SECRET;

if (!keyId || !keySecret) {
  console.error('ERROR: Set RAZORPAY_SAAS_KEY_ID and RAZORPAY_SAAS_KEY_SECRET before running this script.');
  process.exit(1);
}

const rzp = new Razorpay({ key_id: keyId, key_secret: keySecret });

async function main() {
  console.log('Creating DinePOS SaaS standard plan: ₹12,000/year ...');

  const plan = await rzp.plans.create({
    period:   'yearly',
    interval: 1,
    item: {
      name:     'DinePOS SaaS Standard',
      amount:   1_200_000,   // ₹12,000 in paise
      currency: 'INR',
      description: 'DinePOS annual SaaS subscription — unlimited devices',
    },
    notes: {
      product: 'DinePOS SaaS',
      tier:    'standard',
    },
  });

  console.log('\n✅ Plan created successfully!');
  console.log('   Plan ID:', plan.id);
  console.log('   Amount: ₹', plan.item.amount / 100, 'per year');
  console.log('\nAdd this to your environment variables:');
  console.log(`   RAZORPAY_PLAN_ID_STANDARD=${plan.id}`);
  console.log('\nDo NOT run this script again — Razorpay does not deduplicate plans.');
}

main().catch(err => {
  console.error('Failed to create plan:', err.message ?? err);
  process.exit(1);
});
