import { Page, Locator, expect } from '@playwright/test';

export class OrdersPage {
  readonly page: Page;
  readonly newOrderButton: Locator;
  readonly ordersList: Locator;
  readonly searchInput: Locator;

  constructor(page: Page) {
    this.page = page;
    this.newOrderButton = page.locator('button:has-text("New Order"), button:has-text("Create Order"), [data-testid="new-order-btn"]').first();
    this.ordersList = page.locator('[data-testid="orders-list"], .orders-list, table tbody').first();
    this.searchInput = page.locator('input[placeholder*="search"], input[type="search"]').first();
  }

  async expectVisible(): Promise<void> {
    await expect(this.page.locator('text=/orders/i').first()).toBeVisible({ timeout: 8000 });
  }

  async clickNewOrder(): Promise<void> {
    await this.newOrderButton.click();
  }

  async expectOrdersLoaded(): Promise<void> {
    await this.page.waitForLoadState('networkidle');
    await expect(this.ordersList).toBeVisible({ timeout: 8000 });
  }

  async getOrderCount(): Promise<number> {
    const rows = this.page.locator('[data-testid="order-row"], .order-item, table tbody tr');
    return rows.count();
  }

  async filterByStatus(status: string): Promise<void> {
    const filter = this.page.locator(`button:has-text("${status}"), [data-status="${status}"]`).first();
    await filter.click();
    await this.page.waitForLoadState('networkidle');
  }

  async getOrderByNumber(orderNumber: string): Promise<Locator> {
    return this.page.locator(`text=${orderNumber}`).first();
  }

  async expectOrderVisible(orderNumber: string): Promise<void> {
    await expect(this.page.locator(`text=${orderNumber}`).first()).toBeVisible({ timeout: 8000 });
  }
}
