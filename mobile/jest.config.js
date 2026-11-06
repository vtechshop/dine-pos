// Unit tests for PURE modules only (no React Native / Expo runtime):
// src/sync/offlineRules.ts, src/services/customerOrderQueue.ts.
// Device behaviour (NetInfo, SQLite, Bluetooth, background) still needs a real
// Android device — see docs/staging-device-test-plan.md.
module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.test.ts'],
  transform: {
    '^.+\\.ts$': ['ts-jest', {
      isolatedModules: true,
      tsconfig: '<rootDir>/tsconfig.jest.json',
    }],
  },
};
