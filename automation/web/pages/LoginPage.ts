import { Page, Locator, expect } from '@playwright/test';

export class LoginPage {
  readonly page: Page;
  readonly adminIdInput: Locator;
  readonly passwordInput: Locator;
  readonly loginButton: Locator;
  readonly errorMessage: Locator;

  constructor(page: Page) {
    this.page = page;
    this.adminIdInput = page.locator('input[name="userId"], input[placeholder*="Admin ID"], input[placeholder*="admin id"]').first();
    this.passwordInput = page.locator('input[type="password"]').first();
    this.loginButton = page.locator('button[type="submit"], button:has-text("Login"), button:has-text("Sign In")').first();
    this.errorMessage = page.locator('[data-testid="error-message"], .error-message, .alert-error').first();
  }

  async navigate(): Promise<void> {
    await this.page.goto('/login');
    await this.page.waitForLoadState('networkidle');
  }

  async loginAsAdmin(adminId: string, password: string): Promise<void> {
    await this.adminIdInput.fill(adminId);
    await this.passwordInput.fill(password);
    await this.loginButton.click();
  }

  async expectLoginSuccess(): Promise<void> {
    await expect(this.page).toHaveURL(/dashboard|home|orders/, { timeout: 10000 });
  }

  async expectLoginError(): Promise<void> {
    await expect(this.errorMessage).toBeVisible({ timeout: 5000 });
  }

  async expectInvalidCredentialsError(): Promise<void> {
    const text = await this.page.locator('text=/invalid|incorrect|wrong|unauthorized/i').first();
    await expect(text).toBeVisible({ timeout: 5000 });
  }
}
