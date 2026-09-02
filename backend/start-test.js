// Starts the backend server in test mode (rate limiter disabled).
// Use this instead of `node dist/server.js` when running automation tests.
//
//   npm run start:test
//   node start-test.js
//
// This sets NODE_ENV=test BEFORE server.ts loads dotenv, so the rate-limiter
// skip() check sees 'test' regardless of what backend/.env says.
//
// MONGODB_URI: dotenv does not override existing env vars. If MONGODB_URI is
// not already set in the shell, we redirect to the local test database so that
// the production-Atlas safety guard in server.ts doesn't fire.
process.env.NODE_ENV = 'test';

if (!process.env.MONGODB_URI || process.env.MONGODB_URI.includes('.mongodb.net')) {
  // Prefer MONGODB_TEST_URI from the automation .env.test, fall back to local default.
  const testUri =
    process.env.MONGODB_TEST_URI ||
    'mongodb://localhost:27017/dinepos_test';
  process.env.MONGODB_URI = testUri;
}

// Allows integration tests to exercise the full payment flow without live Razorpay API calls.
// The gateway still verifies HMAC signatures — only the final payments.fetch() is skipped.
process.env.RAZORPAY_TEST_BYPASS = 'true';
require('./dist/server.js');
