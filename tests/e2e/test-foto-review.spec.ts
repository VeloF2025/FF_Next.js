import { test, expect } from '@playwright/test';

test('foto-review page loads and shows images', async ({ page }) => {
  await page.goto('http://localhost:3005/photo-review');

  // Wait for page to load
  await page.waitForSelector('h1:has-text("Photo Review")');

  // Take screenshot
  await page.screenshot({ path: 'foto-review-screenshot.png', fullPage: true });

  // Check if DR list loaded
  const drCount = await page.locator('[role="navigation"] button').count();
  console.log(`Found ${drCount} DRs in the list`);

  // Click first DR
  if (drCount > 0) {
    await page.locator('[role="navigation"] button').first().click();
    await page.waitForTimeout(1000);

    // Check if photos loaded
    const photoCount = await page.locator('[role="list"] img, [role="list"] button').count();
    console.log(`Found ${photoCount} photos`);

    // Take screenshot of selected DR
    await page.screenshot({ path: 'foto-review-with-dr.png', fullPage: true });
  }

  // Check console errors
  const errors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') {
      errors.push(msg.text());
    }
  });

  console.log('Console errors:', errors);
});
