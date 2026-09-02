// Starts the backend server in test mode (rate limiter disabled).
// Use this instead of `node dist/server.js` when running automation tests.
//
//   npm run start:test
//   node start-test.js
//
// This sets NODE_ENV=test BEFORE server.ts loads dotenv, so the rate-limiter
// skip() check sees 'test' regardless of what backend/.env says.
process.env.NODE_ENV = 'test';
// Allows integration tests to exercise the full payment flow without live Razorpay API calls.
// The gateway still verifies HMAC signatures — only the final payments.fetch() is skipped.
process.env.RAZORPAY_TEST_BYPASS = 'true';
require('./dist/server.js');
