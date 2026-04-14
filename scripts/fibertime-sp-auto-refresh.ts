/**
 * fibertime-sp-auto-refresh.ts
 *
 * Fully automated Fibertime SharePoint cookie refresh.
 *
 * Flow:
 *   1. Launch headless Playwright, navigate to fibertime.com login
 *   2. Enter email → trigger OTP email
 *   3. Poll IMAP inbox for the OTP email (up to 2 min)
 *   4. Extract 6-digit code, type it in browser
 *   5. Wait for SharePoint redirect, save cookies
 *
 * Cron (nightly 22:00 SAST = 20:00 UTC — 30 min before OES sync):
 *   0 20 * * * sudo -u velo bash -c 'cd /home/velo/fibreflow-production && \
 *     xvfb-run -a /home/velo/.nvm/versions/node/v22.21.1/bin/node node_modules/.bin/tsx \
 *     scripts/fibertime-sp-auto-refresh.ts' \
 *     >> /home/velo/logs/fibertime-cookie-refresh.log 2>&1
 *
 * Required env vars (in .env.local):
 *   FIBERTIME_SP_COOKIE_FILE   — path to cookie JSON file
 *   FIBERTIME_IMAP_HOST        — mail.velocityfibre.co.za
 *   FIBERTIME_IMAP_USER        — reporting@velocityfibre.co.za
 *   FIBERTIME_IMAP_PASSWORD    — mailbox password
 */

import dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';

// Load .env then .env.local (local overrides) — mirrors Next.js behaviour
const appRoot = path.resolve(__dirname, '..');
dotenv.config({ path: path.join(appRoot, '.env') });
dotenv.config({ path: path.join(appRoot, '.env.local'), override: true });
import { chromium } from 'playwright';
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';

// Standalone script — use process.stdout/stderr directly (not Next.js logger)
function log(level: 'INFO' | 'WARN' | 'ERROR', msg: string, data?: Record<string, unknown>): void {
  const ts = new Date().toISOString();
  const line = data ? `${ts} [${level}] ${msg} ${JSON.stringify(data)}` : `${ts} [${level}] ${msg}`;
  if (level === 'ERROR') {
    process.stderr.write(line + '\n');
  } else {
    process.stdout.write(line + '\n');
  }
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const LOGIN_URL = 'https://fibertime.com/contractor-reports';
const SP_URL_FRAGMENT = 'isizweprojects.sharepoint.com/sites/FibertimeReports';
const LOGIN_EMAIL = 'reporting@velocityfibre.co.za';

const OTP_POLL_INTERVAL_MS = 5_000;
const OTP_POLL_TIMEOUT_MS = 2 * 60_000;
const SP_WAIT_TIMEOUT_MS = 3 * 60_000;

function requireEnv(name: string): string {
  const val = process.env[name];
  if (!val) {
    log('ERROR', `Missing required env var: ${name}`);
    process.exit(1);
  }
  return val;
}

// ---------------------------------------------------------------------------
// IMAP: fetch latest unread OTP from Fibertime
// ---------------------------------------------------------------------------

async function fetchOtpFromImap(since: Date): Promise<string | null> {
  const client = new ImapFlow({
    host: requireEnv('FIBERTIME_IMAP_HOST'),
    port: 993,
    secure: true,
    auth: {
      user: requireEnv('FIBERTIME_IMAP_USER'),
      pass: requireEnv('FIBERTIME_IMAP_PASSWORD'),
    },
    logger: false,
  });

  await client.connect();
  try {
    await client.mailboxOpen('INBOX');

    // IMAP SINCE is date-granularity only (matches whole day), so we also
    // filter by parsed.date to skip stale OTPs from earlier runs
    const sinceDate = new Date(since.getTime() - 30_000);
    const uids = await client.search({ since: sinceDate, unseen: true });

    for (const uid of uids.reverse()) {
      const msg = await client.fetchOne(String(uid), { source: true });
      if (!msg?.source) continue;

      const parsed = await simpleParser(msg.source);
      const subject = (parsed.subject ?? '').toLowerCase();
      const fromText = (parsed.from?.text ?? '').toLowerCase();
      // Subject/from filtering uses lowercase versions; code extraction uses parsed.text directly

      const isFibertime =
        subject.includes('fibertime') ||
        subject.includes('verification') ||
        subject.includes('otp') ||
        subject.includes('one-time') ||
        subject.includes('code') ||
        fromText.includes('fibertime') ||
        fromText.includes('noreply');

      if (!isFibertime) continue;

      // Skip emails sent before the trigger — prevents using stale OTPs
      if (parsed.date && parsed.date.getTime() < since.getTime() - 30_000) {
        log('INFO','Skipping stale OTP email', { subject: parsed.subject, uid, sentAt: parsed.date.toISOString() });
        continue;
      }

      // Extract verification code — Microsoft uses 8-digit codes for Fibertime tenant
      // Search plain text first to avoid matching numbers in HTML/CSS
      const textBody = parsed.text ?? '';
      const codeMatch =
        textBody.match(/verification code:\s*(\d{6,8})/i) ??
        textBody.match(/\b(\d{8})\b/) ??
        textBody.match(/\b(\d{6})\b/);
      if (codeMatch) {
        log('INFO','OTP found in email', { code: codeMatch[1], subject: parsed.subject, uid, sentAt: parsed.date?.toISOString() });
        // Mark as read so future runs won't pick it up
        await client.messageFlagsAdd(String(uid), ['\\Seen']);
        return codeMatch[1];
      }
    }

    return null;
  } finally {
    await client.logout();
  }
}

// ---------------------------------------------------------------------------
// Poll IMAP until OTP arrives
// ---------------------------------------------------------------------------

async function waitForOtp(triggerTime: Date): Promise<string> {
  const deadline = Date.now() + OTP_POLL_TIMEOUT_MS;
  log('INFO','Polling IMAP for OTP email...', { timeoutMs: OTP_POLL_TIMEOUT_MS });

  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, OTP_POLL_INTERVAL_MS));

    try {
      const code = await fetchOtpFromImap(triggerTime);
      if (code) return code;
      log('INFO','OTP not yet received, retrying...');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      log('WARN','IMAP poll error (will retry)', { error: msg });
    }
  }

  throw new Error('Timed out waiting for OTP email (2 min).');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const cookieFile = requireEnv('FIBERTIME_SP_COOKIE_FILE');

  log('INFO','=== Fibertime SharePoint Auto-Refresh starting ===');

  // Run headed via xvfb-run virtual display — Microsoft rejects headless Chromium OTPs
  // (navigator.webdriver detection). Headed on a virtual framebuffer passes as human.
  // Cron must wrap this script with: xvfb-run -a node ... (sets DISPLAY automatically)
  const browser = await chromium.launch({
    headless: false,
    args: [
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--disable-blink-features=AutomationControlled',
    ],
  });

  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    userAgent:
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  });

  // Hide webdriver flag — prevents Microsoft bot detection
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });

  const page = await context.newPage();

  try {
    // Step 1: Navigate to login
    log('INFO','Navigating to Fibertime login...');
    await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 });

    // Step 2: Enter email
    await page.waitForSelector('input[type="email"]', { timeout: 10_000 });
    await page.fill('input[type="email"]', LOGIN_EMAIL);
    log('INFO','Email entered');

    const triggerTime = new Date();

    const nextBtn = page.locator('input[type="submit"], button[type="submit"]').first();
    await nextBtn.waitFor({ state: 'visible', timeout: 5_000 });
    await nextBtn.click();
    log('INFO','Submitted email, awaiting OTP prompt...');

    // Step 3: Wait for OTP input field (30s — allow for slow page transitions)
    try {
      await page.waitForSelector(
        'input[type="tel"], input[name*="code"], input[name*="otp"], input[placeholder*="code"], input[autocomplete*="one-time"]',
        { timeout: 30_000 }
      );
    } catch {
      await page.screenshot({ path: '/tmp/fibertime-otp-timeout.png', fullPage: true });
      const pageText = await page.evaluate(() => document.body?.innerText?.substring(0, 300) ?? '');
      throw new Error(`OTP input not found after 30s. Page: ${pageText}`);
    }

    // Step 4: Fetch OTP from IMAP
    const otp = await waitForOtp(triggerTime);
    log('INFO','OTP received, entering in browser...');

    // Step 5: Enter OTP — clear field first, then type character-by-character to pass human-input checks
    const otpInput = page
      .locator(
        'input[type="tel"], input[name*="code"], input[name*="otp"], input[placeholder*="code"], input[autocomplete*="one-time"]'
      )
      .first();
    await otpInput.click();
    await otpInput.fill(''); // Clear any residual content from previous attempts
    for (const char of otp) {
      await otpInput.press(char);
      await new Promise(r => setTimeout(r, 80 + Math.random() * 120));
    }

    const submitBtn = page.locator('input[type="submit"], button[type="submit"]').first();
    if (await submitBtn.isVisible({ timeout: 2_000 })) {
      await submitBtn.click();
    }
    log('INFO','OTP submitted, waiting for SharePoint redirect...');

    // Step 6: Wait for page to load after OTP submission (5s), then check for OTP error
    await new Promise(r => setTimeout(r, 5_000));
    const otpErrorEl = page.locator('text=That code didn\'t work').first();
    const otpFailed = await otpErrorEl.isVisible({ timeout: 1_000 }).catch(() => false);
    if (otpFailed) {
      await page.screenshot({ path: '/tmp/fibertime-otp-rejected.png', fullPage: false });
      throw new Error('OTP rejected by Microsoft — code was likely stale or expired.');
    }

    // Step 7: Confirm SharePoint landing — handle KMSI + other MS prompts along the way
    const spDeadline = Date.now() + SP_WAIT_TIMEOUT_MS;
    let onSharePoint = false;
    let kmsiClicked = false;
    let unexpectedScreenshotTaken = false;

    while (Date.now() < spDeadline) {
      await new Promise(r => setTimeout(r, 3_000));
      const url = page.url();
      log('INFO','Checking URL...', { url: url.substring(0, 80) });

      if (
        url.includes(SP_URL_FRAGMENT) &&
        !url.includes('AccessDenied') &&
        !url.includes('login.microsoftonline.com')
      ) {
        onSharePoint = true;
        break;
      }

      // If we already clicked KMSI, don't click again — just wait for redirect chain to finish
      if (kmsiClicked) {
        log('INFO','Waiting for KMSI redirect chain...', { url: url.substring(0, 80) });
        continue;
      }

      // Detect KMSI page by its visible text — NOT by button ID alone.
      // Both OTP page and KMSI page share #idSIButton9; the text is the reliable differentiator.
      const kmsiHeading = page.locator('text=Stay signed in').first();
      const isKmsiPage = await kmsiHeading.isVisible({ timeout: 1_000 }).catch(() => false);

      if (isKmsiPage) {
        await page.screenshot({ path: '/tmp/fibertime-kmsi-before.png', fullPage: false });
        log('INFO','KMSI prompt detected — clicking Yes...');
        const kmsiYes = page.locator('#idSIButton9').first();
        await kmsiYes.click();
        kmsiClicked = true;
        // Wait for networkidle — the full redirect chain (MS token exchange → fibertime.com → SP) can take 20-30s
        await page.waitForLoadState('networkidle', { timeout: 60_000 }).catch(() => null);
        await page.screenshot({ path: '/tmp/fibertime-kmsi-after.png', fullPage: false });
        log('INFO','Post-KMSI state', { url: page.url().substring(0, 80) });
        continue;
      }

      // Take a diagnostic screenshot once (not every 3s)
      if (!unexpectedScreenshotTaken) {
        await page.screenshot({ path: '/tmp/fibertime-sp-wait.png', fullPage: false });
        log('INFO','Unexpected page screenshot saved', { url: url.substring(0, 80) });
        unexpectedScreenshotTaken = true;
      }
    }

    if (!onSharePoint) {
      throw new Error(`SharePoint redirect not detected. Final URL: ${page.url()}`);
    }

    // Step 7: Save cookies
    const cookies = await context.cookies();
    const cookieDir = path.dirname(cookieFile);
    if (!fs.existsSync(cookieDir)) fs.mkdirSync(cookieDir, { recursive: true });

    fs.writeFileSync(cookieFile, JSON.stringify(cookies, null, 2), 'utf-8');

    const spCookies = cookies.filter(c => c.domain.includes('sharepoint.com'));
    log('INFO','Cookies saved', {
      file: cookieFile,
      total: cookies.length,
      sharepoint: spCookies.length,
    });

    if (spCookies.length === 0) {
      throw new Error('No SharePoint cookies saved — login may not have completed.');
    }

    log('INFO','=== Cookie refresh complete ===');
    process.exit(0);
  } finally {
    await browser.close();
  }
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  log('ERROR','FATAL: Cookie refresh failed', { error: msg });
  process.exit(1);
});
