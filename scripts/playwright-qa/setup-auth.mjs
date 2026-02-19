/**
 * FibreFlow Playwright Auth Setup
 *
 * Logs into FibreFlow via Playwright and saves auth state for QA testing.
 * Auth state is saved to /tmp/playwright-auth/auth.json and reused by qa-runner.mjs.
 *
 * Usage:
 *   node scripts/playwright-qa/setup-auth.mjs [environment]
 *
 * Environments: staging (default), production, dev, local
 *
 * Requires:
 *   - FF_EMAIL env var (default: hein@velocityfibre.co.za)
 *   - FF_PASSWORD env var (required)
 *   - Playwright installed: npm install playwright (in /tmp/playwright-auth)
 */
import { chromium } from '/tmp/playwright-auth/node_modules/playwright/index.mjs';
import { mkdirSync } from 'fs';

const ENV_URLS = {
  staging: 'https://vf.fibreflow.app',
  production: 'https://app.fibreflow.app',
  dev: 'https://dev.fibreflow.app',
  local: 'http://localhost:3004',
};

const env = process.argv[2] || 'staging';
const baseUrl = ENV_URLS[env] || ENV_URLS.staging;
const EMAIL = process.env.FF_EMAIL || 'hein@velocityfibre.co.za';
const PASSWORD = process.env.FF_PASSWORD;

if (!PASSWORD) {
  console.error('FF_PASSWORD environment variable is required.');
  console.error('Usage: FF_PASSWORD=xxx node scripts/playwright-qa/setup-auth.mjs [staging|production|dev|local]');
  process.exit(1);
}

const AUTH_DIR = '/tmp/playwright-auth';
const AUTH_STATE = `${AUTH_DIR}/auth.json`;
mkdirSync(AUTH_DIR, { recursive: true });
mkdirSync('/tmp/qa-screenshots', { recursive: true });

console.log(`Logging into ${baseUrl} as ${EMAIL}...`);

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();

try {
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
  await page.waitForTimeout(2000);

  // Enter email
  const emailInput = page.locator('input[type="email"], input[name="email"], input[placeholder*="email" i]');
  await emailInput.waitFor({ timeout: 5000 });
  await emailInput.fill(EMAIL);
  await page.locator('button:has-text("Continue"), button:has-text("Next")').click();
  await page.waitForTimeout(2000);

  // Enter password
  const passwordInput = page.locator('input[type="password"]');
  await passwordInput.waitFor({ timeout: 10000 });
  await passwordInput.fill(PASSWORD);
  await page.locator('button:has-text("Sign"), button:has-text("Login"), button:has-text("Log in"), button[type="submit"]').click();

  // Wait for dashboard
  await page.waitForURL('**/dashboard**', { timeout: 20000 });
  await page.waitForTimeout(3000);
  console.log(`Logged in! URL: ${page.url()}`);

  // Save auth state
  await context.storageState({ path: AUTH_STATE });
  console.log(`Auth state saved: ${AUTH_STATE}`);
  console.log('Valid until browser session expires (24h-30d depending on server config).');

} catch (err) {
  console.error(`Login failed: ${err.message}`);
  await page.screenshot({ path: '/tmp/qa-screenshots/auth-failure.png' });
  console.error('Screenshot: /tmp/qa-screenshots/auth-failure.png');
  process.exit(1);
}

await browser.close();
