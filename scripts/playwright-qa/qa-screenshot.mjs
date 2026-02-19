/**
 * FibreFlow QA Screenshot
 *
 * Takes an authenticated screenshot of any FibreFlow page.
 * Uses saved auth state from setup-auth.mjs.
 *
 * Usage:
 *   node scripts/playwright-qa/qa-screenshot.mjs <url> <output> [--wait <ms>] [--full-page]
 *
 * Examples:
 *   node scripts/playwright-qa/qa-screenshot.mjs https://vf.fibreflow.app/dashboard /tmp/qa-screenshots/dash.png
 *   node scripts/playwright-qa/qa-screenshot.mjs https://vf.fibreflow.app/staff /tmp/qa-screenshots/staff.png --full-page
 */
import { chromium } from '/tmp/playwright-auth/node_modules/playwright/index.mjs';

const args = process.argv.slice(2);
const url = args[0];
const output = args[1];
const waitMs = args.includes('--wait') ? parseInt(args[args.indexOf('--wait') + 1]) : 3000;
const fullPage = args.includes('--full-page');
const AUTH_STATE = '/tmp/playwright-auth/auth.json';

if (!url || !output) {
  console.error('Usage: node qa-screenshot.mjs <url> <output> [--wait <ms>] [--full-page]');
  process.exit(1);
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  storageState: AUTH_STATE,
  viewport: { width: 1440, height: 900 },
});
const page = await context.newPage();

const consoleErrors = [];
page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });

try {
  console.log(`Navigating to ${url}...`);
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
  if (waitMs > 0) await page.waitForTimeout(waitMs);

  const finalUrl = page.url();
  if (finalUrl.includes('/sign-in') || finalUrl.includes('/login')) {
    console.error(`WARN: Redirected to login (${finalUrl}). Run setup-auth.mjs first.`);
  }

  console.log(`Title: ${await page.title()}`);
  console.log(`URL: ${finalUrl}`);
  await page.screenshot({ path: output, fullPage });
  console.log(`Screenshot: ${output}`);

  if (consoleErrors.length > 0) {
    console.log(`Console errors (${consoleErrors.length}):`);
    consoleErrors.slice(0, 5).forEach(e => console.log(`  ${e.substring(0, 120)}`));
  }
} catch (err) {
  console.error(`Error: ${err.message}`);
  try { await page.screenshot({ path: output }); } catch {}
}

await browser.close();
