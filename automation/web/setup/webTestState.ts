import * as fs from 'fs';
import * as path from 'path';

const STATE_FILE = path.resolve(__dirname, '../.web-test-state.json');

export interface WebTestState {
  hotelId: string;
  adminId: string;
  password: string;
  phone: string;
  setupAt: string;
}

let _state: WebTestState | null = null;

function loadState(): WebTestState {
  if (_state) return _state;
  if (fs.existsSync(STATE_FILE)) {
    _state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) as WebTestState;
    return _state;
  }
  // Fallback: read from environment (set manually or via legacy secrets approach)
  const adminId = process.env.ADMIN_ID || '';
  const password = process.env.ADMIN_PASSWORD || '';
  _state = { hotelId: '', adminId, password, phone: '', setupAt: '' };
  return _state;
}

export function getAdminId(): string {
  return loadState().adminId;
}

export function getAdminPassword(): string {
  return loadState().password;
}
