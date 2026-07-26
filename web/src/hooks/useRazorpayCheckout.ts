import { useState, useCallback } from 'react';
import { loadRazorpayScript, type RazorpaySuccessResponse } from '../utils/razorpay';
import { createPaymentIntent, verifyPaymentIntent } from '../api/payments';

export interface RazorpayCheckoutParams {
  orderId:        string;
  amount:         number;         // rupees
  currency?:      string;
  description?:   string;
  hotelName?:     string;
  customerName?:  string;
  customerEmail?: string;
  customerPhone?: string;
}

export interface RazorpayCheckoutResult {
  success:               boolean;
  internalTransactionId: string;
  gatewayTransactionId?: string;
  message?:              string;
}

export function useRazorpayCheckout() {
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState<string | null>(null);

  const openCheckout = useCallback(async (params: RazorpayCheckoutParams): Promise<RazorpayCheckoutResult> => {
    setLoading(true);
    setError(null);

    try {
      // Step 1 — Create payment intent (Razorpay order) on backend
      const intentRes = await createPaymentIntent(params.orderId, params.amount, {
        currency:      params.currency      ?? 'INR',
        description:   params.description,
        customerName:  params.customerName,
        customerEmail: params.customerEmail,
        customerPhone: params.customerPhone,
      });

      const { payment, gatewayData, gatewayError, gatewayIntegrated } = intentRes;

      if (!gatewayIntegrated) {
        throw new Error(gatewayError ?? 'No payment gateway integrated. Configure one in Payment Settings.');
      }
      if (gatewayError) {
        throw new Error(gatewayError);
      }

      const keyId          = gatewayData?.metadata?.keyId;
      const razorpayOrder  = gatewayData?.metadata?.orderId ?? gatewayData?.gatewayOrderId;
      const amountPaise    = gatewayData?.metadata?.amount ?? Math.round(params.amount * 100);

      if (!keyId || !razorpayOrder) {
        throw new Error('Gateway did not return required checkout parameters (keyId / orderId).');
      }

      // Step 2 — Dynamically load Razorpay Checkout.js (cached on second call)
      await loadRazorpayScript();

      // Step 3 — Open modal; resolve/reject on handler or modal dismiss
      const result = await new Promise<RazorpayCheckoutResult>((resolve, reject) => {
        const rzp = new window.Razorpay({
          key:         keyId,
          amount:      amountPaise,
          currency:    params.currency ?? 'INR',
          name:        params.hotelName ?? 'Hotel POS',
          description: params.description ?? 'Bill Payment',
          order_id:    razorpayOrder,
          prefill: {
            name:    params.customerName,
            email:   params.customerEmail,
            contact: params.customerPhone,
          },
          theme: { color: '#2563eb' },
          handler: (response: RazorpaySuccessResponse) => {
            // Step 4 — Verify signature on backend
            verifyPaymentIntent(
              payment.internalTransactionId,
              response.razorpay_payment_id,
              response.razorpay_signature,
            )
              .then(v => resolve({
                success:               v.verified,
                internalTransactionId: payment.internalTransactionId,
                gatewayTransactionId:  response.razorpay_payment_id,
                message:               v.message,
              }))
              .catch(reject);
          },
          modal: {
            ondismiss: () => resolve({
              success:               false,
              internalTransactionId: payment.internalTransactionId,
              message:               'Payment cancelled.',
            }),
          },
        });
        rzp.open();
      });

      return result;
    } catch (e) {
      const msg = (e as Error).message ?? 'Payment failed';
      setError(msg);
      return { success: false, internalTransactionId: '', message: msg };
    } finally {
      setLoading(false);
    }
  }, []);

  const clearError = useCallback(() => setError(null), []);

  return { openCheckout, loading, error, clearError };
}
