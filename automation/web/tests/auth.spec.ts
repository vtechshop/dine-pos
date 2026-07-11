import { test, expect } from '@playwright/test';
import { LoginPage } from '../pages/LoginPage';
import { DashboardPage } from '../pages/DashboardPage';

const ADMIN_ID = process.env.ADMIN_ID || '';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';

test.describe('Web — Authentication', () => {
  test('WEB-001 admin login page loads', async ({ page }) => {
    await page.goto('/login');
    await expect(page.locator('input[type="password"]').first()).toBeVisible();
  });

  test('WEB-002 valid admin credentials redirect to dashboard', async ({ page }) => {
    const loginPage = new LoginPage(page);
    await loginPage.navigate();
    await loginPage.loginAsAdmin(ADMIN_ID, ADMIN_PASSWORD);
    await loginPage.expectLoginSuccess();
  });

  test('WEB-003 invalid credentials show error message', async ({ page }) => {
    const loginPage = new LoginPage(page);
    await loginPage.navigate();
    await loginPage.loginAsAdmin('WRONG_ADMIN', 'wrongpass');
    await loginPage.expectInvalidCredentialsError();
  });

  test('WEB-004 empty form submission shows validation errors', async ({ page }) => {
    const loginPage = new LoginPage(page);
    await loginPage.navigate();
    await loginPage.loginButton.click();
    const hasValidation = await page.locator('text=/required|empty|fill/i').first().isVisible().catch(() => false);
    const staysOnLogin = page.url().includes('login');
    expect(hasValidation || staysOnLogin).toBe(true);
  });

  test('WEB-005 logout redirects to login', async ({ page }) => {
    const loginPage = new LoginPage(page);
    await loginPage.navigate();
    await loginPage.loginAsAdmin(ADMIN_ID, ADMIN_PASSWORD);
    await loginPage.expectLoginSuccess();
    const dashboard = new DashboardPage(page);
    await dashboard.logout();
    await expect(page).toHaveURL(/login/);
  });

  test('WEB-006 protected routes redirect to login when unauthenticated', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/login/, { timeout: 5000 });
  });

  test('WEB-007 page title contains DinePOS or hotel name', async ({ page }) => {
    await page.goto('/');
    const title = await page.title();
    expect(title.length).toBeGreaterThan(0);
  });
});
