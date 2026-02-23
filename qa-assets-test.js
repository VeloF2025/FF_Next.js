const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const SCREENSHOTS_DIR = '/tmp/qa-screenshots';
const STAGING_URL = 'https://vf.fibreflow.app';
const EMAIL = 'hein@velocityfibre.co.za';
const PASSWORD = 'Mitzi@0203';

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runQA() {
  const report = {
    story: 'Assets Page - NextRouter Error Validation',
    url: STAGING_URL + '/assets',
    date: new Date().toISOString(),
    environment: 'staging',
    steps: [],
    consoleErrors: [],
    allConsoleMessages: []
  };

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage']
  });
  
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 }
  });
  
  const page = await context.newPage();
  
  // Collect console messages
  const consoleMessages = [];
  page.on('console', msg => {
    const text = msg.text();
    const type = msg.type();
    consoleMessages.push({ type, text });
    if (type === 'error' || text.toLowerCase().includes('nextrouter') || text.toLowerCase().includes('router was not mounted')) {
      report.consoleErrors.push({ type, text });
    }
  });
  
  page.on('pageerror', err => {
    const text = err.message || String(err);
    report.consoleErrors.push({ type: 'pageerror', text });
    consoleMessages.push({ type: 'pageerror', text });
  });

  // STEP 1: Navigate to assets page
  console.log('Step 1: Navigating to /assets...');
  let step1 = {
    step: 1,
    description: 'Navigate to https://vf.fibreflow.app/assets',
    action: 'Navigate to URL',
    expected: 'Page loads (may redirect to login/sign-in)',
    actual: '',
    result: 'PENDING',
    screenshot: ''
  };
  
  try {
    // Use domcontentloaded to avoid networkidle timeout with long-polling apps
    await page.goto(STAGING_URL + '/assets', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(3000);
    const currentUrl = page.url();
    const screenshotPath = path.join(SCREENSHOTS_DIR, 'step1-initial-navigation.png');
    await page.screenshot({ path: screenshotPath, fullPage: false });
    step1.screenshot = screenshotPath;
    step1.actual = `Navigated to: ${currentUrl}`;
    step1.result = 'PASS';
    console.log('  URL after navigation:', currentUrl);
  } catch (err) {
    step1.actual = `Error: ${err.message}`;
    step1.result = 'FAIL';
    console.error('  ERROR:', err.message);
  }
  report.steps.push(step1);

  // STEP 2: Check where we are
  const currentUrl = page.url();
  const screenshotPath2 = path.join(SCREENSHOTS_DIR, 'step2-initial-page.png');
  await page.screenshot({ path: screenshotPath2, fullPage: false });
  
  const isLoginPage = currentUrl.includes('/login') || currentUrl.includes('/auth') || 
                      currentUrl.includes('/signin') || currentUrl.includes('/sign-in');
  const isAssetsPage = currentUrl.includes('/assets');
  
  let step2 = {
    step: 2,
    description: 'Check if login redirect occurred',
    action: 'Check current URL and page state',
    expected: 'Either login/sign-in page or assets page',
    actual: `Current URL: ${currentUrl}. Is auth page: ${isLoginPage}. Is assets: ${isAssetsPage}`,
    result: (isLoginPage || isAssetsPage) ? 'PASS' : 'WARNING',
    screenshot: screenshotPath2
  };
  report.steps.push(step2);
  console.log('Step 2:', step2.actual);

  // STEP 3: Login if on auth page
  if (isLoginPage) {
    console.log('Step 3: On sign-in page, logging in...');
    let step3 = {
      step: 3,
      description: 'Login with credentials',
      action: 'Fill email and password, submit form',
      expected: 'Successful login',
      actual: '',
      result: 'PENDING',
      screenshot: ''
    };
    
    try {
      // Take screenshot of login form
      const screenshotPath3pre = path.join(SCREENSHOTS_DIR, 'step3a-login-form.png');
      await page.screenshot({ path: screenshotPath3pre, fullPage: false });
      
      // FibreFlow uses a two-step login (email first, then password)
      // Try filling email field
      const emailInput = await page.locator('input[type="email"], input[name="email"], input[placeholder*="email" i], input[placeholder*="Email" i]').first();
      await emailInput.fill(EMAIL);
      await sleep(500);
      
      // Look for Continue button or password field
      const continueBtn = page.locator('button:has-text("Continue"), button[type="submit"]').first();
      const continueExists = await continueBtn.count() > 0;
      
      if (continueExists) {
        await continueBtn.click();
        await sleep(2000);
      }
      
      // Now look for password field
      const passwordInput = await page.locator('input[type="password"]').first();
      const pwExists = await passwordInput.count() > 0;
      
      if (pwExists) {
        await passwordInput.fill(PASSWORD);
        await sleep(500);
        
        const screenshotPath3mid = path.join(SCREENSHOTS_DIR, 'step3b-password-filled.png');
        await page.screenshot({ path: screenshotPath3mid, fullPage: false });
        
        // Submit password
        await page.locator('button[type="submit"], button:has-text("Sign in"), button:has-text("Login"), button:has-text("Continue")').first().click();
      } else {
        // Maybe it's a single-step form
        await page.locator('button[type="submit"]').first().click();
      }
      
      // Wait for navigation
      try {
        await page.waitForURL(url => !url.includes('/sign-in') && !url.includes('/login'), { timeout: 15000 });
      } catch (e) {
        console.log('  Navigation timeout, checking current state...');
      }
      await sleep(3000);
      
      const urlAfterLogin = page.url();
      const screenshotPath3 = path.join(SCREENSHOTS_DIR, 'step3c-after-login.png');
      await page.screenshot({ path: screenshotPath3, fullPage: false });
      step3.screenshot = screenshotPath3;
      step3.actual = `URL after login: ${urlAfterLogin}`;
      step3.result = (!urlAfterLogin.includes('/sign-in') && !urlAfterLogin.includes('/login')) ? 'PASS' : 'FAIL';
      console.log('  After login URL:', urlAfterLogin);
    } catch (err) {
      step3.actual = `Error: ${err.message}`;
      step3.result = 'FAIL';
      console.error('  LOGIN ERROR:', err.message);
      const errScreenshot = path.join(SCREENSHOTS_DIR, 'step3-error.png');
      await page.screenshot({ path: errScreenshot, fullPage: false });
      step3.screenshot = errScreenshot;
    }
    report.steps.push(step3);
  } else {
    report.steps.push({
      step: 3,
      description: 'Login check',
      action: 'No login needed',
      expected: 'Already authenticated',
      actual: 'User already logged in or assets page directly accessible',
      result: 'PASS',
      screenshot: ''
    });
  }

  // STEP 4: Navigate to assets page if not already there
  const urlNow = page.url();
  let step4 = {
    step: 4,
    description: 'Navigate to /assets after authentication',
    action: 'Navigate to assets URL',
    expected: 'Assets page loads',
    actual: '',
    result: 'PENDING',
    screenshot: ''
  };
  
  if (!urlNow.includes('/assets')) {
    console.log('Step 4: Navigating to /assets...');
    try {
      await page.goto(STAGING_URL + '/assets', { waitUntil: 'domcontentloaded', timeout: 30000 });
      await sleep(4000);
    } catch (err) {
      console.log('  Navigation note:', err.message.substring(0, 100));
    }
  } else {
    console.log('Step 4: Already on /assets page');
  }
  
  await sleep(2000);
  const urlAfterNav = page.url();
  const screenshotPath4 = path.join(SCREENSHOTS_DIR, 'step4-assets-page.png');
  await page.screenshot({ path: screenshotPath4, fullPage: true });
  step4.screenshot = screenshotPath4;
  step4.actual = `URL: ${urlAfterNav}`;
  step4.result = urlAfterNav.includes('/assets') ? 'PASS' : 'FAIL';
  console.log('Step 4: URL now:', urlAfterNav);
  report.steps.push(step4);

  // STEP 5: Check for NextRouter error in console
  console.log('Step 5: Checking console for NextRouter errors...');
  
  const nextRouterErrors = report.consoleErrors.filter(e => 
    e.text.toLowerCase().includes('nextrouter') || 
    e.text.toLowerCase().includes('next router') ||
    e.text.toLowerCase().includes('router was not mounted') ||
    e.text.includes('No router instance found')
  );
  
  let step5 = {
    step: 5,
    description: 'Check console for NextRouter errors',
    action: 'Inspect browser console messages',
    expected: 'No "NextRouter was not mounted" errors',
    actual: '',
    result: 'PENDING',
    screenshot: ''
  };
  
  if (nextRouterErrors.length === 0) {
    step5.actual = `No NextRouter errors found in console. Total console errors collected: ${report.consoleErrors.length}`;
    step5.result = 'PASS';
  } else {
    step5.actual = 'NEXTROUTER ERRORS FOUND (' + nextRouterErrors.length + '): ' + nextRouterErrors.map(e => e.text).join(' | ');
    step5.result = 'FAIL';
  }
  
  console.log('Step 5:', step5.actual);
  report.steps.push(step5);

  // STEP 6: Verify Asset Dashboard content
  console.log('Step 6: Verifying Asset Dashboard content...');
  let step6 = {
    step: 6,
    description: 'Verify Asset Dashboard with stats',
    action: 'Check page content for dashboard elements',
    expected: 'Asset Dashboard with statistics visible',
    actual: '',
    result: 'PENDING',
    screenshot: ''
  };
  
  try {
    const pageText = await page.evaluate(() => document.body.innerText || '');
    const pageTitle = await page.title();
    
    const hasAssets = pageText.toLowerCase().includes('asset');
    const hasDashboard = pageText.toLowerCase().includes('dashboard') || 
                         pageText.toLowerCase().includes('total') ||
                         pageText.toLowerCase().includes('vehicles') ||
                         pageText.toLowerCase().includes('tools') ||
                         pageText.toLowerCase().includes('equipment') ||
                         pageText.toLowerCase().includes('fleet');
    const hasNextRouterErrorInText = pageText.toLowerCase().includes('nextrouter was not mounted') ||
                                      pageText.toLowerCase().includes('no router instance');
    
    const screenshotPath6 = path.join(SCREENSHOTS_DIR, 'step6-dashboard-viewport.png');
    await page.screenshot({ path: screenshotPath6, fullPage: false });
    step6.screenshot = screenshotPath6;
    
    const screenshotPath6full = path.join(SCREENSHOTS_DIR, 'step6-dashboard-fullpage.png');
    await page.screenshot({ path: screenshotPath6full, fullPage: true });
    
    step6.actual = `Page title: "${pageTitle}". Has asset content: ${hasAssets}. Has dashboard/stats: ${hasDashboard}. Has NextRouter error text on page: ${hasNextRouterErrorInText}. Page text (first 400 chars): "${pageText.substring(0, 400)}"`;
    
    if (hasNextRouterErrorInText) {
      step6.result = 'FAIL';
    } else if (hasAssets || hasDashboard) {
      step6.result = 'PASS';
    } else if (page.url().includes('/assets')) {
      step6.result = 'WARNING';
    } else {
      step6.result = 'FAIL';
    }
    
    console.log('Step 6: Title:', pageTitle);
    console.log('  Has assets:', hasAssets, '| Has dashboard:', hasDashboard, '| Has error text:', hasNextRouterErrorInText);
    console.log('  Page text preview:', pageText.substring(0, 400));
  } catch (err) {
    step6.actual = `Error checking content: ${err.message}`;
    step6.result = 'FAIL';
  }
  report.steps.push(step6);

  // Store all console messages
  report.allConsoleMessages = consoleMessages;
  
  const passed = report.steps.filter(s => s.result === 'PASS').length;
  const failed = report.steps.filter(s => s.result === 'FAIL').length;
  const warnings = report.steps.filter(s => s.result === 'WARNING').length;
  const overallResult = failed === 0 ? 'PASS' : 'FAIL';
  
  report.summary = { total: report.steps.length, passed, failed, warnings, result: overallResult };
  
  const reportPath = path.join(SCREENSHOTS_DIR, 'qa-report.json');
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  
  await browser.close();
  
  console.log('\n');
  console.log('============================================');
  console.log('  BROWSER QA REPORT');
  console.log('============================================');
  console.log('Story:', report.story);
  console.log('URL:', report.url);
  console.log('Date:', report.date);
  console.log('Environment: staging');
  console.log('--------------------------------------------');
  
  report.steps.forEach(step => {
    console.log(`\nStep ${step.step}: ${step.description}`);
    console.log(`  Action: ${step.action}`);
    console.log(`  Expected: ${step.expected}`);
    console.log(`  Actual: ${step.actual}`);
    console.log(`  Result: ${step.result}`);
    if (step.screenshot) console.log(`  Screenshot: ${step.screenshot}`);
  });
  
  console.log('\n--------------------------------------------');
  console.log('CONSOLE ERRORS CAPTURED:');
  const nonAuthErrors = report.consoleErrors.filter(e => !e.text.includes('401'));
  if (nonAuthErrors.length === 0) {
    console.log('  None (excluding expected 401 auth errors)');
  } else {
    nonAuthErrors.forEach(e => {
      console.log(`  [${e.type}] ${e.text}`);
    });
  }
  
  console.log('\nALL CONSOLE ERRORS (including 401s):', report.consoleErrors.length);
  
  console.log('\n--------------------------------------------');
  console.log('SUMMARY');
  console.log(`  Total Steps: ${report.summary.total}`);
  console.log(`  Passed: ${report.summary.passed}`);
  console.log(`  Failed: ${report.summary.failed}`);
  console.log(`  Warnings: ${report.summary.warnings}`);
  console.log(`  Overall Result: ${report.summary.result}`);
  console.log('============================================');
  
  return report;
}

runQA().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
