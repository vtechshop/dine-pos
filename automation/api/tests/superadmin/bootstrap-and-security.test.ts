/**
 * Regression tests for SA audit findings:
 * - C-SA-01: Bootstrap partial failure recovery
 * - H-SA-08: Remote config boolean strict validation
 * - AUTH-01: Credential-header auth production guard
 */

import { api } from '../../../utils/api-client';
import { superAdminHeaders, ENV } from '../../../utils/env';
import { registerHotel, approveHotel } from '../../helpers/auth.helper';

// ── C-SA-01: Bootstrap status tracking + retry endpoint ─────────────────────

describe('C-SA-01 — Bootstrap partial failure recovery', () => {
  it('BSTR-001 approve sets bootstrapStatus=completed on normal success', async () => {
    const { hotelId } = await registerHotel();
    const approveRes = await api
      .put(`/api/superadmin/hotels/${hotelId}/approve`)
      .set(superAdminHeaders)
      .send({ trialDays: 14 });
    expect(approveRes.status).toBe(200);

    const hotelRes = await api
      .get(`/api/superadmin/hotels/${hotelId}`)
      .set(superAdminHeaders);
    expect(hotelRes.status).toBe(200);
    expect(hotelRes.body.bootstrapStatus).toBe('completed');
  });

  it('BSTR-002 bootstrap retry on already-bootstrapped hotel returns 409', async () => {
    const { hotelId } = await registerHotel();
    await approveHotel(hotelId);

    const retryRes = await api
      .post(`/api/superadmin/hotels/${hotelId}/bootstrap`)
      .set(superAdminHeaders);
    // Settings were created during approve — retry must detect them and return 409
    expect(retryRes.status).toBe(409);
    expect(retryRes.body.message).toMatch(/already/i);
  });

  it('BSTR-003 bootstrap retry on unapproved hotel (no adminId) returns 400', async () => {
    const { hotelId } = await registerHotel();

    const retryRes = await api
      .post(`/api/superadmin/hotels/${hotelId}/bootstrap`)
      .set(superAdminHeaders);
    expect(retryRes.status).toBe(400);
    expect(retryRes.body.message).toMatch(/approved|adminId/i);
  });

  it('BSTR-004 bootstrap retry with invalid hotel ID returns 400', async () => {
    const res = await api
      .post('/api/superadmin/hotels/not-a-valid-id/bootstrap')
      .set(superAdminHeaders);
    expect(res.status).toBe(400);
  });

  it('BSTR-005 bootstrap retry with non-existent hotel returns 404', async () => {
    const res = await api
      .post('/api/superadmin/hotels/000000000000000000000000/bootstrap')
      .set(superAdminHeaders);
    expect(res.status).toBe(404);
  });

  it('BSTR-006 bootstrap retry requires SA auth — 401 without credentials', async () => {
    const { hotelId } = await registerHotel();
    const res = await api
      .post(`/api/superadmin/hotels/${hotelId}/bootstrap`);
    expect([401, 403]).toContain(res.status);
  });

  /**
   * BSTR-007 (MANUAL / MOCK-REQUIRED): approval succeeds + bootstrap fails + retry succeeds
   * Scenario: force bootstrapStatus='failed' in DB (bypass bootstrap service failure),
   * then call POST /hotels/:id/bootstrap on a hotel where Settings do NOT exist.
   * Expected: 200 with kitchenPin in response.
   *
   * This cannot be exercised in integration without either:
   *   (a) Mocking bootstrapNewHotel to throw on the first call, or
   *   (b) Manually removing the Settings document and setting bootstrapStatus='failed'.
   * The code path is: bootstrapStatus='failed' + no Settings → run bootstrap → 200.
   */
  it.todo('BSTR-007 MANUAL: bootstrapStatus=failed + no Settings → retry succeeds with kitchenPin');
});

// ── H-SA-08: Remote config boolean strict validation ─────────────────────────

describe('H-SA-08 — Remote config strict boolean validation', () => {
  it('RC-BOOL-001 actual boolean true is accepted', async () => {
    const res = await api
      .put('/api/superadmin/remote-config')
      .set(superAdminHeaders)
      .send({ maintenanceMode: true });
    expect(res.status).toBe(200);
    // Restore
    await api
      .put('/api/superadmin/remote-config')
      .set(superAdminHeaders)
      .send({ maintenanceMode: false });
  });

  it('RC-BOOL-002 actual boolean false is accepted', async () => {
    const res = await api
      .put('/api/superadmin/remote-config')
      .set(superAdminHeaders)
      .send({ maintenanceMode: false });
    expect(res.status).toBe(200);
  });

  it('RC-BOOL-003 string "true" is rejected with 400', async () => {
    const res = await api
      .put('/api/superadmin/remote-config')
      .set(superAdminHeaders)
      .send({ maintenanceMode: 'true' });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/maintenanceMode must be a boolean/i);
  });

  it('RC-BOOL-004 string "false" is rejected with 400', async () => {
    const res = await api
      .put('/api/superadmin/remote-config')
      .set(superAdminHeaders)
      .send({ maintenanceMode: 'false' });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/maintenanceMode must be a boolean/i);
  });

  it('RC-BOOL-005 string "yes" is rejected with 400', async () => {
    const res = await api
      .put('/api/superadmin/remote-config')
      .set(superAdminHeaders)
      .send({ forceUpdate: 'yes' });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/forceUpdate must be a boolean/i);
  });

  it('RC-BOOL-006 string "no" is rejected with 400', async () => {
    const res = await api
      .put('/api/superadmin/remote-config')
      .set(superAdminHeaders)
      .send({ forceUpdate: 'no' });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/forceUpdate must be a boolean/i);
  });

  it('RC-BOOL-007 string "0" is rejected with 400', async () => {
    const res = await api
      .put('/api/superadmin/remote-config')
      .set(superAdminHeaders)
      .send({ paymentEnabled: '0' });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/paymentEnabled must be a boolean/i);
  });

  it('RC-BOOL-008 string "1" is rejected with 400', async () => {
    const res = await api
      .put('/api/superadmin/remote-config')
      .set(superAdminHeaders)
      .send({ paymentEnabled: '1' });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/paymentEnabled must be a boolean/i);
  });

  it('RC-BOOL-009 null is rejected with 400', async () => {
    const res = await api
      .put('/api/superadmin/remote-config')
      .set(superAdminHeaders)
      .send({ maintenanceMode: null });
    expect(res.status).toBe(400);
  });

  it('RC-BOOL-010 number 1 is rejected with 400', async () => {
    const res = await api
      .put('/api/superadmin/remote-config')
      .set(superAdminHeaders)
      .send({ maintenanceMode: 1 });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/maintenanceMode must be a boolean/i);
  });

  it('RC-BOOL-011 trialDays as string is rejected', async () => {
    const res = await api
      .put('/api/superadmin/remote-config')
      .set(superAdminHeaders)
      .send({ trialDays: 'fourteen' });
    expect(res.status).toBe(400);
  });

  it('RC-BOOL-012 trialDays negative is rejected', async () => {
    const res = await api
      .put('/api/superadmin/remote-config')
      .set(superAdminHeaders)
      .send({ trialDays: -1 });
    expect(res.status).toBe(400);
  });
});

// ── AUTH-01: Credential-header auth production guard ─────────────────────────

describe('AUTH-01 — Credential-header auth production guard', () => {
  it('AUTH-001 valid SA credential headers work in test environment (NODE_ENV=test)', async () => {
    const res = await api
      .get('/api/superadmin/health')
      .set({
        'x-super-admin-id':   ENV.SUPER_ADMIN_ID,
        'x-super-admin-pass': ENV.SUPER_ADMIN_PASS,
      });
    expect(res.status).toBe(200);
  });

  it('AUTH-002 wrong credential headers return 401 in all environments', async () => {
    const res = await api
      .get('/api/superadmin/health')
      .set({
        'x-super-admin-id':   'wrong-id',
        'x-super-admin-pass': 'wrong-pass',
      });
    expect([401, 403]).toContain(res.status);
  });

  it('AUTH-003 no credentials and no JWT return 401', async () => {
    const res = await api.get('/api/superadmin/health');
    expect([401, 403]).toContain(res.status);
  });

  /**
   * AUTH-004 (ENVIRONMENT-DEPENDENT): Production mode without ENABLE flag → 401
   * Verification: deploy to a production environment without
   * ENABLE_SUPERADMIN_CREDENTIAL_HEADER_AUTH=true and confirm that
   * x-super-admin-id / x-super-admin-pass headers return 401.
   * Cannot be automated in test environment since NODE_ENV=test.
   */
  it.todo('AUTH-004 ENV-DEPENDENT: production + no ENABLE_SUPERADMIN_CREDENTIAL_HEADER_AUTH → 401');
});
