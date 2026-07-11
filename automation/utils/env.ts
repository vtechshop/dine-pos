import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env.test') });

export const ENV = {
  API_URL: process.env.TEST_API_URL || 'http://localhost:5000',
  SOCKET_URL: process.env.SOCKET_URL || 'http://localhost:5000',
  MONGODB_TEST_URI: process.env.MONGODB_TEST_URI || 'mongodb://localhost:27017/dinepos_test',
  JWT_SECRET: process.env.JWT_SECRET || 'hotelbillingpos_secret_key_change_in_production',
  SUPER_ADMIN_ID: process.env.SUPER_ADMIN_ID || 'superadmin',
  SUPER_ADMIN_PASS: process.env.SUPER_ADMIN_PASS || 'super1234',
  WEB_BASE_URL: process.env.WEB_BASE_URL || 'http://localhost:3000',
  QR_BASE_URL: process.env.QR_BASE_URL || 'http://localhost:5000/api/public',
  DEFAULT_TIMEOUT: parseInt(process.env.DEFAULT_TIMEOUT || '10000'),
  SOCKET_TIMEOUT: parseInt(process.env.SOCKET_TIMEOUT || '8000'),
  CI: process.env.CI === 'true',
  HEADLESS: process.env.HEADLESS !== 'false',
} as const;

export const superAdminHeaders = {
  'x-super-admin-id': ENV.SUPER_ADMIN_ID,
  'x-super-admin-pass': ENV.SUPER_ADMIN_PASS,
  'Content-Type': 'application/json',
};

export const authHeaders = (token: string) => ({
  Authorization: `Bearer ${token}`,
  'Content-Type': 'application/json',
});
