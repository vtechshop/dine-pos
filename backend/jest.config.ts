import type { Config } from 'jest';

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/test'],
  testMatch: ['**/*.test.ts'],
  transform: {
    '^.+\\.tsx?$': ['ts-jest', {
      tsconfig: {
        // Relax strict settings for test files so mocks are easier to write
        strict: false,
        esModuleInterop: true,
        resolveJsonModule: true,
      },
    }],
  },
  moduleNameMapper: {
    // Allow importing from src without compile step
    '^../src/(.*)$': '<rootDir>/src/$1',
  },
  // Collect coverage only from the tested modules
  collectCoverageFrom: [
    'src/utils/businessDate.ts',
    'src/services/chatTools.ts',
    'src/services/alertEngine.ts',
    'src/routes/aiChatRoutes.ts',
  ],
  coverageDirectory: 'coverage',
  verbose: true,
};

export default config;
