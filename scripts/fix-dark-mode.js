#!/usr/bin/env node
/**
 * Auto-fix dark mode CSS variables in components
 * Converts hardcoded Tailwind colors to CSS variables
 */

const fs = require('fs');
const path = require('path');
const glob = require('glob');

// Replacement patterns
const replacements = [
  // Background colors
  { pattern: /\bbg-white\b/g, replacement: 'bg-[var(--ff-bg-secondary)]' },
  { pattern: /\bbg-gray-50\b/g, replacement: 'bg-[var(--ff-bg-tertiary)]' },
  { pattern: /\bbg-gray-100\b/g, replacement: 'bg-[var(--ff-bg-tertiary)]' },
  { pattern: /\bbg-gray-200\b/g, replacement: 'bg-[var(--ff-bg-hover)]' },

  // Text colors
  { pattern: /\btext-gray-900\b/g, replacement: 'text-[var(--ff-text-primary)]' },
  { pattern: /\btext-gray-800\b/g, replacement: 'text-[var(--ff-text-primary)]' },
  { pattern: /\btext-gray-700\b/g, replacement: 'text-[var(--ff-text-primary)]' },
  { pattern: /\btext-gray-600\b/g, replacement: 'text-[var(--ff-text-secondary)]' },
  { pattern: /\btext-gray-500\b/g, replacement: 'text-[var(--ff-text-secondary)]' },
  { pattern: /\btext-gray-400\b/g, replacement: 'text-[var(--ff-text-tertiary)]' },

  // Border colors
  { pattern: /\bborder-gray-200\b/g, replacement: 'border-[var(--ff-border-light)]' },
  { pattern: /\bborder-gray-300\b/g, replacement: 'border-[var(--ff-border-light)]' },
  { pattern: /\bborder-gray-400\b/g, replacement: 'border-[var(--ff-border-light)]' },

  // Hover states
  { pattern: /\bhover:bg-gray-50\b/g, replacement: 'hover:bg-[var(--ff-bg-hover)]' },
  { pattern: /\bhover:bg-gray-100\b/g, replacement: 'hover:bg-[var(--ff-bg-hover)]' },
  { pattern: /\bhover:bg-gray-200\b/g, replacement: 'hover:bg-[var(--ff-bg-hover)]' },
  { pattern: /\bhover:text-gray-900\b/g, replacement: 'hover:text-[var(--ff-text-primary)]' },
  { pattern: /\bhover:text-gray-800\b/g, replacement: 'hover:text-[var(--ff-text-primary)]' },

  // Placeholder colors
  { pattern: /\bplaceholder-gray-500\b/g, replacement: 'placeholder-[var(--ff-text-tertiary)]' },
  { pattern: /\bplaceholder-gray-400\b/g, replacement: 'placeholder-[var(--ff-text-tertiary)]' },
];

// Dark mode removal patterns (remove dark: variants when we've replaced the base)
const darkModePatterns = [
  { pattern: /\s+dark:bg-gray-\d+/g, replacement: '' },
  { pattern: /\s+dark:text-gray-\d+/g, replacement: '' },
  { pattern: /\s+dark:border-gray-\d+/g, replacement: '' },
  { pattern: /\s+dark:hover:bg-gray-\d+/g, replacement: '' },
  { pattern: /\s+dark:hover:text-gray-\d+/g, replacement: '' },
  { pattern: /\s+dark:placeholder-gray-\d+/g, replacement: '' },
  { pattern: /\s+dark:bg-gray-\d+\/\d+/g, replacement: '' },
  { pattern: /\s+dark:text-white/g, replacement: '' },
];

// Status badge patterns - convert to /20 opacity format
const statusBadgePatterns = [
  { pattern: /\bbg-blue-100\s+text-blue-800/g, replacement: 'bg-blue-500/20 text-blue-400' },
  { pattern: /\bbg-green-100\s+text-green-800/g, replacement: 'bg-green-500/20 text-green-400' },
  { pattern: /\bbg-red-100\s+text-red-800/g, replacement: 'bg-red-500/20 text-red-400' },
  { pattern: /\bbg-yellow-100\s+text-yellow-800/g, replacement: 'bg-yellow-500/20 text-yellow-400' },
  { pattern: /\bbg-orange-100\s+text-orange-800/g, replacement: 'bg-orange-500/20 text-orange-400' },
  { pattern: /\bbg-purple-100\s+text-purple-800/g, replacement: 'bg-purple-500/20 text-purple-400' },
  { pattern: /\bbg-gray-100\s+text-gray-800/g, replacement: 'bg-gray-500/20 text-gray-400' },
];

function processFile(filePath) {
  console.log(`Processing: ${filePath}`);
  let content = fs.readFileSync(filePath, 'utf8');
  let changed = false;

  // Apply status badge replacements first
  statusBadgePatterns.forEach(({ pattern, replacement }) => {
    if (pattern.test(content)) {
      content = content.replace(pattern, replacement);
      changed = true;
    }
  });

  // Apply base replacements
  replacements.forEach(({ pattern, replacement }) => {
    if (pattern.test(content)) {
      content = content.replace(pattern, replacement);
      changed = true;
    }
  });

  // Remove dark mode variants
  darkModePatterns.forEach(({ pattern, replacement }) => {
    if (pattern.test(content)) {
      content = content.replace(pattern, replacement);
      changed = true;
    }
  });

  if (changed) {
    fs.writeFileSync(filePath, content, 'utf8');
    console.log(`  ✓ Updated`);
    return 1;
  }

  return 0;
}

// Get all TSX files in the specified modules
const modules = [
  'src/modules/ticketing',
  'src/modules/sow',
  'src/modules/clients'
];

let totalFiles = 0;

modules.forEach(module => {
  const pattern = path.join(module, '**/*.tsx');
  const files = glob.sync(pattern);

  console.log(`\n${module}: Found ${files.length} TSX files`);

  files.forEach(file => {
    totalFiles += processFile(file);
  });
});

console.log(`\n✓ Processed ${totalFiles} files with changes`);
