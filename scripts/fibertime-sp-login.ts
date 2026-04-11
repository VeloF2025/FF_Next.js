/**
 * Fibertime SharePoint — Interactive Login (Cookie Saver)
 *
 * Opens a headed browser, navigates to the Fibertime SharePoint site,
 * pre-fills the shared mailbox email, waits for you to complete OTP,
 * then saves ALL session cookies to FIBERTIME_SP_COOKIE_FILE.
 *
 * Re-run this script every ~30-90 days when cookies expire.
 *
 * Prerequisites:
 *   - FIBERTIME_SP_COOKIE_FILE must be set in .env.local
 *   - Playwright chromium installed: npx playwright install chromium
 *
 * Run:
 *   npx tsx -r dotenv/config scripts/fibertime-sp-login.ts
 *
 * Or with explicit cookie file path:
 *   FIBERTIME_SP_COOKIE_FILE=/home/velo/.fibertime-sp-cookies.json npx tsx -r dotenv/config scripts/fibertime-sp-login.ts
 */

import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import { chromium } from 'playwright';

// ============================================================================
// CONFIG
// ============================================================================

const SP_URL = 'https://isizweprojects.sharepoint.com/sites/FibertimeReports';
const LOGIN_EMAIL = 'reporting@velocityfibre.co.za';

function getCookieFile(): string {
  const f = process.env.FIBERTIME_SP_COOKIE_FILE;
  if (!f) {
    process.stderr.write(
      'ERROR: FIBERTIME_SP_COOKIE_FILE is not set.\n' +
        'Add it to .env.local, e.g.:\n' +
        '  FIBERTIME_SP_COOKIE_FILE=/home/velo/.fibertime-sp-cookies.json\n'
    );
    process.exit(1);
  }
  return f;
}

function waitForEnter(prompt: string): Promise<void> {
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(prompt, () => {
      rl.close();
      resolve();
    });
  });
}

// ============================================================================
// MAIN
// ============================================================================

async function main(): Promise<void> {
  const cookieFile = getCookieFile();
  const cookieDir = path.dirname(cookieFile);

  if (!fs.existsSync(cookieDir)) {
    fs.mkdirSync(cookieDir, { recursive: true });
  }

  process.stdout.write('\n=== Fibertime SharePoint Login ===\n\n');
  process.stdout.write('A browser window will open. Complete the OTP login, then press Enter here.\n\n');

  const browser = await chromium.launch({
    headless: false,
    channel: 'chromium',
  });

  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    userAgent:
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  });

  const page = await context.newPage();

  process.stdout.write(`Navigating to ${SP_URL}...\n`);
  await page.goto(SP_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 });

  // Pre-fill email if the Microsoft login form is shown
  try {
    await page.waitForSelector('input[type="email"]', { timeout: 5_000 });
    await page.fill('input[type="email"]', LOGIN_EMAIL);
    process.stdout.write(`Email pre-filled as: ${LOGIN_EMAIL}\n`);

    // Click "Next" button if present
    const nextBtn = page.locator('input[type="submit"], button[type="submit"]').first();
    if (await nextBtn.isVisible({ timeout: 2_000 })) {
      await nextBtn.click();
    }
  } catch {
    // Form not visible yet — the browser may already be logged in or showing a different screen
    process.stdout.write('Email field not found — you may need to enter it manually in the browser.\n');
  }

  process.stdout.write('\nComplete the login in the browser window (enter OTP, approve prompts, etc.)\n');
  process.stdout.write('When you can see the SharePoint site content, press Enter here to save cookies.\n\n');

  await waitForEnter('Press Enter when logged in → ');

  // Verify we landed on the SharePoint site
  const currentUrl = page.url();
  if (!currentUrl.includes('sharepoint.com')) {
    process.stderr.write(`\nWARNING: Current URL does not look like SharePoint: ${currentUrl}\n`);
    process.stderr.write('Cookies will be saved anyway — verify they work by running the sync.\n\n');
  }

  // Save ALL cookies from the browser context
  const cookies = await context.cookies();

  const cookieJson = JSON.stringify(cookies, null, 2);
  fs.writeFileSync(cookieFile, cookieJson, 'utf-8');

  process.stdout.write(`\n=== Cookies Saved ===\n\n`);
  process.stdout.write(`File: ${cookieFile}\n`);
  process.stdout.write(`Total cookies: ${cookies.length}\n`);

  const spCookies = cookies.filter(c => c.domain.includes('sharepoint.com'));
  process.stdout.write(`SharePoint cookies: ${spCookies.length}\n\n`);

  if (spCookies.length === 0) {
    process.stderr.write('WARNING: No SharePoint cookies found. Login may not have completed.\n');
    process.stderr.write('Try again and make sure you can see SharePoint content before pressing Enter.\n\n');
  } else {
    process.stdout.write('Cookies saved successfully.\n');
    process.stdout.write('The nightly OES sync will use these cookies automatically.\n');
    process.stdout.write('Re-run this script in ~30-90 days if you see auth errors in the logs.\n\n');
  }

  await browser.close();
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  process.stderr.write(`FATAL: ${msg}\n`);
  process.exit(1);
});
