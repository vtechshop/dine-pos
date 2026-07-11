import { Page, Locator, expect } from '@playwright/test';

export class DashboardPage {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  async expectVisible(): Promise<void> {
    await expect(
      this.page.locator('text=/dashboard|Dashboard|orders|Orders/i').first()
    ).toBeVisible({ timeout: 10000 });
  }

  async navigateToOrders(): Promise<void> {
    await this.page.locator('a[href*="orders"], nav >> text=Orders').first().click();
    await this.page.waitForLoadState('networkidle');
  }

  async navigateToMenu(): Promise<void> {
    await this.page.locator('a[href*="menu"], nav >> text=Menu').first().click();
    await this.page.waitForLoadState('networkidle');
  }

  async navigateToReports(): Promise<void> {
    await this.page.locator('a[href*="reports"], nav >> text=Reports').first().click();
    await this.page.waitForLoadState('networkidle');
  }

  async navigateToSettings(): Promise<void> {
    await this.page.locator('a[href*="settings"], nav >> text=Settings').first().click();
    await this.page.waitForLoadState('networkidle');
  }

  async logout(): Promise<void> {
    await this.page.locator('button:has-text("Logout"), button:has-text("Sign Out"), [data-testid="logout"]').first().click();
    await this.page.waitForURL(/login/, { timeout: 5000 });
  }

  async getNotificationBadgeCount(): Promise<number> {
    const badge = this.page.locator('[data-testid="notification-badge"], .notification-badge, .badge').first();
    const visible = await badge.isVisible();
    if (!visible) return 0;
    const text = await badge.textContent();
    return parseInt(text || '0', 10) || 0;
  }
}
