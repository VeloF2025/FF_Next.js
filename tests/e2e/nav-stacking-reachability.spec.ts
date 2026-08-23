import { test, expect, type Locator, type Page } from '@playwright/test';

/**
 * Stacking-order reachability regression tests.
 *
 * These assert that a control is *hit-testable* — that a tap at its centre
 * actually lands on it — not merely that it is present in the DOM. A
 * `getByText()` assertion passes happily on an element buried under the module
 * nav strip, which is exactly how the original defect shipped.
 *
 * Root cause guarded here: <main> in AppLayout must NOT carry a z-index.
 * A z-index there makes it a stacking context, trapping every descendant —
 * including `fixed inset-0 z-50` modals — under the module nav's z-30.
 */

const MOBILE = { width: 390, height: 844 };
const DESKTOP = { width: 1280, height: 800 };

interface HitResult {
  reachable: boolean;
  /** Tag + text of whatever actually sits at the control's centre point. */
  topmost: string;
}

/** Hit-tests `target`: does a tap at its centre land on it (or a descendant)? */
async function hitTest(target: Locator): Promise<HitResult> {
  const handle = await target.elementHandle();
  if (!handle) return { reachable: false, topmost: 'MISSING' };
  return handle.evaluate((el) => {
    const box = el.getBoundingClientRect();
    if (box.width === 0 || box.height === 0) return { reachable: false, topmost: 'ZERO_SIZE' };
    const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
    if (!hit) return { reachable: false, topmost: 'NOTHING' };
    const reachable = hit === el || el.contains(hit) || hit.contains(el);
    return { reachable, topmost: `${hit.tagName} "${(hit.textContent || '').trim().slice(0, 40)}"` };
  });
}

/** Fails loudly if the app bounced us to login instead of rendering the page. */
async function expectAppShell(page: Page) {
  await expect(page.locator('main')).toBeAttached({ timeout: 30_000 });
}

test.describe('Fleet module nav does not bury overlays', () => {
  test('<main> establishes no stacking context', async ({ page }) => {
    await page.goto('/fleet/vehicles', { waitUntil: 'domcontentloaded' });
    await expectAppShell(page);

    const mainZ = await page.locator('main').evaluate((el) => getComputedStyle(el).zIndex);
    // 'auto' means no stacking context — descendant modals compete at the root,
    // where their z-50 can actually beat the module nav's z-30.
    expect(mainZ).toBe('auto');
  });

  test('theme dropdown "Light" option is reachable on a Fleet page', async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await page.goto('/fleet/vehicles', { waitUntil: 'domcontentloaded' });
    await expectAppShell(page);

    const toggle = page.locator('header button[title*="theme" i]').first();
    await toggle.waitFor({ state: 'visible', timeout: 30_000 });
    await toggle.click();

    const light = page.locator('header button').filter({ hasText: /^Light/ }).first();
    await expect(light).toBeVisible();

    const result = await hitTest(light);
    await page.screenshot({ path: 'tests/e2e-results/stacking-theme-desktop.png' });
    expect(result.reachable, `topmost element at "Light": ${result.topmost}`).toBe(true);
  });

  test('theme dropdown "Light" option is reachable on mobile', async ({ page }) => {
    await page.setViewportSize(MOBILE);
    await page.goto('/fleet/vehicles', { waitUntil: 'domcontentloaded' });
    await expectAppShell(page);

    const toggle = page.locator('header button[title*="theme" i]').first();
    await toggle.waitFor({ state: 'visible', timeout: 30_000 });
    await toggle.click();

    const light = page.locator('header button').filter({ hasText: /^Light/ }).first();
    await expect(light).toBeVisible();

    const result = await hitTest(light);
    await page.screenshot({ path: 'tests/e2e-results/stacking-theme-mobile.png' });
    expect(result.reachable, `topmost element at "Light": ${result.topmost}`).toBe(true);
  });

  test('a page modal paints above the module nav strip on mobile', async ({ page }) => {
    await page.setViewportSize(MOBILE);
    await page.goto('/fleet/incidents', { waitUntil: 'domcontentloaded' });
    await expectAppShell(page);

    const settings = page.getByRole('button', { name: /settings/i }).first();
    await settings.waitFor({ state: 'visible', timeout: 30_000 });
    await settings.click();

    const dialog = page.getByRole('dialog').first();
    await expect(dialog).toBeVisible();

    // Every button the dialog offers must be tappable, Close included. Under the
    // original defect the nav strip intercepted taps on the topmost dialog rows.
    const buttons = dialog.locator('button');
    const count = await buttons.count();
    expect(count).toBeGreaterThan(0);

    const unreachable: string[] = [];
    for (let i = 0; i < count; i += 1) {
      const btn = buttons.nth(i);
      if (!(await btn.isVisible())) continue;
      const result = await hitTest(btn);
      if (!result.reachable) {
        unreachable.push(`"${(await btn.textContent())?.trim()}" blocked by ${result.topmost}`);
      }
    }

    await page.screenshot({ path: 'tests/e2e-results/stacking-dialog-mobile.png' });
    expect(unreachable, `unreachable dialog controls: ${unreachable.join(' | ')}`).toEqual([]);
  });
});

test.describe('Floating chat widget does not sit on page content', () => {
  test('parks bottom-right by default, leaving the leading edge of bottom bars readable', async ({ page }) => {
    // Simulate a viewer with no stored widget position.
    await page.addInitScript(() => {
      try { localStorage.removeItem('ff-chat-widget'); } catch { /* storage blocked */ }
    });
    await page.setViewportSize(DESKTOP);
    await page.goto('/fleet/map', { waitUntil: 'domcontentloaded' });
    await expectAppShell(page);

    const chatBtn = page.locator('button[title*="Ask Velo" i]').first();
    await chatBtn.waitFor({ state: 'visible', timeout: 30_000 });

    const centreX = await chatBtn.evaluate((el) => {
      const box = el.getBoundingClientRect();
      return box.left + box.width / 2;
    });
    // Bottom-LEFT was the defect: it covered the leading label of every
    // full-width bottom bar. Anywhere in the right half is acceptable.
    expect(centreX).toBeGreaterThan(DESKTOP.width / 2);

    // If the map is currently rendering its "Not on the map:" bar, its leading
    // label must be readable rather than sitting under the widget.
    const label = page.locator('aside', { hasText: 'Not on the map:' }).locator('strong').first();
    if (await label.count()) {
      const result = await hitTest(label);
      expect(result.reachable, `topmost element at "Not on the map:": ${result.topmost}`).toBe(true);
    }

    await page.screenshot({ path: 'tests/e2e-results/stacking-chat-widget-map.png' });
  });
});
