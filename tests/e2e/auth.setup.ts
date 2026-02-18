import { test as setup } from '@playwright/test';

/**
 * Authentication Setup for E2E Tests
 * Logs in via the real /api/auth/login endpoint and saves the session cookie
 */

const authFile = 'tests/e2e/.auth/user.json';

setup('authenticate', async ({ page }) => {
  // Login via API to get the auth cookie
  const baseURL = setup.info().project.use?.baseURL || 'https://dev.fibreflow.app';

  const response = await page.request.post(`${baseURL}/api/auth/login`, {
    data: {
      email: process.env.E2E_EMAIL || 'hein@velocityfibre.co.za',
      password: process.env.E2E_PASSWORD || 'Mitzi@0203',
    },
  });

  if (!response.ok()) {
    throw new Error(`Login failed: ${response.status()} ${await response.text()}`);
  }

  // Navigate to app to ensure cookies are set in the browser context
  // Use domcontentloaded instead of networkidle to avoid timeout from persistent connections
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);

  // Save signed-in state (includes the ff_auth_token cookie)
  await page.context().storageState({ path: authFile });
});
