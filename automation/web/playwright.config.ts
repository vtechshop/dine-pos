import { defineConfig, devices } from '@playwright/test';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(__dirname, '../.env.test') });

const BASE_URL = process.env.WEB_BASE_URL || 'http://localhost:3000';

export default defineConfig({
  testDir: './tests',
  outputDir: '../reports/playwright',
  timeout: 30000,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : 2,
  fullyParallel: false,
  reporter: [
    ['html', { outputFolder: '../reports/playwright-html', open: 'never' }],
    ['junit', { outputFile: '../reports/junit/web-results.xml' }],
    ['list'],
  ],
  use: {
    baseURL: BASE_URL,
    headless: true,
    viewport: { width: 1280, height: 720 },
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    trace: 'retain-on-failure',
    actionTimeout: 10000,
    navigationTimeout: 15000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },
  ],
});
