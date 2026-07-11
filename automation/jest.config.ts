import type { Config } from 'jest';

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '.',
  testMatch: ['**/api/tests/**/*.test.ts'],
  testTimeout: 30000,
  globalSetup: './api/setup/globalSetup.ts',
  globalTeardown: './api/setup/globalTeardown.ts',
  collectCoverageFrom: [
    'api/**/*.ts',
    '!api/setup/**',
    '!**/*.d.ts',
  ],
  coverageThreshold: {
    global: {
      branches: 80,
      functions: 90,
      lines: 90,
      statements: 90,
    },
  },
  coverageDirectory: 'reports/coverage',
  coverageReporters: ['html', 'lcov', 'text', 'json-summary'],
  reporters: [
    'default',
    [
      'jest-html-reporters',
      {
        publicPath: './reports/html',
        filename: 'report.html',
        openReport: false,
        pageTitle: 'Dine POS API Test Report',
        logoImgPath: undefined,
        expand: true,
        hideIcon: false,
        testCommand: 'npm run test:api',
        failureMessageOnly: false,
        enableMergeData: false,
        dataMergeLevel: 1,
        inlineSource: true,
      },
    ],
    [
      'jest-junit',
      {
        outputDirectory: './reports/junit',
        outputName: 'api-results.xml',
        classNameTemplate: '{classname}',
        titleTemplate: '{title}',
        ancestorSeparator: ' › ',
        usePathForSuiteName: true,
      },
    ],
  ],
  verbose: true,
  forceExit: true,
  detectOpenHandles: true,
  testSequencer: './api/setup/testSequencer.js',
  transform: {
    '^.+\\.ts$': ['ts-jest', {
      tsconfig: './tsconfig.json',
      diagnostics: false,
    }],
  },
  moduleNameMapper: {
    '^@utils/(.*)$': '<rootDir>/utils/$1',
    '^@fixtures/(.*)$': '<rootDir>/fixtures/$1',
    '^@helpers/(.*)$': '<rootDir>/api/helpers/$1',
  },
  maxWorkers: 1,
};

export default config;
