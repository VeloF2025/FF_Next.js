/**
 * Mints an Ituran session by driving a real browser.
 *
 * DO NOT IMPORT THIS FROM THE NEXT.JS APP. Playwright is a devDependency and
 * pulling it into a route bundle would break the production build. Only
 * scripts/poll-ituran-tracking.ts imports this; the client takes the minted
 * session as data.
 *
 * Three findings from the live portal (2026-08-07), each of which cost an
 * attempt to discover:
 *
 *  1. `channel: 'chromium'` is REQUIRED. Playwright's default headless build is
 *     the headless *shell*, which the Reblaze challenge detects and never
 *     clears — it just serves the puzzle forever. The full Chromium build under
 *     the new headless mode clears it in ~1.6s. This is the difference between
 *     "works unattended" and "needs a human", so do not "simplify" the channel
 *     away.
 *  2. Submitting with Enter does nothing. The form is ASP.NET WebForms and the
 *     postback is wired to the button, so the click must land on #btnLogin.
 *  3. A wrong password does NOT throw — the portal re-serves the login page
 *     with an inline message. Success is therefore asserted positively, by
 *     having navigated away and holding a token, never by absence of an error.
 */
import { log } from '@/lib/logger';
import { BROWSER_UA, type IturanSession } from './client';

/** Long enough for the challenge (~2s observed) plus a slow login. */
const NAV_TIMEOUT_MS = 60_000;
const FORM_TIMEOUT_MS = 45_000;

export interface MintOptions {
  baseUrl: string;
  username: string;
  password: string;
  /** Overridable for a headful debug run. */
  headless?: boolean;
}

const USER_SELECTOR = '#txt_username, input[name="txt_username"]';
const PASS_SELECTOR = '#txt_password, input[name="txt_password"]';
const SUBMIT_SELECTOR = '#btnLogin, input[name="btnLogin"]';
/** The login token the app puts in the page and sends back as PassEnc. */
const TOKEN_RE = /tok-[A-Za-z0-9_-]+/;

export async function mintIturanSession(opts: MintOptions): Promise<IturanSession> {
  // Imported lazily and by a computed specifier so that neither the Next.js
  // bundler nor a stray `import` of this module's siblings can pull Playwright
  // into a server bundle.
  const specifier = 'playwright';
  const { chromium } = (await import(/* webpackIgnore: true */ specifier)) as typeof import('playwright');

  const base = opts.baseUrl.replace(/\/+$/, '');
  const loginUrl = `${base}/iweb2/Login.aspx?Culture=en-US&cid=soltrack&v=2018-01-10`;

  const browser = await chromium.launch({
    headless: opts.headless ?? true,
    // See note 1 above — the headless shell never clears the challenge.
    channel: 'chromium',
    args: ['--disable-blink-features=AutomationControlled'],
  });
  try {
    const ctx = await browser.newContext({
      locale: 'en-ZA',
      timezoneId: 'Africa/Johannesburg',
      viewport: { width: 1440, height: 900 },
      // REQUIRED. Even under the full chromium channel, headless mode still
      // advertises "HeadlessChrome/..." in its UA, and the challenge refuses to
      // clear for it — the failure looks exactly like a missing browser build.
      // Overriding the UA is what makes the mint work unattended.
      userAgent: BROWSER_UA,
    });
    const page = await ctx.newPage();
    await page.goto(loginUrl, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });

    // The challenge computes its cookie then replaces the document. Waiting for
    // the real form is the only reliable signal that it cleared; a fixed sleep
    // races it.
    try {
      await page.waitForSelector(USER_SELECTOR, { timeout: FORM_TIMEOUT_MS });
    } catch {
      throw new Error(
        'bot challenge did not clear — login form never appeared ' +
          '(check that the full chromium channel is installed, not the headless shell)'
      );
    }

    await page.fill(USER_SELECTOR, opts.username);
    await page.fill(PASS_SELECTOR, opts.password);
    await Promise.all([
      page.waitForNavigation({ timeout: NAV_TIMEOUT_MS }).catch(() => undefined),
      page.click(SUBMIT_SELECTOR),
    ]);

    const token = await page.evaluate((re: string) => {
      const m = document.documentElement.innerHTML.match(new RegExp(re));
      return m ? m[0] : null;
    }, TOKEN_RE.source);

    const waap = (await ctx.cookies()).find((c) => c.name === 'waap_id');

    // Assert success positively. A rejected login re-serves Login.aspx with an
    // inline message and no token, which would otherwise flow onward as an
    // empty session and surface much later as an unexplained 'LoginError!'.
    if (!token || !waap?.value) {
      const message = await page
        .evaluate(() => document.body.innerText.replace(/\s+/g, ' ').trim().slice(0, 200))
        .catch(() => '');
      throw new Error(
        `login did not yield a session (token=${Boolean(token)}, waap_id=${Boolean(waap?.value)}); ` +
          `page said: ${message || '(unreadable)'}`
      );
    }

    log.info('[ituran] session minted', {
      url: page.url(),
      waapIdChars: waap.value.length,
    });
    return { waapId: waap.value, passEnc: token };
  } finally {
    await browser.close().catch(() => undefined);
  }
}
