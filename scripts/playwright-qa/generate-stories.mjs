/**
 * FibreFlow User Story Auto-Generator
 *
 * Scans pages/ directory for UI routes and generates smoke test stories
 * for any route that doesn't already have a story.
 *
 * Usage:
 *   node scripts/playwright-qa/generate-stories.mjs [--dry-run] [--force]
 *
 * Options:
 *   --dry-run   Show what would be generated without writing files
 *   --force     Overwrite existing smoke stories (not workflow stories)
 */
import { readdirSync, readFileSync, writeFileSync, existsSync, statSync } from 'fs';
import { join, relative, basename, dirname } from 'path';

const PROJECT_ROOT = process.cwd();
const PAGES_DIR = join(PROJECT_ROOT, 'pages');
const STORIES_DIR = join(PROJECT_ROOT, '.claude/user-stories');
const MANIFEST_PATH = join(STORIES_DIR, '_manifest.json');

const dryRun = process.argv.includes('--dry-run');
const force = process.argv.includes('--force');

// Routes to skip (not user-facing pages)
const SKIP_PATTERNS = [
  /^\/?api\//,           // API routes
  /^\/?_/,               // _app, _document
  /^\/?500/,             // Error pages
  /^\/?sign-in/,         // Auth pages
  /^\/?auth\//,          // Auth pages
  /^\/?test/,            // Test pages
  /^\/?privacy/,         // Legal
  /^\/?terms/,           // Legal
  /^\/?projects-wa-test/, // Test pages
  /^\/?livekit\//,       // Special integration
  /^\/?recordings\//,    // Special
  /^\/?test-realtime/,   // Test
  /^\/?migration-status/, // Internal
  /^\/?fibreflow$/,      // Marketing/splash
  /^\/?home$/,           // Redirect
  /^\/?index$/,          // Root redirect
];

// Module groupings for priority
const MODULE_PRIORITY = {
  dashboard: 'Critical',
  staff: 'Critical',
  projects: 'Critical',
  procurement: 'Critical',
  activate: 'Critical',
  fleet: 'High',
  maintenance: 'High',
  'construction-qa': 'High',
  pipeline: 'High',
  clients: 'High',
  suppliers: 'High',
  communications: 'Medium',
  'health-safety': 'Medium',
  onemap: 'Medium',
  sow: 'Medium',
  analytics: 'Medium',
  system: 'Medium',
  settings: 'Low',
  profile: 'Low',
  admin: 'Low',
};

function scanPageRoutes() {
  const routes = [];

  function walk(dir, routePrefix = '') {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'api' || entry.name.startsWith('_')) continue;
        walk(fullPath, `${routePrefix}/${entry.name}`);
      } else if (entry.name.endsWith('.tsx') && !entry.name.startsWith('_')) {
        const routeName = entry.name.replace('.tsx', '');
        const route = routeName === 'index'
          ? routePrefix || '/'
          : `${routePrefix}/${routeName}`;
        routes.push({
          route,
          filePath: fullPath,
          mtime: statSync(fullPath).mtime,
        });
      }
    }
  }

  walk(PAGES_DIR);
  return routes.filter(r => !SKIP_PATTERNS.some(p => p.test(r.route)));
}

function getModule(route) {
  const parts = route.split('/').filter(Boolean);
  if (parts.length === 0) return 'dashboard';
  // Map human-resources → staff
  if (parts[0] === 'human-resources') return 'staff';
  return parts[0];
}

function getStoryName(route) {
  const parts = route.split('/').filter(Boolean);
  if (parts.length === 0) return 'dashboard-smoke';

  // For index pages: module-smoke
  // For sub-pages: module-subpage-smoke
  const clean = parts
    .filter(p => !p.startsWith('[') && p !== 'index')
    .join('-');
  return `${clean || parts[0]}-smoke`;
}

function generateSmokeStory(route, module) {
  const displayRoute = route || '/';
  const moduleName = module.charAt(0).toUpperCase() + module.slice(1);
  const priority = MODULE_PRIORITY[module] || 'Low';
  const storyName = getStoryName(route);

  // For dynamic routes like [id], skip auto-generation
  if (route.includes('[')) return null;

  return {
    name: storyName,
    content: `# ${moduleName} — ${displayRoute}

**URL**: ${displayRoute}
**Preconditions**: User is logged in
**Priority**: ${priority}
**Module**: ${moduleName}
**Type**: smoke (auto-generated)

## Steps

1. **Navigate to page**
   - Action: navigate to ${displayRoute}
   - Expect: Page loads without redirecting to login

2. **Verify content renders**
   - Action: check page body for content
   - Expect: Page has visible content (not blank or empty state only)

3. **No data errors**
   - Action: check page text for NaN, undefined, [object Object]
   - Expect: None of these error strings present in page content

4. **No console errors**
   - Action: check browser console
   - Expect: No JavaScript errors logged
`,
    route: displayRoute,
    module,
    priority,
    type: 'smoke',
  };
}

function loadManifest() {
  if (existsSync(MANIFEST_PATH)) {
    return JSON.parse(readFileSync(MANIFEST_PATH, 'utf-8'));
  }
  return {};
}

function saveManifest(manifest) {
  writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + '\n');
}

// ============================================
//  MAIN
// ============================================

console.log('Scanning page routes...');
const routes = scanPageRoutes();
console.log(`Found ${routes.length} UI routes\n`);

// Load existing stories
const existingStories = new Set();
if (existsSync(STORIES_DIR)) {
  readdirSync(STORIES_DIR)
    .filter(f => f.endsWith('.md') && f !== 'README.md')
    .forEach(f => existingStories.add(f.replace('.md', '')));
}

const manifest = loadManifest();
const generated = [];
const skipped = [];
const stale = [];

for (const { route, filePath, mtime } of routes) {
  const storyName = getStoryName(route);
  const module = getModule(route);
  const storyPath = join(STORIES_DIR, `${storyName}.md`);

  // Skip dynamic routes
  if (route.includes('[')) {
    skipped.push({ route, reason: 'dynamic route' });
    continue;
  }

  // Check if story exists
  if (existingStories.has(storyName) && !force) {
    // Check staleness
    if (existsSync(storyPath)) {
      const storyMtime = statSync(storyPath).mtime;
      if (mtime > storyMtime) {
        stale.push({ storyName, route, pageModified: mtime.toISOString().split('T')[0] });
      }
    }
    skipped.push({ route, reason: 'story exists' });
    continue;
  }

  // Also skip if a non-smoke story covers this route (e.g., staff-list covers /staff)
  const existingWorkflow = [...existingStories].find(s =>
    !s.endsWith('-smoke') && s.startsWith(module)
  );
  if (existingWorkflow && !force) {
    skipped.push({ route, reason: `covered by ${existingWorkflow}` });
    continue;
  }

  const story = generateSmokeStory(route, module);
  if (!story) {
    skipped.push({ route, reason: 'dynamic route' });
    continue;
  }

  if (dryRun) {
    console.log(`  [DRY] Would generate: ${storyName}.md (${route})`);
  } else {
    writeFileSync(storyPath, story.content);
    console.log(`  Generated: ${storyName}.md (${route})`);
  }

  // Update manifest
  manifest[storyName] = {
    routes: [route],
    type: story.type,
    module: story.module,
    priority: story.priority,
    last_updated: new Date().toISOString().split('T')[0],
    auto_generated: true,
  };

  generated.push(story);
}

// Also add existing manual stories to manifest
for (const name of existingStories) {
  if (!manifest[name]) {
    const storyPath = join(STORIES_DIR, `${name}.md`);
    const content = readFileSync(storyPath, 'utf-8');
    const urlMatch = content.match(/\*\*URL\*\*:\s*(.+)/);
    const moduleMatch = content.match(/\*\*Module\*\*:\s*(.+)/);
    const priorityMatch = content.match(/\*\*Priority\*\*:\s*(.+)/);

    manifest[name] = {
      routes: urlMatch ? [urlMatch[1].trim()] : [],
      type: content.includes('Type**: smoke') ? 'smoke' : 'workflow',
      module: moduleMatch ? moduleMatch[1].trim().toLowerCase() : 'unknown',
      priority: priorityMatch ? priorityMatch[1].trim() : 'Medium',
      last_updated: statSync(storyPath).mtime.toISOString().split('T')[0],
      auto_generated: false,
    };
  }
}

if (!dryRun) {
  saveManifest(manifest);
}

// Report
console.log('\n╔══════════════════════════════════════════════════════════════╗');
console.log('║              USER STORY GENERATION REPORT                    ║');
console.log('╠══════════════════════════════════════════════════════════════╣');
console.log(`║ Total UI routes:    ${String(routes.length).padEnd(39)}║`);
console.log(`║ Stories generated:  ${String(generated.length).padEnd(39)}║`);
console.log(`║ Already covered:    ${String(skipped.filter(s => s.reason !== 'dynamic route').length).padEnd(39)}║`);
console.log(`║ Dynamic (skipped):  ${String(skipped.filter(s => s.reason === 'dynamic route').length).padEnd(39)}║`);
console.log(`║ Total stories now:  ${String(existingStories.size + generated.length).padEnd(39)}║`);

if (stale.length > 0) {
  console.log('╠══════════════════════════════════════════════════════════════╣');
  console.log('║ STALE STORIES (module pages changed since story update):     ║');
  for (const s of stale) {
    console.log(`║  ${s.storyName.padEnd(30)} changed: ${s.pageModified.padEnd(18)}║`);
  }
}

const coverage = {
  Critical: { total: 0, covered: 0 },
  High: { total: 0, covered: 0 },
  Medium: { total: 0, covered: 0 },
  Low: { total: 0, covered: 0 },
};

for (const { route } of routes) {
  if (route.includes('[')) continue;
  const module = getModule(route);
  const priority = MODULE_PRIORITY[module] || 'Low';
  coverage[priority].total++;
  const storyName = getStoryName(route);
  if (existingStories.has(storyName) || generated.find(g => g.name === storyName)) {
    coverage[priority].covered++;
  }
}

console.log('╠══════════════════════════════════════════════════════════════╣');
console.log('║ COVERAGE BY PRIORITY                                        ║');
for (const [pri, stats] of Object.entries(coverage)) {
  const pct = stats.total > 0 ? Math.round(stats.covered / stats.total * 100) : 0;
  console.log(`║  ${pri.padEnd(10)} ${String(stats.covered).padStart(3)}/${String(stats.total).padEnd(5)} (${String(pct).padStart(3)}%)${' '.repeat(35 - pri.length)}║`);
}

console.log('╚══════════════════════════════════════════════════════════════╝');
