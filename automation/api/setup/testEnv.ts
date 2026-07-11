import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const STATE_FILE = path.resolve(__dirname, '../../.test-state.json');

export interface HotelState {
  hotelId: string;
  adminId: string;
  password: string;
  phone: string;
  kitchenPin: string;
  adminToken: string;
  kitchenToken: string;
  waiterToken: string;
  cashierToken: string;
  waiter: { employeeCode: string; pin: string; waiterId: string };
  cashier: { employeeCode: string; pin: string; cashierId: string };
  categoryId: string;
  products: Array<{ id: string; name: string; price: number }>;
}

export interface TestState {
  hotelA: HotelState;
  hotelB: HotelState;
  pendingHotel: { hotelId: string; phone: string };
  setupAt: string;
}

let _state: TestState | null = null;

export function getTestState(): TestState {
  if (_state) return _state;
  if (!fs.existsSync(STATE_FILE)) {
    throw new Error(
      `[TestEnv] State file not found at ${STATE_FILE}. Did globalSetup run?\n` +
      `Run: npm run test:api -- --runInBand to ensure setup runs first.`
    );
  }
  _state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) as TestState;
  return _state;
}

export function getHotelA(): HotelState {
  return getTestState().hotelA;
}

export function getHotelB(): HotelState {
  return getTestState().hotelB;
}

export function getPendingHotel(): { hotelId: string; phone: string } {
  return getTestState().pendingHotel;
}

export function freshPhone(): string {
  // Cryptographically random 10-digit number starting with '8'
  // → no counter, no fixed sequence, unique across runs and parallel calls
  // Matches teardown regex '^8[0-9]{9}$' so these hotels are cleaned between runs
  const n = crypto.randomInt(0, 1_000_000_000);
  return '8' + n.toString().padStart(9, '0');
}

export function freshEmail(tag = 'adhoc'): string {
  // UUID suffix: unique even for rapid successive calls within the same millisecond
  return `test-${tag}-${crypto.randomUUID()}@automation.local`;
}
