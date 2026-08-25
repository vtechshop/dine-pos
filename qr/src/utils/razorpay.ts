// Razorpay Checkout.js — loaded on demand (not at app startup)
// https://checkout.razorpay.com/v1/checkout.js

declare global {
  interface Window {
    Razorpay: new (options: RazorpayOptions) => RazorpayInstance;
  }
}

export interface RazorpayOptions {
  key:          string;
  amount:       number;         // paise
  currency:     string;
  name:         string;
  description?: string;
  order_id:     string;
  prefill?: {
    name?:    string;
    email?:   string;
    contact?: string;
  };
  notes?:   Record<string, string>;
  theme?:   { color?: string };
  handler:  (response: RazorpaySuccessResponse) => void;
  modal?: {
    ondismiss?: () => void;
  };
}

export interface RazorpaySuccessResponse {
  razorpay_payment_id: string;
  razorpay_order_id:   string;
  razorpay_signature:  string;
}

export interface RazorpayInstance {
  open(): void;
  close(): void;
}

const SCRIPT_ID  = 'razorpay-checkout-js';
const SCRIPT_SRC = 'https://checkout.razorpay.com/v1/checkout.js';

let loadPromise: Promise<void> | null = null;

export function loadRazorpayScript(): Promise<void> {
  if (loadPromise) return loadPromise;

  loadPromise = new Promise((resolve, reject) => {
    if (document.getElementById(SCRIPT_ID)) {
      resolve();
      return;
    }
    const script = document.createElement('script');
    script.id    = SCRIPT_ID;
    script.src   = SCRIPT_SRC;
    script.async = true;
    script.onload  = () => resolve();
    script.onerror = () => {
      loadPromise = null; // allow retry on next call
      reject(new Error('Failed to load Razorpay Checkout script. Check your internet connection.'));
    };
    document.head.appendChild(script);
  });

  return loadPromise;
}
