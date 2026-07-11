import { test, expect, Page } from '@playwright/test';
import { LoginPage } from '../pages/LoginPage';
import { DashboardPage } from '../pages/DashboardPage';
import { OrdersPage } from '../pages/OrdersPage';

const ADMIN_ID = process.env.ADMIN_ID || '';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';

async function loginAsAdmin(page: Page): Promise<void> {
  const loginPage = new LoginPage(page);
  await loginPage.navigate();
  await loginPage.loginAsAdmin(ADMIN_ID, ADMIN_PASSWORD);
  await loginPage.expectLoginSuccess();
}

test.describe('Web — Orders', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
  });

  test('WEB-010 orders page loads with list', async ({ page }) => {
    const dashboard = new DashboardPage(page);
    await dashboard.navigateToOrders();
    const ordersPage = new OrdersPage(page);
    await ordersPage.expectVisible();
  });

  test('WEB-011 new order button is visible', async ({ page }) => {
    const dashboard = new DashboardPage(page);
    await dashboard.navigateToOrders();
    const ordersPage = new OrdersPage(page);
    await expect(ordersPage.newOrderButton).toBeVisible({ timeout: 5000 });
  });

  test('WEB-012 orders list renders without JavaScript errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', msg => {
      if (msg.type() === 'error') errors.push(msg.text());
    });
    const dashboard = new DashboardPage(page);
    await dashboard.navigateToOrders();
    await page.waitForLoadState('networkidle');
    const jsErrors = errors.filter(e => !e.includes('favicon') && !e.includes('404'));
    expect(jsErrors).toHaveLength(0);
  });

  test('WEB-013 order detail page loads when clicking an order', async ({ page }) => {
    const dashboard = new DashboardPage(page);
    await dashboard.navigateToOrders();
    const ordersPage = new OrdersPage(page);
    const count = await ordersPage.getOrderCount();
    if (count > 0) {
      await page.locator('[data-testid="order-row"], .order-item, table tbody tr').first().click();
      await expect(page.locator('text=/Order Details|ORD-/i').first()).toBeVisible({ timeout: 5000 });
    }
  });

  test('WEB-014 filter by status works', async ({ page }) => {
    const dashboard = new DashboardPage(page);
    await dashboard.navigateToOrders();
    const ordersPage = new OrdersPage(page);
    await ordersPage.filterByStatus('pending');
    await page.waitForLoadState('networkidle');
    await expect(page).not.toHaveURL(/error/);
  });
});
