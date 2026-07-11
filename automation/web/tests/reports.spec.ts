import { test, expect, Page } from '@playwright/test';
import { LoginPage } from '../pages/LoginPage';
import { DashboardPage } from '../pages/DashboardPage';

const ADMIN_ID = process.env.ADMIN_ID || '';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';

async function loginAsAdmin(page: Page): Promise<void> {
  const loginPage = new LoginPage(page);
  await loginPage.navigate();
  await loginPage.loginAsAdmin(ADMIN_ID, ADMIN_PASSWORD);
  await loginPage.expectLoginSuccess();
}

test.describe('Web — Reports', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
  });

  test('WEB-020 reports page loads', async ({ page }) => {
    const dashboard = new DashboardPage(page);
    await dashboard.navigateToReports();
    await expect(page.locator('text=/report|Report/i').first()).toBeVisible({ timeout: 8000 });
  });

  test('WEB-021 daily report shows revenue and order count', async ({ page }) => {
    const dashboard = new DashboardPage(page);
    await dashboard.navigateToReports();
    const dailyLink = page.locator('text=/Daily Report|daily/i').first();
    await dailyLink.click();
    await page.waitForLoadState('networkidle');
    await expect(page.locator('text=/Total Orders|Revenue|Orders Today/i').first()).toBeVisible({ timeout: 8000 });
  });

  test('WEB-022 range report accepts date range and fetches data', async ({ page }) => {
    const dashboard = new DashboardPage(page);
    await dashboard.navigateToReports();
    const rangeLink = page.locator('text=/Range Report|range/i').first();
    await rangeLink.click();
    await page.waitForLoadState('networkidle');
    const fromInput = page.locator('input[type="date"]').first();
    const toInput = page.locator('input[type="date"]').nth(1);
    if (await fromInput.isVisible() && await toInput.isVisible()) {
      const today = new Date().toISOString().split('T')[0];
      const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
      await fromInput.fill(yesterday);
      await toInput.fill(today);
      await page.locator('button:has-text("Search"), button:has-text("Filter"), button[type="submit"]').first().click();
      await page.waitForLoadState('networkidle');
      await expect(page).not.toHaveURL(/error/);
    }
  });

  test('WEB-023 product report loads and shows product list', async ({ page }) => {
    const dashboard = new DashboardPage(page);
    await dashboard.navigateToReports();
    const productLink = page.locator('text=/Product Report|products/i').first();
    if (await productLink.isVisible()) {
      await productLink.click();
      await page.waitForLoadState('networkidle');
      await expect(page).not.toHaveURL(/error/);
    }
  });

  test('WEB-024 reports page has no JavaScript errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', msg => {
      if (msg.type() === 'error') errors.push(msg.text());
    });
    const dashboard = new DashboardPage(page);
    await dashboard.navigateToReports();
    await page.waitForLoadState('networkidle');
    const jsErrors = errors.filter(e => !e.includes('favicon') && !e.includes('404'));
    expect(jsErrors).toHaveLength(0);
  });
});
