// Starts the backend server in test mode (rate limiter disabled).
// Use this instead of `node dist/server.js` when running automation tests.
//
//   npm run start:test
//   node start-test.js
//
// This sets NODE_ENV=test BEFORE server.ts loads dotenv, so the rate-limiter
// skip() check sees 'test' regardless of what backend/.env says.
process.env.NODE_ENV = 'test';
require('./dist/server.js');
