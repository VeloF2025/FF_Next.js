#!/usr/bin/env node
/**
 * Module Learning Capture Hook
 *
 * Automatically captures learnings to module-specific .claude-learnings.md files.
 *
 * Hook Type: PostToolUse (Edit, Write matcher)
 *
 * When editing a file in src/modules/{module}/:
 * - If change contains fix markers → Capture to src/modules/{module}/.claude-learnings.md
 * - Tracks error fixes, workarounds, important discoveries
 *
 * The /kb command later consolidates these into permanent .claude.md files.
 */

const fs = require('fs');
const path = require('path');

// Keywords that indicate a significant fix worth capturing
const FIX_MARKERS = [
  'CRITICAL',
  'FIX:',
  'BUG:',
  'BUGFIX',
  'IMPORTANT:',
  'WORKAROUND:',
  'HOTFIX',
  'The Problem',
  'The Solution',
  'Root cause',
  'Fixed by',
  'This fixes',
  'Resolves #',
];

// Keywords that indicate the type of fix
const FIX_TYPES = {
  'CRITICAL': 'Critical Fix',
  'BUG': 'Bug Fix',
  'WORKAROUND': 'Workaround',
  'HOTFIX': 'Hotfix',
  'performance': 'Performance Fix',
  'timeout': 'Timeout Fix',
  'error handling': 'Error Handling',
  'validation': 'Validation Fix',
  'type': 'Type Fix',
};

function getModuleFromPath(filePath) {
  // Extract module name from path like src/modules/{module}/...
  const match = filePath.match(/src\/modules\/([^/]+)/);
  return match ? match[1] : null;
}

function detectFixType(content) {
  const lowerContent = content.toLowerCase();

  for (const [keyword, type] of Object.entries(FIX_TYPES)) {
    if (lowerContent.includes(keyword.toLowerCase())) {
      return type;
    }
  }

  return 'Code Change';
}

function hasFixMarker(content) {
  return FIX_MARKERS.some(marker =>
    content.toLowerCase().includes(marker.toLowerCase())
  );
}

function extractContext(toolInput) {
  // Try to extract old_string and new_string for context
  const oldMatch = toolInput.match(/"old_string":\s*"((?:[^"\\]|\\.)*)"/s);
  const newMatch = toolInput.match(/"new_string":\s*"((?:[^"\\]|\\.)*)"/s);

  const oldString = oldMatch ? oldMatch[1].replace(/\\n/g, '\n').replace(/\\"/g, '"') : '';
  const newString = newMatch ? newMatch[1].replace(/\\n/g, '\n').replace(/\\"/g, '"') : '';

  // Count lines changed
  const linesAdded = (newString.match(/\n/g) || []).length + 1;
  const linesRemoved = (oldString.match(/\n/g) || []).length + 1;

  return {
    oldString: oldString.substring(0, 200),
    newString: newString.substring(0, 500),
    linesAdded,
    linesRemoved,
    netChange: linesAdded - linesRemoved
  };
}

function appendToLearningsFile(modulePath, learning) {
  const learningsFile = path.join(modulePath, '.claude-learnings.md');

  // Create file with header if it doesn't exist
  if (!fs.existsSync(learningsFile)) {
    const header = `# ${path.basename(modulePath)} Module - Auto-Captured Learnings

> These learnings are auto-captured by Claude Code hooks when significant fixes are made.
> Run \`/kb\` to consolidate into the permanent \`.claude.md\` file.

---

`;
    fs.writeFileSync(learningsFile, header);
  }

  // Append the learning entry
  const entry = `
## ${learning.timestamp} - ${learning.fixType}

**File:** \`${learning.fileName}\`
**Lines:** +${learning.linesAdded} / -${learning.linesRemoved}

### What Changed
\`\`\`
${learning.newString}
\`\`\`

### Context
${learning.context || 'Auto-captured fix. Review and add context.'}

---
`;

  fs.appendFileSync(learningsFile, entry);
  return learningsFile;
}

function main() {
  const toolName = process.env.TOOL_NAME || '';
  const toolInput = process.env.TOOL_INPUT || '';

  // Only process Edit/Write tools
  if (toolName !== 'Edit' && toolName !== 'Write') {
    return;
  }

  // Extract file path
  const fileMatch = toolInput.match(/"file_path":\s*"([^"]+)"/);
  if (!fileMatch) return;

  const filePath = fileMatch[1];

  // Check if this is a module file
  const moduleName = getModuleFromPath(filePath);
  if (!moduleName) return;

  // Check if the change contains fix markers
  if (!hasFixMarker(toolInput)) return;

  // Extract context from the change
  const context = extractContext(toolInput);

  // Skip trivial changes
  if (context.linesAdded < 3 && context.netChange < 2) return;

  const modulePath = path.join(process.cwd(), 'src', 'modules', moduleName);

  // Ensure module directory exists
  if (!fs.existsSync(modulePath)) return;

  const learning = {
    timestamp: new Date().toISOString().split('T')[0],
    fileName: path.basename(filePath),
    filePath: filePath,
    fixType: detectFixType(toolInput),
    linesAdded: context.linesAdded,
    linesRemoved: context.linesRemoved,
    newString: context.newString,
    context: null // Will be filled in manually or by /kb
  };

  const learningsFile = appendToLearningsFile(modulePath, learning);
  const relativePath = path.relative(process.cwd(), learningsFile);

  // Output notification
  console.error('');
  console.error('━'.repeat(60));
  console.error(`📚 LEARNING CAPTURED → ${moduleName} module`);
  console.error('━'.repeat(60));
  console.error(`Type: ${learning.fixType}`);
  console.error(`File: ${learning.fileName}`);
  console.error(`Saved to: ${relativePath}`);
  console.error('');
  console.error('💡 Run /kb to consolidate learnings into permanent KB');
  console.error('━'.repeat(60));
  console.error('');
}

main();
