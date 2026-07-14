import AsyncStorage from '@react-native-async-storage/async-storage';
import { API_BASE_URL } from '../utils/constants';
import { Category, Product, Order, Settings, DailyReport, Hotel, SuperAdminStats, Table, Reservation, Expense, WasteLog, PnLReport, Customer, Ingredient, GSTReport, TallyReport, GSTR1Json, RemoteConfig, Device, AppNotification, FeatureFlags } from '../types';
import { navigateGlobal } from '../utils/navigationRef';
import { emitSessionExpired } from '../utils/authEvents';

const API_URL_STORAGE_KEY = '@hotel_pos_api_base_url';
const JWT_STORAGE_KEY = '@hotel_pos_jwt_token';
const REFRESH_TOKEN_STORAGE_KEY = '@hotel_pos_refresh_token';
const HOTEL_ID_STORAGE_KEY = '@hotel_pos_hotel_id';

let _cachedBaseUrl: string | null = null;
let _cachedToken: string | null = null;
let _cachedRefreshToken: string | null = null;

export const getBaseUrl = async (): Promise<string> => {
  if (_cachedBaseUrl) return _cachedBaseUrl;
  try {
    const stored = await AsyncStorage.getItem(API_URL_STORAGE_KEY);
    _cachedBaseUrl = stored?.trim() || API_BASE_URL;
  } catch {
    _cachedBaseUrl = API_BASE_URL;
  }
  return _cachedBaseUrl;
};

export const clearApiUrlCache = () => { _cachedBaseUrl = null; };

// Returns the socket.io server URL (strips /api suffix from base URL)
export const getSocketUrl = async (): Promise<string> => {
  const base = await getBaseUrl();
  return base.replace(/\/api$/, '');
};

// ── JWT helpers ─────────────────────────────────────────────────────────────

export const saveToken = async (token: string): Promise<void> => {
  _cachedToken = token;
  await AsyncStorage.setItem(JWT_STORAGE_KEY, token);
};

export const getToken = async (): Promise<string | null> => {
  if (_cachedToken) return _cachedToken;
  try {
    _cachedToken = await AsyncStorage.getItem(JWT_STORAGE_KEY);
  } catch {
    _cachedToken = null;
  }
  return _cachedToken;
};

export const clearToken = async (): Promise<void> => {
  _cachedToken = null;
  await AsyncStorage.removeItem(JWT_STORAGE_KEY);
  // hotelId is kept after logout so the customer kiosk menu still works
};

// ── Refresh token helpers ────────────────────────────────────────────────────

export const saveRefreshToken = async (token: string): Promise<void> => {
  _cachedRefreshToken = token;
  await AsyncStorage.setItem(REFRESH_TOKEN_STORAGE_KEY, token);
};

export const getRefreshToken = async (): Promise<string | null> => {
  if (_cachedRefreshToken) return _cachedRefreshToken;
  try {
    _cachedRefreshToken = await AsyncStorage.getItem(REFRESH_TOKEN_STORAGE_KEY);
  } catch {
    _cachedRefreshToken = null;
  }
  return _cachedRefreshToken;
};

export const clearRefreshToken = async (): Promise<void> => {
  _cachedRefreshToken = null;
  await AsyncStorage.removeItem(REFRESH_TOKEN_STORAGE_KEY);
};

export const getStoredHotelId = async (): Promise<string | null> => {
  try {
    return await AsyncStorage.getItem(HOTEL_ID_STORAGE_KEY);
  } catch {
    return null;
  }
};

// ── Super admin credentials ──────────────────────────────────────────────────

let superAdminCredentials = { id: '', pass: '' };
export const setSuperAdminCredentials = (id: string, pass: string) => {
  superAdminCredentials = { id, pass };
};

// ── JWT helpers (no external library) ────────────────────────────────────────

// Decodes the payload section of a JWT without verifying the signature.
export const decodeJwtPayload = (token: string): Record<string, any> | null => {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    // base64url → base64 + padding
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64 + '=='.slice(0, (4 - (b64.length % 4)) % 4);
    return JSON.parse(atob(padded));
  } catch {
    return null;
  }
};

// Returns the JWT expiry as a unix-epoch ms value, or null if not decodable.
export const getJwtExpiryMs = async (): Promise<number | null> => {
  const token = await getToken();
  if (!token) return null;
  const payload = decodeJwtPayload(token);
  if (typeof payload?.exp !== 'number') return null;
  return payload.exp * 1000;
};

// ── Token refresh singleton ──────────────────────────────────────────────────
// Prevents concurrent 401s from firing multiple parallel refresh attempts.

let _refreshing: Promise<boolean> | null = null;

const _doRefresh = async (): Promise<boolean> => {
  const refreshToken = await getRefreshToken();
  if (!refreshToken) return false;
  try {
    const result = await fetchAPI<{ token: string; refreshToken: string }>(
      '/auth/refresh',
      { method: 'POST', body: JSON.stringify({ refreshToken }) },
      true, // skipAuth — no Bearer header needed
      0,    // no retries on the refresh call itself
    );
    await Promise.all([saveToken(result.token), saveRefreshToken(result.refreshToken)]);
    return true;
  } catch {
    await Promise.all([clearToken(), clearRefreshToken()]);
    return false;
  }
};

export const tryRefreshTokens = (): Promise<boolean> => {
  if (_refreshing) return _refreshing;
  _refreshing = _doRefresh().finally(() => { _refreshing = null; });
  return _refreshing;
};

// Validates the stored JWT locally (expiry check) and refreshes if needed.
// Safe to call at app launch — avoids a network round-trip when token is still fresh.
export const validateSession = async (): Promise<'valid' | 'refreshed' | 'expired'> => {
  const token = await getToken();
  if (!token) {
    const ok = await tryRefreshTokens();
    return ok ? 'refreshed' : 'expired';
  }
  const payload = decodeJwtPayload(token);
  // If we can't decode, trust the token and let the server reject if stale.
  if (typeof payload?.exp !== 'number') return 'valid';
  if (payload.exp * 1000 > Date.now()) return 'valid';
  // Token expired — attempt silent refresh.
  const ok = await tryRefreshTokens();
  return ok ? 'refreshed' : 'expired';
};

// ── Generic fetch wrapper ────────────────────────────────────────────────────

const fetchAPI = async <T>(
  endpoint: string,
  options?: RequestInit,
  skipAuth = false,
  retries = 2,
  _isTokenRetry = false,
): Promise<T> => {
  const baseUrl = await getBaseUrl();

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (!skipAuth) {
    const token = await getToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;
  }
  const mergedHeaders = options?.headers
    ? { ...headers, ...(options.headers as Record<string, string>) }
    : headers;

  let lastError: Error = new Error('Unknown error');

  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 12000);

    try {
      const response = await fetch(`${baseUrl}${endpoint}`, {
        ...options,
        headers: mergedHeaders,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errBody = await response.json().catch(() => ({}));

        // 401: try refreshing tokens once (never on the refresh endpoint itself)
        if (response.status === 401 && !skipAuth && !_isTokenRetry && endpoint !== '/auth/refresh') {
          const refreshed = await tryRefreshTokens();
          if (refreshed) {
            return fetchAPI<T>(endpoint, options, skipAuth, retries, true);
          }
          // Both tokens exhausted — notify AuthContext to clear state and redirect.
          emitSessionExpired().catch(() => {});
          const err: any = new Error('Session expired. Please login again.');
          err.code = 'SESSION_EXPIRED';
          throw err;
        }

        // Don't retry other client errors (4xx)
        if (response.status < 500) {
          const err: any = new Error(errBody.message || 'Request failed');
          if (errBody.code) err.code = errBody.code;
          if (errBody.code === 'TRIAL_EXPIRED' || errBody.code === 'PLAN_EXPIRED') {
            const expiredOnRaw = errBody.expiredOn;
            const expiredOn = expiredOnRaw
              ? new Date(expiredOnRaw).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
              : 'Unknown';
            navigateGlobal('SubscriptionExpired', {
              hotelName: errBody.hotelName || 'Your Business',
              expiredOn,
              subscriptionType: errBody.subscriptionType || 'trial',
            });
          }
          throw err;
        }
        // Retry server errors (5xx) after backoff
        lastError = new Error(errBody.message || `Server error (${response.status})`);
        if (attempt < retries) {
          await new Promise(r => setTimeout(r, 800 * (attempt + 1)));
          continue;
        }
        throw lastError;
      }

      return response.json();
    } catch (error: any) {
      clearTimeout(timeoutId);

      if (error.name === 'AbortError') {
        lastError = new Error('Request timed out. Check your connection.');
      } else if (error.message === 'Network request failed') {
        lastError = new Error('Server unreachable. Check Wi-Fi and server.');
      } else {
        lastError = error;
      }

      // Retry on timeout or network errors
      const isRetryable = error.name === 'AbortError' || error.message === 'Network request failed';
      if (isRetryable && attempt < retries) {
        await new Promise(r => setTimeout(r, 800 * (attempt + 1)));
        continue;
      }
      throw lastError;
    }
  }

  throw lastError;
};

// ==================== AUTH ====================

export const adminLogin = async (
  userId: string,
  password: string
): Promise<{
  success: boolean;
  token: string;
  refreshToken?: string;
  hotelId: string;
  hotelName: string;
  status?: string;
  trialDaysRemaining?: number;
  trialEndDate?: string;
  subscriptionPlan?: string;
  features?: FeatureFlags;
}> => {
  const result = await fetchAPI<{
    success: boolean;
    token: string;
    refreshToken?: string;
    hotelId: string;
    hotelName: string;
    status?: string;
    trialDaysRemaining?: number;
    trialEndDate?: string;
    subscriptionPlan?: string;
    features?: FeatureFlags;
  }>(
    '/auth/login',
    { method: 'POST', body: JSON.stringify({ userId, password }) },
    true // skip auth header on login
  );
  if (result.token) await saveToken(result.token);
  if (result.refreshToken) await saveRefreshToken(result.refreshToken);
  if (result.hotelId) await AsyncStorage.setItem(HOTEL_ID_STORAGE_KEY, result.hotelId);
  return result;
};

export const logout = async (): Promise<void> => {
  const refreshToken = await getRefreshToken();
  // Fire-and-forget server-side revocation — don't block or crash on failure
  if (refreshToken) {
    fetchAPI('/auth/logout', {
      method: 'POST',
      body: JSON.stringify({ refreshToken }),
    }, true, 0).catch(() => {});
  }
  await Promise.all([clearToken(), clearRefreshToken()]);
};

// ==================== CATEGORIES ====================

export const getCategories = (): Promise<Category[]> => {
  return fetchAPI<Category[]>('/categories');
};

export const createCategory = (data: Partial<Category>): Promise<Category> => {
  return fetchAPI<Category>('/categories', {
    method: 'POST',
    body: JSON.stringify(data),
  });
};

export const updateCategory = (
  id: string,
  data: Partial<Category>
): Promise<Category> => {
  return fetchAPI<Category>(`/categories/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
};

export const deleteCategory = (id: string): Promise<void> => {
  return fetchAPI(`/categories/${id}`, { method: 'DELETE' });
};

// ==================== PRODUCTS ====================

export const getProducts = (categoryId?: string, onlyAvailable?: boolean): Promise<Product[]> => {
  const params: string[] = [];
  if (categoryId) params.push(`category=${categoryId}`);
  if (onlyAvailable) params.push('available=true');
  const query = params.length > 0 ? `?${params.join('&')}` : '';
  return fetchAPI<Product[]>(`/products${query}`);
};

export const createProduct = (data: Partial<Product>): Promise<Product> => {
  return fetchAPI<Product>('/products', {
    method: 'POST',
    body: JSON.stringify(data),
  });
};

export const updateProduct = (
  id: string,
  data: Partial<Product>
): Promise<Product> => {
  return fetchAPI<Product>(`/products/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
};

export const deleteProduct = (id: string): Promise<void> => {
  return fetchAPI(`/products/${id}`, { method: 'DELETE' });
};

// ==================== IMAGE UPLOAD ====================

export const uploadImage = async (uri: string): Promise<string> => {
  const baseUrl = await getBaseUrl();
  const token = await getToken();

  const formData = new FormData();
  const filename = uri.split('/').pop() || 'photo.jpg';
  const match = /\.(\w+)$/.exec(filename);
  const type = match ? `image/${match[1].toLowerCase()}` : 'image/jpeg';

  formData.append('image', { uri, name: filename, type } as any);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000); // 30s for upload

  try {
    const response = await fetch(`${baseUrl}/uploads/image`, {
      method: 'POST',
      headers: {
        'Content-Type': 'multipart/form-data',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: formData,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Upload failed');
    }

    const data: { url: string } = await response.json();
    return data.url; // e.g. "/uploads/filename.jpg"
  } catch (error: any) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') throw new Error('Upload timed out.');
    throw error;
  }
};

// ==================== ORDERS ====================

export const getOrders = (
  params?: Record<string, string>
): Promise<{ orders: Order[]; total: number; page: number; pages: number }> => {
  const query = params
    ? '?' + new URLSearchParams(params).toString()
    : '';
  return fetchAPI(`/orders${query}`);
};

export const getOrder = (id: string): Promise<Order> => {
  return fetchAPI<Order>(`/orders/${id}`);
};

export const createOrder = (data: Partial<Order>): Promise<Order> => {
  return fetchAPI<Order>('/orders', {
    method: 'POST',
    body: JSON.stringify(data),
  });
};

// Public order placement — no auth, used by customer QR menu kiosk
export const createPublicOrder = async (data: {
  hotel: string;
  source?: 'dine-in' | 'qr';
  items: Array<{
    product: string;
    productName: string;
    quantity: number;
    price: number;
    taxPercent: number;
    taxAmount: number;
    total: number;
  }>;
  tableNumber?: string;
  customerName?: string;
  notes?: string;
  isParcel?: boolean;
  // Required by legacy backend handler which trusts client totals;
  // new backend recalculates server-side and ignores these.
  subtotal?: number;
  taxTotal?: number;
  grandTotal?: number;
  orderSource?: string;
  paymentMethod?: string;
  status?: string;
}): Promise<Order> => {
  return fetchAPI<Order>('/public/orders', {
    method: 'POST',
    body: JSON.stringify(data),
  }, true); // skipAuth — public endpoint, no JWT needed
};

export const updateOrder = (
  id: string,
  data: Partial<Order>
): Promise<Order> => {
  return fetchAPI<Order>(`/orders/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
};

export const updateOrderStatus = (
  id: string,
  status: Order['status']
): Promise<Order> => {
  return fetchAPI<Order>(`/orders/${id}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  });
};

// ==================== CUSTOMERS ====================

export const getCustomers = (params?: { from?: string; to?: string }): Promise<{ customers: Customer[]; total: number }> => {
  const query = params && params.from && params.to ? `?${new URLSearchParams(params).toString()}` : '';
  return fetchAPI(`/orders/customers${query}`);
};

// ==================== REPORTS ====================

export const getProductSalesReport = (date?: string): Promise<{ date: string; products: { productName: string; totalQty: number; totalRevenue: number }[] }> => {
  const query = date ? `?date=${date}` : '';
  return fetchAPI(`/orders/reports/products${query}`);
};

export const getLowStockProducts = (threshold = 5): Promise<{ products: Product[]; threshold: number }> => {
  return fetchAPI(`/products/alerts/low-stock?threshold=${threshold}`);
};

export const getDailyReport = (date?: string): Promise<DailyReport> => {
  const query = date ? `?date=${date}` : '';
  return fetchAPI<DailyReport>(`/orders/reports/daily${query}`);
};

export const getRangeReport = (from: string, to: string): Promise<DailyReport> =>
  fetchAPI<DailyReport>(`/orders/reports/range?from=${from}&to=${to}`);

export const getGSTReport = (from: string, to: string): Promise<GSTReport> => {
  return fetchAPI<GSTReport>(`/reports/gst?from=${from}&to=${to}`);
};

export const getTallyExport = (from: string, to: string): Promise<TallyReport> => {
  return fetchAPI<TallyReport>(`/reports/tally?from=${from}&to=${to}`);
};

export const getGSTR1Json = (from: string, to: string): Promise<GSTR1Json> => {
  return fetchAPI<GSTR1Json>(`/reports/gstr1-json?from=${from}&to=${to}`);
};

// ==================== SETTINGS ====================

export const getSettings = (): Promise<Settings> => {
  return fetchAPI<Settings>('/settings');
};

export const updateSettings = (data: Partial<Settings>): Promise<Settings> => {
  return fetchAPI<Settings>('/settings', {
    method: 'PUT',
    body: JSON.stringify(data),
  });
};

// ==================== PUBLIC MENU (customer kiosk — no auth) ====================

export const getPublicMenu = async (): Promise<{
  hotel: { name: string; address: string; phone: string; currency: string };
  categories: Category[];
  products: Product[];
}> => {
  const hotelId = await getStoredHotelId();
  const query = hotelId ? `?hotel=${hotelId}` : '';
  return fetchAPI(`/public/menu${query}`, undefined, true);
};

// ==================== SEED ====================

export const seedData = (): Promise<{ message: string }> => {
  return fetchAPI('/seed', { method: 'POST' });
};

export const resetDemoData = (): Promise<{ message: string }> => {
  return fetchAPI('/seed', { method: 'DELETE' });
};

// ==================== HOTEL REGISTRATION ====================

export const registerHotel = (data: Partial<Hotel>): Promise<{ message: string; hotelId: string }> => {
  return fetchAPI('/hotels/register', { method: 'POST', body: JSON.stringify(data) }, true);
};

export const checkHotelStatus = (phone: string): Promise<Partial<Hotel>> => {
  return fetchAPI(`/hotels/status/${phone}`, undefined, true);
};

export const resubmitHotel = (phone: string, data: Partial<Hotel>): Promise<{ message: string }> => {
  return fetchAPI(`/hotels/resubmit/${phone}`, { method: 'PUT', body: JSON.stringify(data) }, true);
};

export const requestCredentialReset = (phone: string): Promise<{ message: string }> => {
  return fetchAPI('/hotels/reset-request', { method: 'POST', body: JSON.stringify({ phone }) }, true);
};

export const checkResetStatus = (phone: string): Promise<{ adminId?: string; resetRequested?: boolean; resetFulfilledAt?: string; hotelName?: string }> => {
  return fetchAPI(`/hotels/reset-status/${phone}`, undefined, true);
};

export const getSubscriptionInfo = (): Promise<{
  subscriptionStatus: string;
  subscriptionType: string;
  trialEndDate: string | null;
  subscriptionEndDate: string | null;
  daysRemaining: number;
  isExpired: boolean;
  hotelName: string;
}> => fetchAPI('/hotels/subscription');

// ==================== VERIFICATION ====================

export const verifyIFSC = (ifsc: string): Promise<{ valid: boolean; bank?: string; branch?: string; city?: string; state?: string }> => {
  return fetchAPI(`/verify/ifsc/${ifsc}`, undefined, true);
};

export const verifyPincode = (pincode: string): Promise<{ valid: boolean; city?: string; state?: string }> => {
  return fetchAPI(`/verify/pincode/${pincode}`, undefined, true);
};

export const verifyPAN = (pan: string): Promise<{ valid: boolean; holderType?: string; message?: string }> => {
  return fetchAPI('/verify/pan', { method: 'POST', body: JSON.stringify({ pan }) }, true);
};

export const verifyGST = (gst: string): Promise<{ valid: boolean; state?: string; panInGst?: string; message?: string }> => {
  return fetchAPI('/verify/gst', { method: 'POST', body: JSON.stringify({ gst }) }, true);
};

export const verifyFSSAI = (fssai: string): Promise<{ valid: boolean; state?: string; licenseType?: string; message?: string }> => {
  return fetchAPI('/verify/fssai', { method: 'POST', body: JSON.stringify({ fssai }) }, true);
};

// ==================== SUPER ADMIN ====================

const superAdminFetch = async <T>(endpoint: string, options?: RequestInit): Promise<T> => {
  const baseUrl = await getBaseUrl();
  try {
    const response = await fetch(`${baseUrl}${endpoint}`, {
      headers: {
        'Content-Type': 'application/json',
        'x-super-admin-id': superAdminCredentials.id,
        'x-super-admin-pass': superAdminCredentials.pass,
      },
      ...options,
    });
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Request failed');
    }
    return response.json();
  } catch (error: any) {
    if (error.message === 'Network request failed') throw new Error('Server unreachable.');
    throw error;
  }
};

export const superAdminLogin = (userId: string, password: string): Promise<{ success: boolean }> => {
  return fetchAPI('/superadmin/login', { method: 'POST', body: JSON.stringify({ userId, password }) }, true);
};

// ── Super Admin Dashboard DTOs ────────────────────────────────────────────────

export interface SADashboard {
  hotelStats: {
    total: number; pending: number; trial: number;
    active: number; expired: number; suspended: number; rejected: number;
  };
  devices: { total: number; online: number };
  todayRevenue: number;
  monthlyRevenue: number;
  churnRisk: number;
  openTickets: number;
  latestRegistrations: {
    _id: string; hotelName: string; ownerName: string;
    phone: string; city: string; state: string;
    status: string; subscriptionType: string; createdAt: string;
  }[];
  pendingRenewals: {
    _id: string; hotelName: string; ownerName: string; phone: string;
    status: string; subscriptionType: string;
    trialEndDate?: string; subscriptionEndDate?: string;
  }[];
  recentTickets: {
    _id: string; hotelName: string; hotelPhone: string;
    subject: string; category: string; priority: string;
    status: string; createdAt: string;
  }[];
  systemHealth: {
    mongo: string; redis: string; api: string;
    memory: { usedMB: number; totalMB: number; rssMB: number; percentage: number };
    uptimeSeconds: number; loadAvg: number;
  };
  appVersions: {
    latestVersion: string; forceUpdateEnabled: boolean;
    totalDevices: number; outdatedDeviceCount: number;
    distribution: { version: string; count: number; percentage: number; isLatest: boolean }[];
  };
  generatedAt: string;
}

export interface SASubscriptionRevenue {
  mrr: number;
  arr: number;
  expectedRenewalRevenue: number;
  renewingCount: number;
  breakdown: { plan: string; count: number; monthlyPrice: number; contribution: number }[];
  recentSubscriptions: { _id: string; plan: string; amount: number; status: string; createdAt: string }[];
}

export interface SAHotelGrowth {
  period: string;
  totalInPeriod: number;
  data: { _id: Record<string, number>; total: number; approved: number; trial: number; active: number }[];
}

export interface SAFailedPayments {
  pending: number; failed: number; overdue: number; total: number;
  recent: { _id: string; plan: string; amount: number; status: string; updatedAt: string }[];
}

export interface SADeviceLicensing {
  total: number; active: number; blocked: number;
  byPlan: { plan: string; allowedPerHotel: number; hotelCount: number; totalAllowed: number; activeDevices: number }[];
}

export interface SATopHotel {
  hotelId: string; hotelName: string; city: string; plan: string;
  value?: number; lastSeen?: string; deviceCount?: number;
}

export interface SATopHotels {
  by: string; period: string; hotels: SATopHotel[];
}

// ── Super Admin Dashboard API calls ──────────────────────────────────────────

export const getSADashboard = (): Promise<SADashboard> =>
  superAdminFetch('/superadmin/dashboard');

export const getSASubscriptionRevenue = (): Promise<SASubscriptionRevenue> =>
  superAdminFetch('/superadmin/dashboard/subscription-revenue');

export const getSAHotelGrowth = (period: '7d' | '30d' | '12m' = '30d'): Promise<SAHotelGrowth> =>
  superAdminFetch(`/superadmin/dashboard/hotel-growth?period=${period}`);

export const getSAFailedPayments = (): Promise<SAFailedPayments> =>
  superAdminFetch('/superadmin/dashboard/failed-payments');

export const getSADeviceLicensing = (): Promise<SADeviceLicensing> =>
  superAdminFetch('/superadmin/dashboard/device-licensing');

export const getSATopHotels = (
  by: 'revenue' | 'orders' | 'activity' = 'revenue',
  period: 'today' | 'week' | 'month' = 'today',
  limit = 10,
): Promise<SATopHotels> =>
  superAdminFetch(`/superadmin/dashboard/top-hotels?by=${by}&period=${period}&limit=${limit}`);

export const getSuperAdminStats = (): Promise<SuperAdminStats> => {
  return superAdminFetch('/superadmin/stats');
};

export const getAllHotels = (
  status?: string,
  search?: string,
  page: number = 1,
  limit: number = 50,
): Promise<{ hotels: Hotel[]; total: number; page: number; pages: number }> => {
  const params = new URLSearchParams();
  if (status) params.set('status', status);
  if (search) params.set('search', search);
  params.set('page', String(page));
  params.set('limit', String(limit));
  return superAdminFetch(`/superadmin/hotels?${params.toString()}`);
};

export const getHotelDetail = (id: string): Promise<Hotel> => {
  return superAdminFetch(`/superadmin/hotels/${id}`);
};

export const approveHotelWithCredentials = (
  id: string,
  adminId: string,
  password: string
): Promise<{ message: string }> => {
  return superAdminFetch(`/superadmin/hotels/${id}/credentials`, {
    method: 'PUT',
    body: JSON.stringify({ adminId, password }),
  });
};

export const approveHotel = (
  id: string,
  trialDays: number = 14,
  features?: Partial<FeatureFlags>
): Promise<{
  message: string;
  hotel: Hotel;
  credentials: { adminId: string; password: string; kitchenPin: string };
  emailPayload: Record<string, string>;
  whatsappPayload: Record<string, string>;
}> => {
  return superAdminFetch(`/superadmin/hotels/${id}/approve`, {
    method: 'PUT',
    body: JSON.stringify({ trialDays, features }),
  });
};

export const rejectHotel = (id: string, reason: string): Promise<{ message: string }> => {
  return superAdminFetch(`/superadmin/hotels/${id}/reject`, { method: 'PUT', body: JSON.stringify({ reason }) });
};

export const suspendHotel = (id: string): Promise<{ message: string }> => {
  return superAdminFetch(`/superadmin/hotels/${id}/suspend`, { method: 'PUT' });
};

export const activateHotel = (id: string): Promise<{ message: string }> => {
  return superAdminFetch(`/superadmin/hotels/${id}/activate`, { method: 'PUT' });
};

export const setHotelPremium = (
  id: string,
  isPremium: boolean,
  premiumPlan?: string,
  premiumExpiry?: string | null,
  trialDays?: number,
): Promise<{ message: string }> => {
  return superAdminFetch(`/superadmin/hotels/${id}/premium`, {
    method: 'PUT',
    body: JSON.stringify({ isPremium, premiumPlan, premiumExpiry, trialDays }),
  });
};

// ==================== SUPPORT TICKETS ====================

export interface Ticket {
  _id: string;
  hotelName: string;
  hotelPhone: string;
  subject: string;
  description: string;
  category: 'technical' | 'billing' | 'account' | 'other';
  priority: 'low' | 'medium' | 'high';
  status: 'open' | 'in-progress' | 'resolved' | 'closed';
  replies: { message: string; by: 'hotel' | 'superadmin'; createdAt: string }[];
  createdAt: string;
}

export const raiseTicket = (data: Partial<Ticket>): Promise<Ticket> => {
  return fetchAPI('/tickets', { method: 'POST', body: JSON.stringify(data) }, true);
};

export const getMyTickets = (phone: string): Promise<Ticket[]> => {
  return fetchAPI(`/tickets/hotel/${phone}`, undefined, true);
};

export const replyToTicket = (id: string, message: string): Promise<Ticket> => {
  return fetchAPI(`/tickets/${id}/reply`, { method: 'POST', body: JSON.stringify({ message }) }, true);
};

export const getAllTickets = (status?: string): Promise<Ticket[]> => {
  const q = status && status !== 'all' ? `?status=${status}` : '';
  return superAdminFetch(`/tickets${q}`);
};

export const adminReplyTicket = (id: string, message: string): Promise<Ticket> => {
  return superAdminFetch(`/tickets/${id}/admin-reply`, { method: 'POST', body: JSON.stringify({ message }) });
};

export const updateTicketStatus = (id: string, status: string): Promise<Ticket> => {
  return superAdminFetch(`/tickets/${id}/status`, { method: 'PUT', body: JSON.stringify({ status }) });
};

// ==================== MULTI-BRANCH DASHBOARD ====================

export const getBranchRevenue = (date?: string): Promise<{
  date: string;
  totalRevenue: number;
  totalOrders: number;
  branches: { hotelId: string; hotelName: string; city: string; revenue: number; orders: number; avgOrder: number }[];
}> => {
  const q = date ? `?date=${date}` : '';
  return superAdminFetch(`/superadmin/branch-revenue${q}`);
};

// ==================== TABLES ====================

export const getTables = (): Promise<Table[]> =>
  fetchAPI<Table[]>('/tables');

export const createTable = (data: Partial<Table>): Promise<Table> =>
  fetchAPI<Table>('/tables', { method: 'POST', body: JSON.stringify(data) });

export const updateTable = (id: string, data: Partial<Table>): Promise<Table> =>
  fetchAPI<Table>(`/tables/${id}`, { method: 'PUT', body: JSON.stringify(data) });

export const updateTableStatus = (id: string, status: Table['status'], currentOrderId?: string): Promise<Table> =>
  fetchAPI<Table>(`/tables/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status, currentOrderId }) });

export const deleteTable = (id: string): Promise<void> =>
  fetchAPI(`/tables/${id}`, { method: 'DELETE' });

// ==================== RESERVATIONS ====================

export const getReservations = (date?: string): Promise<Reservation[]> => {
  const q = date ? `?date=${date}` : '';
  return fetchAPI<Reservation[]>(`/reservations${q}`);
};

export const createReservation = (data: Partial<Reservation>): Promise<Reservation> =>
  fetchAPI<Reservation>('/reservations', { method: 'POST', body: JSON.stringify(data) });

export const updateReservation = (id: string, data: Partial<Reservation>): Promise<Reservation> =>
  fetchAPI<Reservation>(`/reservations/${id}`, { method: 'PUT', body: JSON.stringify(data) });

export const updateReservationStatus = (id: string, status: Reservation['status']): Promise<Reservation> =>
  fetchAPI<Reservation>(`/reservations/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) });

export const deleteReservation = (id: string): Promise<void> =>
  fetchAPI(`/reservations/${id}`, { method: 'DELETE' });

// ==================== EXPENSES ====================

export const getExpenses = (params?: { date?: string; from?: string; to?: string }): Promise<Expense[]> => {
  const q = params ? '?' + new URLSearchParams(params as any).toString() : '';
  return fetchAPI<Expense[]>(`/expenses${q}`);
};

export const getPnLReport = (date?: string): Promise<PnLReport> => {
  const q = date ? `?date=${date}` : '';
  return fetchAPI<PnLReport>(`/expenses/pnl${q}`);
};

export const createExpense = (data: Partial<Expense>): Promise<Expense> =>
  fetchAPI<Expense>('/expenses', { method: 'POST', body: JSON.stringify(data) });

export const updateExpense = (id: string, data: Partial<Expense>): Promise<Expense> =>
  fetchAPI<Expense>(`/expenses/${id}`, { method: 'PUT', body: JSON.stringify(data) });

export const deleteExpense = (id: string): Promise<void> =>
  fetchAPI(`/expenses/${id}`, { method: 'DELETE' });

// ==================== WASTE LOGS ====================

export const getWasteLogs = (date?: string): Promise<WasteLog[]> => {
  const q = date ? `?date=${date}` : '';
  return fetchAPI<WasteLog[]>(`/waste${q}`);
};

export const getWasteAnalytics = (date?: string): Promise<{
  date: string; totalLoss: number; totalEntries: number;
  topItems: { productName: string; totalQty: number; totalLoss: number }[];
  byReason: { _id: string; count: number; totalLoss: number }[];
}> => {
  const q = date ? `?date=${date}` : '';
  return fetchAPI(`/waste/analytics${q}`);
};

export const createWasteLog = (data: Partial<WasteLog>): Promise<WasteLog> =>
  fetchAPI<WasteLog>('/waste', { method: 'POST', body: JSON.stringify(data) });

export const deleteWasteLog = (id: string): Promise<void> =>
  fetchAPI(`/waste/${id}`, { method: 'DELETE' });

// ==================== INGREDIENTS (Raw Material Inventory) ====================

export const getIngredients = (): Promise<Ingredient[]> =>
  fetchAPI<Ingredient[]>('/ingredients');

export const getLowStockIngredients = (): Promise<{ ingredients: Ingredient[] }> =>
  fetchAPI('/ingredients/alerts/low-stock');

export const createIngredient = (data: Partial<Ingredient>): Promise<Ingredient> =>
  fetchAPI<Ingredient>('/ingredients', { method: 'POST', body: JSON.stringify(data) });

export const updateIngredient = (id: string, data: Partial<Ingredient>): Promise<Ingredient> =>
  fetchAPI<Ingredient>(`/ingredients/${id}`, { method: 'PUT', body: JSON.stringify(data) });

export const restockIngredient = (id: string, quantity: number): Promise<Ingredient> =>
  fetchAPI<Ingredient>(`/ingredients/${id}/restock`, { method: 'PATCH', body: JSON.stringify({ quantity }) });

export const deleteIngredient = (id: string): Promise<void> =>
  fetchAPI(`/ingredients/${id}`, { method: 'DELETE' });

// ==================== REMOTE CONFIG ====================

export const getRemoteConfig = (): Promise<RemoteConfig> =>
  fetchAPI<RemoteConfig>('/remote-config', undefined, true);

// ==================== DEVICES ====================

export const registerDevice = (data: {
  deviceId: string;
  deviceName: string;
  platform: 'android' | 'ios' | 'web';
  appVersion: string;
  osVersion: string;
  pushToken?: string;
  refreshToken?: string;
  rememberDevice?: boolean;
  adminId?: string;
}): Promise<{ message: string; device: Device }> =>
  fetchAPI('/devices/register', { method: 'POST', body: JSON.stringify(data) });

export const deviceHeartbeat = (deviceId: string, appVersion?: string): Promise<{ ok: boolean }> =>
  fetchAPI('/devices/heartbeat', { method: 'POST', body: JSON.stringify({ deviceId, appVersion }) });

export const getMyDevices = (): Promise<Device[]> =>
  fetchAPI<Device[]>('/devices');

export const logoutDevice = (deviceId: string): Promise<{ ok: boolean }> =>
  fetchAPI(`/devices/${deviceId}/logout`, { method: 'PATCH' });

export const logoutAllDevices = (): Promise<{ ok: boolean }> =>
  fetchAPI('/devices/logout-all', { method: 'DELETE' });

export const deleteDevice = (deviceId: string): Promise<{ ok: boolean }> =>
  fetchAPI(`/devices/${deviceId}`, { method: 'DELETE' });

// ==================== NOTIFICATIONS ====================

export const getNotifications = (): Promise<{ notifications: AppNotification[]; unreadCount: number }> =>
  fetchAPI('/notifications');

export const markNotificationRead = (id: string): Promise<{ ok: boolean }> =>
  fetchAPI(`/notifications/${id}/read`, { method: 'PUT' });

export const markAllNotificationsRead = (): Promise<{ ok: boolean }> =>
  fetchAPI('/notifications/read-all', { method: 'PUT' });

// ==================== SUPER ADMIN — SAAS FEATURES ====================

export const expireHotel = (id: string): Promise<{ message: string }> =>
  superAdminFetch(`/superadmin/hotels/${id}/expire`, { method: 'PUT' });

export const startHotelTrial = (id: string, days?: number): Promise<{ message: string; hotel: Hotel }> =>
  superAdminFetch(`/superadmin/hotels/${id}/trial`, { method: 'PUT', body: JSON.stringify({ days }) });

export const extendHotelTrial = (id: string, days: number): Promise<{ message: string; hotel: Hotel }> =>
  superAdminFetch(`/superadmin/hotels/${id}/trial`, { method: 'PUT', body: JSON.stringify({ days, extend: true }) });

export const extendTrialDays = (id: string, days: number): Promise<{ message: string; hotel: Hotel }> =>
  superAdminFetch(`/superadmin/hotels/${id}/extend-trial`, { method: 'PUT', body: JSON.stringify({ days }) });

export const convertToPaidPlan = (
  id: string,
  plan: 'starter' | 'professional' | 'enterprise',
  durationDays: number,
): Promise<{ message: string; hotel: Hotel }> =>
  superAdminFetch(`/superadmin/hotels/${id}/plan`, { method: 'PUT', body: JSON.stringify({ plan, durationDays }) });

export const updateHotelFeatures = (id: string, features: Partial<FeatureFlags>): Promise<{ message: string; features: FeatureFlags }> =>
  superAdminFetch(`/superadmin/hotels/${id}/features`, { method: 'PUT', body: JSON.stringify({ features }) });

export const getUsageAnalytics = (): Promise<{
  hotels: {
    hotelId: string;
    hotelName: string;
    ordersToday: number;
    revenueToday: number;
    deviceCount: number;
    appVersions: string[];
    lastActivity: string | null;
  }[];
}> => superAdminFetch('/superadmin/analytics');

export const getAllDevices = (hotelId?: string): Promise<Device[]> => {
  const q = hotelId ? `?hotelId=${hotelId}` : '';
  return superAdminFetch(`/superadmin/devices${q}`);
};

export const getBroadcastNotifications = (): Promise<AppNotification[]> =>
  superAdminFetch('/superadmin/notifications');

export const createBroadcastNotification = (data: {
  title: string;
  message: string;
  type?: AppNotification['type'];
  targetHotels?: string[];
  expiresAt?: string | null;
}): Promise<{ message: string; notification: AppNotification }> =>
  superAdminFetch('/superadmin/notifications', { method: 'POST', body: JSON.stringify(data) });

export const deleteBroadcastNotification = (id: string): Promise<{ message: string }> =>
  superAdminFetch(`/superadmin/notifications/${id}`, { method: 'DELETE' });

export const getRemoteConfigAdmin = (): Promise<RemoteConfig> =>
  superAdminFetch('/superadmin/remote-config');

export const updateRemoteConfig = (data: Partial<RemoteConfig>): Promise<{ message: string; config: RemoteConfig }> =>
  superAdminFetch('/superadmin/remote-config', { method: 'PUT', body: JSON.stringify(data) });

export const getSystemHealth = (): Promise<{
  mongo: { state: number; stateLabel: string };
  totalDevices: number;
  onlineDevices: number;
  timestamp: string;
}> => superAdminFetch('/superadmin/health');

// ==================== KITCHEN DISPLAY ====================

const KITCHEN_TOKEN_KEY = '@hotel_pos_kitchen_token';
let _cachedKitchenToken: string | null = null;

export const saveKitchenToken = async (token: string): Promise<void> => {
  _cachedKitchenToken = token;
  await AsyncStorage.setItem(KITCHEN_TOKEN_KEY, token);
};

export const getKitchenToken = async (): Promise<string | null> => {
  if (_cachedKitchenToken) return _cachedKitchenToken;
  try { _cachedKitchenToken = await AsyncStorage.getItem(KITCHEN_TOKEN_KEY); } catch { _cachedKitchenToken = null; }
  return _cachedKitchenToken;
};

export const clearKitchenToken = async (): Promise<void> => {
  _cachedKitchenToken = null;
  await AsyncStorage.removeItem(KITCHEN_TOKEN_KEY);
};

export const kitchenLogin = async (hotelId: string, pin: string): Promise<string> => {
  const base = await getBaseUrl();
  const res = await fetch(`${base}/auth/kitchen`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ hotelId, pin }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || 'Login failed');
  // Persist hotelId so display screens can join the correct socket room
  // even on dedicated devices where admin never logged in
  await AsyncStorage.setItem(HOTEL_ID_STORAGE_KEY, hotelId);
  return data.token;
};

export interface KitchenOrderItem { productName: string; quantity: number }
export interface KitchenOrder {
  _id: string;
  orderNumber: string;
  tableNumber: string;
  customerName: string;
  notes: string;
  status: 'pending' | 'preparing';
  isParcel: boolean;
  createdAt: string;
  items: KitchenOrderItem[];
}

export const getKitchenOrders = async (): Promise<KitchenOrder[]> => {
  const [base, token] = await Promise.all([getBaseUrl(), getKitchenToken()]);
  const res = await fetch(`${base}/orders/kitchen`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error((data as any).message || 'Failed to fetch kitchen orders');
  }
  return res.json();
};

export const updateKitchenOrderStatus = async (orderId: string, status: string): Promise<void> => {
  const [base, token] = await Promise.all([getBaseUrl(), getKitchenToken()]);
  const res = await fetch(`${base}/orders/${orderId}/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ status }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error((data as any).message || 'Failed to update order');
  }
};

// ==================== WAITER DISPLAY ====================

const WAITER_TOKEN_KEY = '@hotel_pos_waiter_token';
let _cachedWaiterToken: string | null = null;

export const saveWaiterToken = async (token: string): Promise<void> => {
  _cachedWaiterToken = token;
  await AsyncStorage.setItem(WAITER_TOKEN_KEY, token);
};

export const getWaiterToken = async (): Promise<string | null> => {
  if (_cachedWaiterToken) return _cachedWaiterToken;
  try { _cachedWaiterToken = await AsyncStorage.getItem(WAITER_TOKEN_KEY); } catch { _cachedWaiterToken = null; }
  return _cachedWaiterToken;
};

export const clearWaiterToken = async (): Promise<void> => {
  _cachedWaiterToken = null;
  await AsyncStorage.removeItem(WAITER_TOKEN_KEY);
};

export const waiterLogin = async (hotelId: string, employeeCode: string, pin: string): Promise<{ token: string; waiter: { _id: string; name: string; employeeCode: string; mobile: string } }> => {
  const base = await getBaseUrl();
  const res = await fetch(`${base}/auth/waiter`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ hotelId, employeeCode, pin }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error((data as any).message || 'Login failed');
  // Persist hotelId so display screens can join the correct socket room
  await AsyncStorage.setItem(HOTEL_ID_STORAGE_KEY, hotelId);
  return data;
};

export interface WaiterProfile {
  _id: string;
  name: string;
  employeeCode: string;
  mobile: string;
  isActive: boolean;
  createdAt: string;
}

export const getWaiters = async (): Promise<WaiterProfile[]> => {
  const [base, token] = await Promise.all([getBaseUrl(), getToken()]);
  const res = await fetch(`${base}/waiters`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error('Failed to fetch waiters');
  return res.json();
};

export const addWaiter = async (payload: { name: string; employeeCode: string; pin: string; mobile?: string }): Promise<WaiterProfile> => {
  const [base, token] = await Promise.all([getBaseUrl(), getToken()]);
  const res = await fetch(`${base}/waiters`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) throw new Error((data as any).message || 'Failed to add waiter');
  return data;
};

export const updateWaiter = async (id: string, payload: { name?: string; mobile?: string; employeeCode?: string }): Promise<WaiterProfile> => {
  const [base, token] = await Promise.all([getBaseUrl(), getToken()]);
  const res = await fetch(`${base}/waiters/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) throw new Error((data as any).message || 'Failed to update waiter');
  return data;
};

export const resetWaiterPin = async (id: string, pin: string): Promise<void> => {
  const [base, token] = await Promise.all([getBaseUrl(), getToken()]);
  const res = await fetch(`${base}/waiters/${id}/pin`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ pin }),
  });
  if (!res.ok) throw new Error('Failed to reset PIN');
};

export const toggleWaiter = async (id: string): Promise<{ isActive: boolean }> => {
  const [base, token] = await Promise.all([getBaseUrl(), getToken()]);
  const res = await fetch(`${base}/waiters/${id}/toggle`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error('Failed to toggle waiter');
  return res.json();
};

export const deleteWaiter = async (id: string): Promise<void> => {
  const [base, token] = await Promise.all([getBaseUrl(), getToken()]);
  const res = await fetch(`${base}/waiters/${id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error('Failed to delete waiter');
};

export interface WaiterOrderItem { productName: string; quantity: number }
export interface WaiterOrder {
  _id: string;
  orderNumber: string;
  tableNumber: string;
  customerName: string;
  notes: string;
  status: 'ready';
  isParcel: boolean;
  createdAt: string;
  items: WaiterOrderItem[];
}

export const getWaiterOrders = async (): Promise<WaiterOrder[]> => {
  const [base, token] = await Promise.all([getBaseUrl(), getWaiterToken()]);
  const res = await fetch(`${base}/orders/waiter`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error('Failed to fetch waiter orders');
  return res.json();
};

export const markOrderServed = async (orderId: string): Promise<void> => {
  const [base, token] = await Promise.all([getBaseUrl(), getWaiterToken()]);
  const res = await fetch(`${base}/orders/${orderId}/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ status: 'served' }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error((data as any).message || 'Failed to mark served');
  }
};

// ==================== CASHIER DISPLAY ====================

const CASHIER_TOKEN_KEY = '@hotel_pos_cashier_token';
let _cachedCashierToken: string | null = null;

export const saveCashierToken = async (token: string): Promise<void> => {
  _cachedCashierToken = token;
  await AsyncStorage.setItem(CASHIER_TOKEN_KEY, token);
};

export const getCashierToken = async (): Promise<string | null> => {
  if (_cachedCashierToken) return _cachedCashierToken;
  try { _cachedCashierToken = await AsyncStorage.getItem(CASHIER_TOKEN_KEY); } catch { _cachedCashierToken = null; }
  return _cachedCashierToken;
};

export const clearCashierToken = async (): Promise<void> => {
  _cachedCashierToken = null;
  await AsyncStorage.removeItem(CASHIER_TOKEN_KEY);
};

export const cashierLogin = async (hotelId: string, employeeCode: string, pin: string): Promise<{ token: string; cashier: { _id: string; name: string; employeeCode: string; mobile: string } }> => {
  const base = await getBaseUrl();
  const res = await fetch(`${base}/auth/cashier`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ hotelId, employeeCode, pin }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || 'Login failed');
  // Persist hotelId so display screens can join the correct socket room
  await AsyncStorage.setItem(HOTEL_ID_STORAGE_KEY, hotelId);
  return data;
};

export interface CashierProfile {
  _id: string;
  name: string;
  employeeCode: string;
  mobile: string;
  isActive: boolean;
  createdAt: string;
}

export const getCashiers = async (): Promise<CashierProfile[]> => {
  const [base, token] = await Promise.all([getBaseUrl(), getToken()]);
  const res = await fetch(`${base}/cashiers`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error('Failed to load cashiers');
  return res.json();
};

export const addCashier = async (payload: { name: string; employeeCode: string; pin: string; mobile?: string }): Promise<CashierProfile> => {
  const [base, token] = await Promise.all([getBaseUrl(), getToken()]);
  const res = await fetch(`${base}/cashiers`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || 'Failed to add cashier');
  return data;
};

export const updateCashier = async (id: string, payload: { name?: string; mobile?: string; employeeCode?: string }): Promise<CashierProfile> => {
  const [base, token] = await Promise.all([getBaseUrl(), getToken()]);
  const res = await fetch(`${base}/cashiers/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || 'Failed to update cashier');
  return data;
};

export const resetCashierPin = async (id: string, pin: string): Promise<void> => {
  const [base, token] = await Promise.all([getBaseUrl(), getToken()]);
  const res = await fetch(`${base}/cashiers/${id}/pin`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ pin }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error((data as any).message || 'Failed to reset PIN');
  }
};

export const toggleCashier = async (id: string): Promise<{ isActive: boolean }> => {
  const [base, token] = await Promise.all([getBaseUrl(), getToken()]);
  const res = await fetch(`${base}/cashiers/${id}/toggle`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || 'Failed to toggle cashier');
  return data;
};

export const deleteCashier = async (id: string): Promise<void> => {
  const [base, token] = await Promise.all([getBaseUrl(), getToken()]);
  const res = await fetch(`${base}/cashiers/${id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error((data as any).message || 'Failed to delete cashier');
  }
};

export interface CashierOrderItem { productName: string; quantity: number; price: number; total: number }
export interface CashierOrder {
  _id: string;
  orderNumber: string;
  tableNumber: string;
  customerName: string;
  notes: string;
  status: 'pending' | 'preparing' | 'ready' | 'served' | 'completed';
  paymentMethod: 'cash' | 'upi' | 'card' | 'split';
  grandTotal: number;
  subtotal: number;
  taxTotal: number;
  discountAmount: number;
  orderSource: string;
  isParcel: boolean;
  createdAt: string;
  completedBy: string;
  completedAt: string | null;
  cashierId: string;
  items: CashierOrderItem[];
}

export const getCashierOrders = async (): Promise<CashierOrder[]> => {
  const [base, token] = await Promise.all([getBaseUrl(), getCashierToken()]);
  const res = await fetch(`${base}/orders/cashier`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error('Failed to load orders');
  return res.json();
};

export const completeOrderPayment = async (orderId: string, paymentMethod: 'cash' | 'upi' | 'card'): Promise<void> => {
  const [base, token] = await Promise.all([getBaseUrl(), getCashierToken()]);
  const res = await fetch(`${base}/orders/${orderId}/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ status: 'completed', paymentMethod }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error((data as any).message || 'Failed to complete order');
  }
};

// ── Customer menu cache ────────────────────────────────────────────────────────
const MENU_CACHE_TTL = 60 * 60 * 1000; // 1 hour
export const MENU_CACHE_KEY = (hotelId: string) => `@customer_menu_${hotelId}`;

export const saveMenuCache = async (hotelId: string, categories: Category[], products: Product[]): Promise<void> => {
  await AsyncStorage.setItem(MENU_CACHE_KEY(hotelId), JSON.stringify({ categories, products, cachedAt: Date.now() }));
};

export const loadMenuCache = async (hotelId: string): Promise<{ categories: Category[]; products: Product[] } | null> => {
  const raw = await AsyncStorage.getItem(MENU_CACHE_KEY(hotelId));
  if (!raw) return null;
  const { categories, products, cachedAt } = JSON.parse(raw);
  if (Date.now() - cachedAt > MENU_CACHE_TTL) return null; // stale
  return { categories, products };
};

// ── Customer order queue (offline orders waiting to sync) ─────────────────────
const CUSTOMER_ORDER_QUEUE_KEY = '@customer_order_queue';

export interface QueuedCustomerOrder {
  id: string;
  hotelId: string;
  localToken: string;
  orderData: Parameters<typeof createPublicOrder>[0];
  queuedAt: number;
}

export const enqueueCustomerOrder = async (
  hotelId: string,
  localToken: string,
  orderData: Parameters<typeof createPublicOrder>[0],
): Promise<string> => {
  const id = `local_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const existing: QueuedCustomerOrder[] = JSON.parse(
    await AsyncStorage.getItem(CUSTOMER_ORDER_QUEUE_KEY) || '[]'
  );
  await AsyncStorage.setItem(
    CUSTOMER_ORDER_QUEUE_KEY,
    JSON.stringify([...existing, { id, hotelId, localToken, orderData, queuedAt: Date.now() }])
  );
  return id;
};

export const flushCustomerOrderQueue = async (): Promise<void> => {
  const raw = await AsyncStorage.getItem(CUSTOMER_ORDER_QUEUE_KEY);
  if (!raw) return;
  const queue: QueuedCustomerOrder[] = JSON.parse(raw);
  if (queue.length === 0) return;

  const remaining: QueuedCustomerOrder[] = [];
  for (const entry of queue) {
    try {
      await createPublicOrder(entry.orderData);
      // Success — server emits new_order socket → kitchen/admin notified automatically
    } catch {
      remaining.push(entry); // keep for next retry
    }
  }
  await AsyncStorage.setItem(CUSTOMER_ORDER_QUEUE_KEY, JSON.stringify(remaining));
};
