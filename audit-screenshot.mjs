import { chromium } from 'playwright';

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();

  try {
    console.log('Capturing screenshots...');
    
    // Dark mode (default)
    await page.goto('http://localhost:3005/conduit', { waitUntil: 'load' });
    await page.waitForTimeout(2000);
    await page.screenshot({ path: '/tmp/conduit-dark.png', fullPage: true });
    console.log('✓ Dark mode: /tmp/conduit-dark.png');
    
    // Mobile view
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('http://localhost:3005/conduit', { waitUntil: 'load' });
    await page.waitForTimeout(2000);
    await page.screenshot({ path: '/tmp/conduit-mobile.png', fullPage: true });
    console.log('✓ Mobile (375px): /tmp/conduit-mobile.png');
    
  } finally {
    await browser.close();
  }
})();
