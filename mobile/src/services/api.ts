import AsyncStorage from '@react-native-async-storage/async-storage';
import { API_BASE_URL } from '../utils/constants';
import { Category, Product, Order, Settings, DailyReport, Hotel, SuperAdminStats, Table, Reservation, Expense, WasteLog, PnLReport, Customer, Ingredient, GSTReport, TallyReport, GSTR1Json } from '../types';

const API_URL_STORAGE_KEY = '@hotel_pos_api_base_url';
const JWT_STORAGE_KEY = '@hotel_pos_jwt_token';
const HOTEL_ID_STORAGE_KEY = '@hotel_pos_hotel_id';

let _cachedBaseUrl: string | null = null;
let _cachedToken: string | null = null;

const getBaseUrl = async (): Promise<string> => {
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

// ── Generic fetch wrapper ────────────────────────────────────────────────────

const fetchAPI = async <T>(
  endpoint: string,
  options?: RequestInit,
  skipAuth = false,
  retries = 2
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
        // Don't retry client errors (4xx)
        if (response.status < 500) throw new Error(errBody.message || 'Request failed');
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
): Promise<{ success: boolean; token: string; hotelId: string; hotelName: string }> => {
  const result = await fetchAPI<{ success: boolean; token: string; hotelId: string; hotelName: string }>(
    '/auth/login',
    { method: 'POST', body: JSON.stringify({ userId, password }) },
    true // skip auth header on login
  );
  if (result.token) {
    await saveToken(result.token);
  }
  if (result.hotelId) {
    await AsyncStorage.setItem(HOTEL_ID_STORAGE_KEY, result.hotelId);
  }
  return result;
};

export const logout = async (): Promise<void> => {
  await clearToken();
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

export const getSuperAdminStats = (): Promise<SuperAdminStats> => {
  return superAdminFetch('/superadmin/stats');
};

export const getAllHotels = (status?: string, search?: string): Promise<Hotel[]> => {
  const params = new URLSearchParams();
  if (status) params.set('status', status);
  if (search) params.set('search', search);
  const query = params.toString() ? `?${params.toString()}` : '';
  return superAdminFetch(`/superadmin/hotels${query}`);
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

export const approveHotel = (id: string): Promise<{ message: string }> => {
  return superAdminFetch(`/superadmin/hotels/${id}/approve`, { method: 'PUT' });
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
