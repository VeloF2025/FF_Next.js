#!/usr/bin/env node
/**
 * Module Context Loader Hook
 *
 * When editing files in a module:
 * 1. Check if module has .claude.md context file
 * 2. If yes → Remind that context is available
 * 3. If no → Prompt to generate it
 *
 * Hook Type: PreToolUse (Edit, Write matcher)
 *
 * This helps ensure module context is loaded before making changes.
 */

const fs = require('fs');
const path = require('path');

// Track modules we've already notified about (avoid spam)
const NOTIFIED_CACHE_FILE = path.join(process.cwd(), '.claude', 'session', '.notified-modules.json');

function loadNotifiedCache() {
  try {
    if (fs.existsSync(NOTIFIED_CACHE_FILE)) {
      return JSON.parse(fs.readFileSync(NOTIFIED_CACHE_FILE, 'utf8'));
    }
  } catch (e) {
    // Ignore
  }
  return { modules: [], timestamp: Date.now() };
}

function saveNotifiedCache(cache) {
  const dir = path.dirname(NOTIFIED_CACHE_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(NOTIFIED_CACHE_FILE, JSON.stringify(cache, null, 2));
}

function getModuleFromPath(filePath) {
  const match = filePath.match(/src\/modules\/([^/]+)/);
  return match ? match[1] : null;
}

function main() {
  const toolInput = process.env.TOOL_INPUT || '';

  // Extract file path
  const fileMatch = toolInput.match(/"file_path":\s*"([^"]+)"/);
  if (!fileMatch) return;

  const filePath = fileMatch[1];

  // Check if this is a module file
  const moduleName = getModuleFromPath(filePath);
  if (!moduleName) return;

  // Check notification cache (don't spam for same module)
  const cache = loadNotifiedCache();

  // Reset cache if older than 1 hour
  if (Date.now() - cache.timestamp > 3600000) {
    cache.modules = [];
    cache.timestamp = Date.now();
  }

  if (cache.modules.includes(moduleName)) {
    return; // Already notified this session
  }

  const modulePath = path.join(process.cwd(), 'src', 'modules', moduleName);
  const claudeMdPath = path.join(modulePath, '.claude.md');
  const hasContext = fs.existsSync(claudeMdPath);

  // Add to cache
  cache.modules.push(moduleName);
  saveNotifiedCache(cache);

  if (hasContext) {
    // Module has context - gentle reminder
    console.error('');
    console.error(`📂 Working in: ${moduleName} module`);
    console.error(`📋 Context: src/modules/${moduleName}/.claude.md`);
    console.error('');
  } else {
    // Module missing context - prompt to generate
    console.error('');
    console.error('━'.repeat(60));
    console.error(`⚠️  MODULE MISSING CONTEXT: ${moduleName}`);
    console.error('━'.repeat(60));
    console.error(`Path: src/modules/${moduleName}/`);
    console.error('');
    console.error('No .claude.md file found for this module.');
    console.error('Run /kb to auto-generate context files for all modules.');
    console.error('━'.repeat(60));
    console.error('');
  }
}

main();
