declare module 'react-native-razorpay' {
  export interface RazorpayOptions {
    key: string;
    amount: string;
    currency?: string;
    name?: string;
    description?: string;
    order_id?: string;
    prefill?: {
      name?: string;
      email?: string;
      contact?: string;
    };
    theme?: {
      color?: string;
    };
    [key: string]: unknown;
  }

  export interface RazorpaySuccessResponse {
    razorpay_payment_id: string;
    razorpay_order_id?: string;
    razorpay_signature?: string;
  }

  export interface RazorpayErrorResponse {
    code: string;
    description: string;
    [key: string]: unknown;
  }

  const RazorpayCheckout: {
    open(options: RazorpayOptions): Promise<RazorpaySuccessResponse>;
  };

  export default RazorpayCheckout;
}
