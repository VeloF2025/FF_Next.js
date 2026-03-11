/**
 * Run ALL smoke test stories against FibreFlow.
 * Reads from .claude/user-stories/*-smoke.md and validates each page loads.
 *
 * Usage: node run-smoke-tests.mjs [base-url] [--priority Critical,High] [--parallel 3]
 */
import { chromium } from '/tmp/playwright-auth/node_modules/playwright/index.mjs';
import { readdirSync, readFileSync, mkdirSync } from 'fs';
import { join } from 'path';

const baseUrl = process.argv[2] || 'https://dev.fibreflow.app';
const AUTH_STATE = '/tmp/playwright-auth/auth.json';
const SCREENSHOT_DIR = '/tmp/qa-screenshots';
const STORIES_DIR = process.env.STORIES_DIR || '.claude/user-stories';

mkdirSync(SCREENSHOT_DIR, { recursive: true });

// Parse --priority filter
const priIdx = process.argv.indexOf('--priority');
const priorityFilter = priIdx >= 0 ? process.argv[priIdx + 1].split(',') : null;

// Parse --parallel
const parIdx = process.argv.indexOf('--parallel');
const BATCH_SIZE = parIdx >= 0 ? parseInt(process.argv[parIdx + 1]) : 5;

// Load all smoke stories
const storyFiles = readdirSync(STORIES_DIR)
  .filter(f => f.endsWith('-smoke.md'))
  .map(f => {
    const content = readFileSync(join(STORIES_DIR, f), 'utf-8');
    const urlMatch = content.match(/\*\*URL\*\*:\s*(.+)/);
    const priorityMatch = content.match(/\*\*Priority\*\*:\s*(.+)/);
    const moduleMatch = content.match(/\*\*Module\*\*:\s*(.+)/);
    return {
      name: f.replace('.md', ''),
      url: urlMatch ? urlMatch[1].trim() : null,
      priority: priorityMatch ? priorityMatch[1].trim() : 'Low',
      module: moduleMatch ? moduleMatch[1].trim() : 'Unknown',
    };
  })
  .filter(s => s.url)
  .filter(s => !priorityFilter || priorityFilter.includes(s.priority));

// Also load workflow stories (non-smoke)
const workflowFiles = readdirSync(STORIES_DIR)
  .filter(f => f.endsWith('.md') && !f.endsWith('-smoke.md') && f !== 'README.md' && f !== '_manifest.json')
  .map(f => {
    const content = readFileSync(join(STORIES_DIR, f), 'utf-8');
    const urlMatch = content.match(/\*\*URL\*\*:\s*(.+)/);
    const priorityMatch = content.match(/\*\*Priority\*\*:\s*(.+)/);
    return {
      name: f.replace('.md', ''),
      url: urlMatch ? urlMatch[1].trim() : null,
      priority: priorityMatch ? priorityMatch[1].trim() : 'Medium',
      type: 'workflow',
    };
  })
  .filter(s => s.url)
  .filter(s => !priorityFilter || priorityFilter.includes(s.priority));

console.log(`Running ${storyFiles.length} smoke tests + ${workflowFiles.length} workflow stories (${BATCH_SIZE} parallel)\n`);

async function runSmokeTest(story) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    storageState: AUTH_STATE,
    viewport: { width: 1440, height: 900 },
  });
  const page = await context.newPage();
  const consoleErrors = [];
  page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });

  const result = { name: story.name, url: story.url, priority: story.priority, steps: [] };

  try {
    // Step 1: Navigate
    await page.goto(`${baseUrl}${story.url}`, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForTimeout(3000);

    const finalUrl = page.url();
    if (finalUrl.includes('/sign-in') || finalUrl.includes('/login')) {
      result.steps.push({ name: 'Navigate', status: 'FAIL', error: 'Redirected to login' });
      await browser.close();
      return result;
    }
    result.steps.push({ name: 'Navigate', status: 'PASS' });

    // Step 2: Content renders
    const bodyText = await page.locator('body').innerText();
    const hasContent = bodyText.trim().length > 50;
    result.steps.push({ name: 'Content', status: hasContent ? 'PASS' : 'FAIL', error: hasContent ? null : 'Page appears empty' });

    // Step 3: No data errors
    const hasNaN = bodyText.includes('NaN');
    const hasUndef = /\bundefined\b/.test(bodyText);
    const hasObj = bodyText.includes('[object Object]');
    const dataOk = !hasNaN && !hasUndef && !hasObj;
    result.steps.push({ name: 'No data errors', status: dataOk ? 'PASS' : 'FAIL', error: dataOk ? null : `NaN:${hasNaN} undef:${hasUndef} obj:${hasObj}` });

    // Step 4: Console errors
    const hasErrors = consoleErrors.length > 0;
    result.steps.push({ name: 'Console clean', status: hasErrors ? 'WARN' : 'PASS', error: hasErrors ? `${consoleErrors.length} errors` : null });

    // Screenshot on failure
    if (result.steps.some(s => s.status === 'FAIL')) {
      await page.screenshot({ path: `${SCREENSHOT_DIR}/${story.name}-fail.png` });
    }

  } catch (err) {
    result.steps.push({ name: 'Navigate', status: 'FAIL', error: err.message.substring(0, 80) });
    try { await page.screenshot({ path: `${SCREENSHOT_DIR}/${story.name}-error.png` }); } catch {}
  }

  await browser.close();
  return result;
}

// Run in batches
const allResults = [];
for (let i = 0; i < storyFiles.length; i += BATCH_SIZE) {
  const batch = storyFiles.slice(i, i + BATCH_SIZE);
  const batchResults = await Promise.all(batch.map(s => runSmokeTest(s)));
  allResults.push(...batchResults);
  process.stdout.write(`  Batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(storyFiles.length / BATCH_SIZE)} complete (${allResults.length}/${storyFiles.length})\r`);
}
console.log('');

// Report
const passed = allResults.filter(r => r.steps.every(s => s.status !== 'FAIL'));
const failed = allResults.filter(r => r.steps.some(s => s.status === 'FAIL'));
const warned = allResults.filter(r => r.steps.some(s => s.status === 'WARN') && !r.steps.some(s => s.status === 'FAIL'));

console.log('\n╔══════════════════════════════════════════════════════════════╗');
console.log('║                  SMOKE TEST RESULTS                         ║');
console.log('╠══════════════════════════════════════════════════════════════╣');
console.log(`║ Environment: ${baseUrl.padEnd(46)}║`);
console.log(`║ Pages tested: ${String(allResults.length).padEnd(44)}║`);
console.log(`║ Date: ${new Date().toISOString().split('T')[0].padEnd(53)}║`);
console.log('╠══════════════════════════════════════════════════════════════╣');
console.log(`║ PASS: ${String(passed.length).padEnd(5)} WARN: ${String(warned.length).padEnd(5)} FAIL: ${String(failed.length).padEnd(22)}║`);

if (failed.length > 0) {
  console.log('╠══════════════════════════════════════════════════════════════╣');
  console.log('║ FAILURES:                                                    ║');
  for (const r of failed) {
    const failStep = r.steps.find(s => s.status === 'FAIL');
    console.log(`║  ${r.name.substring(0, 30).padEnd(30)} ${(failStep?.error || '').substring(0, 27).padEnd(27)}║`);
  }
}

if (warned.length > 0 && warned.length <= 10) {
  console.log('╠══════════════════════════════════════════════════════════════╣');
  console.log('║ WARNINGS (console errors):                                   ║');
  for (const r of warned) {
    console.log(`║  ${r.name.substring(0, 55).padEnd(57)}║`);
  }
}

console.log('╚══════════════════════════════════════════════════════════════╝');

process.exit(failed.length > 0 ? 1 : 0);
