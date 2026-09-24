/**
 * Go-Live Pre-Pilot Security Regression Tests
 *
 * GL2-01 — Cross-tenant customer profile exposure (orgCustomerRoutes /candidates/:profileId)
 *          Confirmed fix: org-membership guard added after CustomerProfile.findById.
 *
 * GL2-02 — Razorpay Partner Webhook Secret: no hardcoded fallback, no secret in logs.
 *
 * GL2-03 — Gemini model resolver: GEMINI_MODEL env override respected; empty model returns ''.
 *
 * GL2-04 — AI Forecast route: /forecast/purchase URL matches frontend caller.
 *
 * All tests are pure source-inspection tests — no DB, no HTTP.
 */

import * as fs from 'fs';
import * as path from 'path';

function readSrc(...parts: string[]): string {
  return fs.readFileSync(
    path.join(__dirname, '..', '..', 'src', ...parts),
    'utf8',
  );
}

// ── GL2-01 Cross-tenant profile exposure guard ────────────────────────────────

describe('GL2-01 — Cross-tenant profile exposure guard in /candidates/:profileId', () => {
  const route = readSrc('routes', 'orgCustomerRoutes.ts');

  it('GL2-01-A  org-membership guard exists after CustomerProfile.findById in candidates handler', () => {
    // The fix must appear between the findById call and the orgCustomerId early-return
    const findByIdIdx  = route.indexOf("CustomerProfile.findById(req.params.profileId)");
    const guardIdx     = route.indexOf('Profile does not belong to this organization');
    const alreadyLinked = route.indexOf('alreadyLinked: true');
    expect(findByIdIdx).toBeGreaterThan(0);
    expect(guardIdx).toBeGreaterThan(findByIdIdx);
    expect(alreadyLinked).toBeGreaterThan(guardIdx); // guard fires before alreadyLinked check
  });

  it('GL2-01-B  guard uses validHotelIds Set that includes orgHotelId and branch IDs', () => {
    expect(route).toContain('validHotelIds');
    expect(route).toContain('ctx.orgHotelId');
    expect(route).toContain("'Profile does not belong to this organization'");
  });

  it('GL2-01-C  link endpoint also has org-membership guard (existing correct protection)', () => {
    // The /link POST had this guard before the fix — verify it still exists
    expect(route).toContain('Profile does not belong to this organization');
    const matches = (route.match(/Profile does not belong to this organization/g) ?? []).length;
    // Should appear in both the candidates handler (new) and the link handler (existing)
    expect(matches).toBeGreaterThanOrEqual(2);
  });

  it('GL2-01-D  profile.hotelId is validated against org hotel set (not skipped)', () => {
    expect(route).toContain("validHotelIds.has(profile.hotelId");
  });

  it('GL2-01-E  unauthorized access returns 403 (not 404)', () => {
    // The guard must return 403, not 404, so the caller cannot enumerate existence
    const guardBlock = route.slice(
      route.indexOf('Profile does not belong to this organization') - 50,
      route.indexOf('Profile does not belong to this organization') + 80,
    );
    expect(guardBlock).toContain('403');
  });
});

// ── GL2-01 pure-logic: cross-org access control invariants ────────────────────

describe('GL2-01 — Pure-logic: org membership check invariants', () => {
  function isProfileInOrg(
    profileHotelId: string,
    orgHotelId: string,
    branchIds: string[],
  ): boolean {
    const validIds = new Set([orgHotelId, ...branchIds]);
    return validIds.has(profileHotelId);
  }

  const ORG_A_HQ       = 'orgA_hq_0000000000001';
  const ORG_A_BRANCH1  = 'orgA_branch_000000002';
  const ORG_B_HQ       = 'orgB_hq_0000000000003';
  const ORG_B_BRANCH1  = 'orgB_branch_000000004';

  it('GL2-01-F  profile from own HQ is allowed', () => {
    expect(isProfileInOrg(ORG_A_HQ, ORG_A_HQ, [ORG_A_BRANCH1])).toBe(true);
  });

  it('GL2-01-G  profile from own branch is allowed', () => {
    expect(isProfileInOrg(ORG_A_BRANCH1, ORG_A_HQ, [ORG_A_BRANCH1])).toBe(true);
  });

  it('GL2-01-H  profile from a different org HQ is BLOCKED', () => {
    expect(isProfileInOrg(ORG_B_HQ, ORG_A_HQ, [ORG_A_BRANCH1])).toBe(false);
  });

  it('GL2-01-I  profile from a different org branch is BLOCKED', () => {
    expect(isProfileInOrg(ORG_B_BRANCH1, ORG_A_HQ, [ORG_A_BRANCH1])).toBe(false);
  });

  it('GL2-01-J  injected orgHotelId that matches foreign profile is BLOCKED', () => {
    // Attacker submits a profileId from Org B while authenticated in Org A
    const attackerOrgHotelId = ORG_A_HQ;
    const foreignProfileHotelId = ORG_B_BRANCH1;
    expect(isProfileInOrg(foreignProfileHotelId, attackerOrgHotelId, [ORG_A_BRANCH1])).toBe(false);
  });

  it('GL2-01-K  empty branchIds still allows HQ-owned profiles', () => {
    expect(isProfileInOrg(ORG_A_HQ, ORG_A_HQ, [])).toBe(true);
  });
});

// ── GL2-02 Razorpay Partner Webhook Secret ────────────────────────────────────

describe('GL2-02 — RAZORPAY_PARTNER_WEBHOOK_SECRET: safe failure, no hardcoded fallback', () => {
  const webhook = readSrc('routes', 'razorpayPartnerWebhookRoutes.ts');

  it('GL2-02-A  secret is read only from process.env (no hardcoded value)', () => {
    expect(webhook).toContain("process.env.RAZORPAY_PARTNER_WEBHOOK_SECRET");
    // Must not contain a hardcoded hex secret (32+ hex chars in a string literal)
    expect(webhook).not.toMatch(/"[0-9a-f]{32,}"/i);
  });

  it('GL2-02-B  missing secret returns 500 and logs an error — no silent fallback', () => {
    expect(webhook).toContain('RAZORPAY_PARTNER_WEBHOOK_SECRET not set');
    expect(webhook).toContain('res.status(500)');
  });

  it('GL2-02-C  secret value is never printed in logs', () => {
    // The webhook logs signatureReceived (sliced) but never the secret variable
    // Check there is no log call that includes the raw secret variable
    expect(webhook).not.toMatch(/logger\.(info|warn|error|debug)\(.*secret/);
  });

  it('GL2-02-D  signature comparison uses timingSafeEqual (timing-safe)', () => {
    expect(webhook).toContain('timingSafeEqual');
  });

  it('GL2-02-E  verifySignature returns false if rawBody, signature, or secret is empty', () => {
    expect(webhook).toContain('if (!rawBody || !signature || !secret) return false');
  });
});

// ── GL2-03 Gemini model resolver: env override and empty guard ────────────────

describe('GL2-03 — Gemini model: env override, null guard, no hardcoded model', () => {
  const resolver  = readSrc('services', 'ai', 'modelResolver.ts');
  const narrative = readSrc('utils', 'geminiNarrative.ts');

  it('GL2-03-A  GEMINI_MODEL env var is an early return in resolveGeminiModel', () => {
    // The function must return the env override immediately, before any API call.
    expect(resolver).toContain("if (process.env.GEMINI_MODEL) return process.env.GEMINI_MODEL");
    // Verify the env check and listModels call are both inside resolveGeminiModel
    const funcStart = resolver.indexOf('export async function resolveGeminiModel');
    const envReturnIdx = resolver.indexOf('if (process.env.GEMINI_MODEL) return', funcStart);
    const listCallIdx  = resolver.indexOf('await listModels(apiKey)', funcStart);
    expect(envReturnIdx).toBeGreaterThan(funcStart);
    expect(listCallIdx).toBeGreaterThan(envReturnIdx); // env check fires before API call
  });

  it('GL2-03-B  empty model string triggers error log and returns null from getModel()', () => {
    expect(narrative).toContain('No usable model resolved');
    expect(narrative).toContain('return null');
  });

  it('GL2-03-C  getModel returns null if GEMINI_API_KEY is absent', () => {
    expect(narrative).toContain("if (!process.env.GEMINI_API_KEY) return null");
  });

  it('GL2-03-D  gemini-2.0-flash is in the preference list (env override target is valid)', () => {
    expect(resolver).toContain('gemini-2.0-flash');
  });

  it('GL2-03-E  model name is not hardcoded in geminiNarrative — comes from getModel()', () => {
    // geminiNarrative should not contain a literal model string like "gemini-2.0-flash"
    // Model selection is delegated to resolveGeminiModel
    expect(narrative).not.toContain('"gemini-2.0-flash"');
    expect(narrative).not.toContain('"gemini-1.5-flash"');
  });
});

// ── GL2-04 AI Forecast route URL alignment ────────────────────────────────────

describe('GL2-04 — Purchase Intelligence route: backend URL matches frontend caller', () => {
  const backendRoute = readSrc('routes', 'aiForecastRoutes.ts');

  it("GL2-04-A  backend registers route as '/forecast/purchase'", () => {
    expect(backendRoute).toContain("router.get('/forecast/purchase'");
  });

  it("GL2-04-B  stale '/purchase' (without /forecast prefix) is not registered for Purchase Intelligence", () => {
    // The old broken route was router.get('/purchase', ...) — must not exist any more
    // (Other purchase routes like /purchase-orders are in separate router files)
    expect(backendRoute).not.toContain("router.get('/purchase',");
  });

  it('GL2-04-C  route handler calls buildPurchaseSuggestions (correct service)', () => {
    expect(backendRoute).toContain('buildPurchaseSuggestions');
  });
});
