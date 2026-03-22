import { chromium } from 'playwright';

function getLuminance(r, g, b) {
  const [rs, gs, bs] = [r, g, b].map(v => {
    v = v / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}

function rgbToValues(rgb) {
  const match = rgb.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  return match ? [parseInt(match[1]), parseInt(match[2]), parseInt(match[3])] : null;
}

function getContrast(fg, bg) {
  const fgVals = rgbToValues(fg);
  const bgVals = rgbToValues(bg);
  if (!fgVals || !bgVals) return null;
  
  const l1 = getLuminance(...fgVals);
  const l2 = getLuminance(...bgVals);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return ((lighter + 0.05) / (darker + 0.05)).toFixed(2);
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();

  try {
    console.log('=== CONDUIT PAGE AUDIT ===\n');
    
    await page.goto('http://localhost:3005/conduit', { waitUntil: 'load', timeout: 15000 });
    await page.waitForTimeout(3000);
    
    console.log('📱 SCREENSHOT: Dark Mode');
    await page.screenshot({ path: '/tmp/conduit-dark.png', fullPage: true });
    console.log('✓ Saved to /tmp/conduit-dark.png\n');
    
    console.log('🎨 CONTRAST RATIO ANALYSIS');
    const contrastResults = await page.evaluate(() => {
      const results = [];
      
      const editableCells = document.querySelectorAll('td[class*="bg-gray-800"] span.text-gray-300');
      if (editableCells.length > 0) {
        const elem = editableCells[0];
        const tdBg = window.getComputedStyle(elem.closest('td')).backgroundColor;
        const spanFg = window.getComputedStyle(elem).color;
        results.push({
          component: 'EditableCell (rest state)',
          foreground: spanFg,
          background: tdBg,
          class: 'text-gray-300 on bg-gray-800/60'
        });
      }
      
      const labels = document.querySelectorAll('label.text-gray-400');
      if (labels.length > 0) {
        const elem = labels[0];
        const fg = window.getComputedStyle(elem).color;
        const bg = window.getComputedStyle(elem.closest('div') || document.body).backgroundColor;
        results.push({
          component: 'Form Label',
          foreground: fg,
          background: bg,
          class: 'text-gray-400 on bg-gray-900'
        });
      }
      
      const kpiValues = document.querySelectorAll('[class*="rounded-lg"][class*="bg-gray-800"] .text-white');
      if (kpiValues.length > 0) {
        const span = kpiValues[0];
        const fg = window.getComputedStyle(span).color;
        const bg = window.getComputedStyle(span.closest('[class*="bg-gray-800"]')).backgroundColor;
        results.push({
          component: 'KPI Tile Value',
          foreground: fg,
          background: bg,
          class: 'text-white on bg-gray-800'
        });
      }
      
      const formInputs = document.querySelectorAll('input.text-white[class*="bg-gray-900"]');
      if (formInputs.length > 0) {
        const elem = formInputs[0];
        const bg = window.getComputedStyle(elem).backgroundColor;
        const fg = window.getComputedStyle(elem).color;
        results.push({
          component: 'Form Input',
          foreground: fg,
          background: bg,
          class: 'text-white on bg-gray-900'
        });
      }
      
      const thElements = document.querySelectorAll('th.text-white');
      if (thElements.length > 0) {
        const elem = thElements[0];
        const fg = window.getComputedStyle(elem).color;
        const bg = window.getComputedStyle(elem).backgroundColor;
        results.push({
          component: 'Table Header (th)',
          foreground: fg,
          background: bg,
          class: 'text-white on #1a3a4a'
        });
      }
      
      return results;
    });
    
    console.log('Contrast Measurements:\n');
    contrastResults.forEach(r => {
      const contrast = getContrast(r.foreground, r.background);
      const status = contrast >= 4.5 ? '✓' : '❌';
      const wcag = contrast >= 7 ? 'AAA' : contrast >= 4.5 ? 'AA' : 'FAIL';
      console.log(`${status} ${r.component}`);
      console.log(`   Class: ${r.class}`);
      console.log(`   FG: ${r.foreground} | BG: ${r.background}`);
      console.log(`   Contrast Ratio: ${contrast}:1 (WCAG ${wcag}) - Need 4.5:1 minimum\n`);
    });
    
    console.log('⌨️  KEYBOARD NAVIGATION TEST');
    const focusChain = await page.evaluate(() => {
      const allButtons = Array.from(document.querySelectorAll('button'));
      const allInputs = Array.from(document.querySelectorAll('input'));
      const allTabbable = [...allButtons, ...allInputs].filter(el => {
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      });
      
      return {
        totalButtons: allButtons.length,
        totalInputs: allInputs.length,
        totalTabbableElements: allTabbable.length,
        sampleElements: allTabbable.slice(0, 10).map(el => ({
          tag: el.tagName,
          text: el.textContent?.substring(0, 20) || el.value?.substring(0, 20) || el.id || '(unnamed)',
          hasAriaLabel: !!el.getAttribute('aria-label')
        }))
      };
    });
    
    console.log(`Total tabbable elements: ${focusChain.totalTabbableElements}`);
    console.log(`  - Buttons: ${focusChain.totalButtons}, Inputs: ${focusChain.totalInputs}\n`);
    focusChain.sampleElements.forEach((el, i) => {
      const aria = el.hasAriaLabel ? ' [aria-label: ✓]' : '';
      console.log(`  ${i + 1}. <${el.tag.toLowerCase()}> ${el.text}${aria}`);
    });
    
    console.log('\n🏷️  FORM FIELD ASSOCIATION CHECK');
    const formCheck = await page.evaluate(() => {
      const inputs = Array.from(document.querySelectorAll('input'));
      return inputs.map((input, idx) => {
        const id = input.id;
        const placeholder = input.placeholder;
        const ariaLabel = input.getAttribute('aria-label');
        const labelFor = id ? document.querySelector(`label[for="${id}"]`) : null;
        
        return {
          index: idx,
          type: input.type,
          placeholder: placeholder || '(none)',
          hasLabel: !!labelFor,
          hasAriaLabel: !!ariaLabel,
          status: labelFor || ariaLabel || placeholder ? '✓' : '❌'
        };
      });
    });
    
    console.log(`Total inputs: ${formCheck.length}\n`);
    formCheck.forEach(f => {
      console.log(`${f.status} [${f.index + 1}] ${f.type}: ${f.placeholder} (Label: ${f.hasLabel ? '✓' : '❌'} Aria: ${f.hasAriaLabel ? '✓' : '❌'})`);
    });
    
    console.log('\n📊 TABLE HEADER SCOPE CHECK');
    const tableCheck = await page.evaluate(() => {
      const tables = Array.from(document.querySelectorAll('table'));
      return tables.map((table, tIdx) => {
        const headers = Array.from(table.querySelectorAll('th'));
        return {
          index: tIdx,
          headerCount: headers.length,
          allHaveScope: headers.every(h => h.getAttribute('scope')),
          headers: headers.slice(0, 3).map(h => ({
            text: h.textContent?.trim().substring(0, 20),
            scope: h.getAttribute('scope') || '(missing)'
          }))
        };
      });
    });
    
    tableCheck.forEach(t => {
      const status = t.allHaveScope ? '✓' : '❌';
      console.log(`${status} Table ${t.index + 1}: ${t.headerCount} headers - ${t.allHaveScope ? 'All scoped' : 'MISSING SCOPE'}`);
    });
    
    console.log('\n📱 RESPONSIVE DESIGN CHECK (375px mobile)');
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('http://localhost:3005/conduit', { waitUntil: 'load' });
    await page.waitForTimeout(2000);
    
    const responsiveCheck = await page.evaluate(() => {
      const htmlWidth = document.documentElement.scrollWidth;
      const windowWidth = window.innerWidth;
      const overflow = htmlWidth > windowWidth + 10;
      
      const buttons = Array.from(document.querySelectorAll('button'));
      const smallTargets = buttons.filter(el => {
        const rect = el.getBoundingClientRect();
        return rect.height < 44 || rect.width < 44;
      });
      
      return {
        htmlWidth,
        windowWidth,
        overflow,
        smallTouchTargets: smallTargets.length,
        totalButtons: buttons.length
      };
    });
    
    console.log(`Viewport: 375px | Document width: ${responsiveCheck.htmlWidth}px`);
    const overflowStatus = responsiveCheck.overflow ? '❌ YES' : '✓ NO';
    console.log(`Horizontal overflow: ${overflowStatus}`);
    const touchStatus = responsiveCheck.smallTouchTargets > 0 ? '❌' : '✓';
    console.log(`${touchStatus} Small touch targets (< 44px): ${responsiveCheck.smallTouchTargets} of ${responsiveCheck.totalButtons}`);
    
    console.log('\n📱 SCREENSHOT: Mobile View (375px)');
    await page.screenshot({ path: '/tmp/conduit-mobile.png', fullPage: true });
    console.log('✓ Saved to /tmp/conduit-mobile.png');

  } catch (err) {
    console.error('❌ Error:', err.message);
    process.exit(1);
  } finally {
    await browser.close();
  }
})();
