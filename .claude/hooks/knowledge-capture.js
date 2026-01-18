#!/usr/bin/env node

/**
 * Knowledge Capture Hook - FibreFlow
 *
 * Automatically captures learnings when significant fixes are made to key services.
 * Auto-appends to skill files with version control backup.
 *
 * Hook Type: PostToolUse (Edit matcher)
 *
 * Triggers when:
 * - Editing key service files (VLM, check-in, activate, etc.)
 * - Code contains fix markers (CRITICAL, FIX, BUG, IMPORTANT)
 * - Significant changes (>10 lines added)
 *
 * Version Control:
 * - Backs up skill file before modification to .claude/skill-versions/
 * - Format: {skill-name}.{timestamp}.md
 * - Revert: cp .claude/skill-versions/{file} .claude/skills/{path}
 */

const fs = require('fs');
const path = require('path');

// Map of service file patterns to their skill files
const SERVICE_TO_SKILL_MAP = {
  'fleetVlmService': 'infrastructure/vlm.md',
  'categorizationVlmService': 'infrastructure/vlm.md',
  'checkInService': 'modules/fleet-check-in.md',
  'useCheckIn': 'modules/fleet-check-in.md',
  'activityLogService': 'modules/activate.md',
  'vlmQaValidationService': 'modules/activate.md',
  'waMonitor': 'modules/wa-monitor.md',
};

// Keywords that indicate a significant fix
const FIX_MARKERS = [
  'CRITICAL',
  'FIX:',
  'BUG:',
  'IMPORTANT:',
  'WORKAROUND:',
  'The Problem',
  'The Solution',
  'Root cause',
];

function getSkillFile(filePath) {
  const fileName = path.basename(filePath, path.extname(filePath));

  for (const [pattern, skill] of Object.entries(SERVICE_TO_SKILL_MAP)) {
    if (fileName.toLowerCase().includes(pattern.toLowerCase())) {
      return skill;
    }
  }
  return null;
}

function extractLearning(toolInput, filePath) {
  // Check if this is a significant edit
  const hasFixMarker = FIX_MARKERS.some(marker =>
    toolInput.toLowerCase().includes(marker.toLowerCase())
  );

  // Count new lines added (rough estimate)
  const newStringMatch = toolInput.match(/"new_string":\s*"([^"]+)"/s);
  const newLines = newStringMatch ? (newStringMatch[1].match(/\\n/g) || []).length : 0;

  if (!hasFixMarker && newLines < 10) {
    return null;
  }

  // Extract the change content for context
  const oldString = toolInput.match(/"old_string":\s*"([^"]+)"/s)?.[1] || '';
  const newString = newStringMatch?.[1] || '';

  const timestamp = new Date().toISOString().split('T')[0];
  const fileName = path.basename(filePath);

  return {
    timestamp,
    file: fileName,
    filePath,
    summary: `Edit to ${fileName} with ${newLines}+ lines`,
    hasMarker: hasFixMarker,
    oldString: oldString.substring(0, 100),
    newString: newString.substring(0, 200),
    newLines,
  };
}

function backupSkillFile(workDir, skillRelPath) {
  const skillPath = path.join(workDir, '.claude', 'skills', skillRelPath);
  if (!fs.existsSync(skillPath)) return null;

  const versionsDir = path.join(workDir, '.claude', 'skill-versions');
  if (!fs.existsSync(versionsDir)) {
    fs.mkdirSync(versionsDir, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const skillName = path.basename(skillRelPath, '.md');
  const backupName = `${skillName}.${timestamp}.md`;
  const backupPath = path.join(versionsDir, backupName);

  fs.copyFileSync(skillPath, backupPath);
  return backupPath;
}

function appendToSkillFile(workDir, skillRelPath, learning) {
  const skillPath = path.join(workDir, '.claude', 'skills', skillRelPath);
  if (!fs.existsSync(skillPath)) return false;

  const entry = `

---

## Auto-Captured Learning (${learning.timestamp})

**Source:** \`${learning.file}\`
**Type:** ${learning.hasMarker ? 'Fix/Critical Change' : 'Significant Change'}
**Lines Changed:** ~${learning.newLines}

*Review and expand this section, then remove this notice.*

`;

  fs.appendFileSync(skillPath, entry);
  return true;
}

function appendToLearningsLog(workDir, learning, skillUpdated, backupPath) {
  const logDir = path.join(workDir, '.claude', 'learnings');
  const logFile = path.join(logDir, `${learning.timestamp}.md`);

  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }

  const entry = `
## ${new Date().toISOString()} - ${learning.file}

**File:** \`${learning.file}\`
**Significant:** ${learning.hasMarker ? 'Yes (contains fix marker)' : 'Maybe (large change)'}
**Skill Updated:** ${skillUpdated ? 'Yes' : 'No (no matching skill)'}
${backupPath ? `**Backup:** \`${path.relative(workDir, backupPath)}\`` : ''}

---
`;

  fs.appendFileSync(logFile, entry);
  return logFile;
}

function main() {
  const toolInput = process.env.TOOL_INPUT || '';
  const toolName = process.env.TOOL_NAME || '';
  const workDir = process.cwd();

  // Only process Edit/Write tools
  if (toolName !== 'Edit' && toolName !== 'Write') return;

  // Extract file path from input
  const fileMatch = toolInput.match(/"file_path":\s*"([^"]+)"/);
  if (!fileMatch) return;

  const filePath = fileMatch[1];

  // Check if this is a service file we care about
  const skillFile = getSkillFile(filePath);

  // Extract learning
  const learning = extractLearning(toolInput, filePath);
  if (!learning) return;

  let backupPath = null;
  let skillUpdated = false;

  // If we have a matching skill, backup and append
  if (skillFile) {
    backupPath = backupSkillFile(workDir, skillFile);
    skillUpdated = appendToSkillFile(workDir, skillFile, learning);
  }

  // Always log the learning
  const logFile = appendToLearningsLog(workDir, learning, skillUpdated, backupPath);

  // Output notification
  console.error('');
  console.error('━'.repeat(50));
  console.error('📚 KNOWLEDGE CAPTURED');
  console.error('━'.repeat(50));
  console.error(`File: ${learning.file}`);
  console.error(`Log: ${path.relative(workDir, logFile)}`);
  if (skillUpdated) {
    console.error(`✅ Skill updated: .claude/skills/${skillFile}`);
    console.error(`📦 Backup: ${path.relative(workDir, backupPath)}`);
    console.error('💡 Review the appended section and expand it!');
  } else if (skillFile) {
    console.error(`⚠️ Skill file not found: .claude/skills/${skillFile}`);
  }
  console.error('━'.repeat(50));
  console.error('');
}

main();
