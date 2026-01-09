#!/usr/bin/env npx ts-node

/**
 * TDD Reminder Hook
 *
 * Runs on PreToolUse for Write/Edit operations on src/ files.
 * Reminds developers to ensure tests exist before implementation.
 *
 * This is a soft reminder, not a blocker - actual enforcement
 * happens at PR level via CI checks.
 */

import * as fs from 'fs';
import * as path from 'path';

interface ToolInput {
  file_path?: string;
  content?: string;
}

// Get tool input from environment
const toolInput = process.env.TOOL_INPUT || '{}';
let input: ToolInput;

try {
  input = JSON.parse(toolInput);
} catch {
  // Not JSON or no input, skip
  process.exit(0);
}

const filePath = input.file_path || '';

// Only check src/ files (feature code)
if (!filePath.includes('/src/')) {
  process.exit(0);
}

// Skip non-feature files
const skipPatterns = [
  '/types/',      // Type definitions
  '/constants/',  // Constants
  '.d.ts',        // Declaration files
  'index.ts',     // Barrel exports
];

if (skipPatterns.some(pattern => filePath.includes(pattern))) {
  process.exit(0);
}

// Extract module/feature name from path
const srcMatch = filePath.match(/src\/modules\/([^/]+)/);
const moduleName = srcMatch ? srcMatch[1] : 'unknown';

// Check if corresponding test exists
const testLocations = [
  `tests/unit/modules/${moduleName}`,
  `tests/integration/modules/${moduleName}`,
  `src/modules/${moduleName}/__tests__`,
  `src/modules/${moduleName}/*.test.ts`,
];

const testsExist = testLocations.some(loc => {
  const testPath = path.join(process.cwd(), loc);
  try {
    const stat = fs.statSync(testPath);
    return stat.isDirectory() || stat.isFile();
  } catch {
    return false;
  }
});

const testSpecPath = path.join(process.cwd(), 'tests/specs', `${moduleName}.spec.md`);
const specExists = fs.existsSync(testSpecPath);

// Output reminder (shown in Claude Code status)
if (!testsExist && !specExists) {
  console.log(`
[TDD REMINDER] Module: ${moduleName}
-----------------------------------------
No test spec or tests found for this module.

Before implementing features, please:
1. Create spec: tests/specs/${moduleName}.spec.md
2. Create tests: tests/unit/modules/${moduleName}/

Run: /tdd spec "${moduleName}" to generate test specification.
-----------------------------------------
`);
}

// Exit successfully (reminder only, not blocker)
process.exit(0);
