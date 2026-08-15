import { decrypt } from '../../utils/encryption';
import type { PaymentGateway, GatewayType, GatewayRuntimeConfig } from './types';
import type { IPaymentGatewayConfig } from '../../models/PaymentGatewayConfig';

type GatewayConstructor = new (config: GatewayRuntimeConfig) => PaymentGateway;

// ── Registry ───────────────────────────────────────────────────────────────────
// External gateway SDKs register themselves here via GatewayFactory.register().
// No provider is registered by default — they plug in when the SDK is added.

const registry = new Map<GatewayType, GatewayConstructor>();

const GatewayFactory = {
  // Called once per gateway SDK when its module loads.
  register(type: GatewayType, cls: GatewayConstructor): void {
    registry.set(type, cls);
  },

  // Create a live gateway instance from a stored DB config.
  // Decrypts secrets before passing to the constructor.
  // For OAuth-connected configs, decrypts oauthAccessTokenEnc and passes it as
  // oauthAccessToken; the gateway constructor uses it instead of key_id/key_secret.
  create(dbConfig: IPaymentGatewayConfig): PaymentGateway {
    const Cls = registry.get(dbConfig.gatewayType);
    if (!Cls) {
      throw new Error(
        `Gateway '${dbConfig.gatewayType}' is configured but its SDK is not yet integrated. ` +
        `Register the implementation via GatewayFactory.register('${dbConfig.gatewayType}', YourClass).`,
      );
    }
    const config: GatewayRuntimeConfig = {
      gatewayType:   dbConfig.gatewayType,
      merchantId:    dbConfig.merchantId,
      apiKey:        dbConfig.apiKey,
      apiSecret:     dbConfig.apiSecretEnc     ? decrypt(dbConfig.apiSecretEnc)     : '',
      webhookSecret: dbConfig.webhookSecretEnc ? decrypt(dbConfig.webhookSecretEnc) : '',
      environment:   dbConfig.environment,
      ...(dbConfig.isOAuthConnected ? {
        oauthAccessToken: dbConfig.oauthAccessTokenEnc ? decrypt(dbConfig.oauthAccessTokenEnc) : '',
        publicToken:      dbConfig.oauthPublicToken ?? '',
      } : {}),
    };
    return new Cls(config);
  },

  // Returns true when the OAuth access_token expires within the next 7 days.
  // Use this to trigger a proactive refresh before the token actually expires.
  isTokenNearExpiry(dbConfig: IPaymentGatewayConfig): boolean {
    if (!dbConfig.isOAuthConnected || !dbConfig.oauthExpiresAt) return false;
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
    return dbConfig.oauthExpiresAt.getTime() - Date.now() < sevenDaysMs;
  },

  // Returns true when the OAuth access_token has already expired.
  isTokenExpired(dbConfig: IPaymentGatewayConfig): boolean {
    if (!dbConfig.isOAuthConnected || !dbConfig.oauthExpiresAt) return false;
    return dbConfig.oauthExpiresAt < new Date();
  },

  isRegistered(type: GatewayType): boolean {
    return registry.has(type);
  },

  // All types the system supports (even if SDK not yet wired up)
  getSupportedTypes(): GatewayType[] {
    return ['razorpay', 'cashfree', 'phonepe', 'payu', 'paytm', 'bharatpe'];
  },

  // Only types whose SDK is actively registered
  getIntegratedTypes(): GatewayType[] {
    return Array.from(registry.keys());
  },
} as const;

export default GatewayFactory;
