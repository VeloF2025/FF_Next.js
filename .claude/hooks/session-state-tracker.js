#!/usr/bin/env node
/**
 * Session State Tracker Hook
 *
 * Automatically updates .claude/session/current.json after significant actions.
 *
 * Hook Type: PostToolUse
 *
 * Tracks:
 * - Files modified (Edit, Write)
 * - Commands executed (Bash with deployments, migrations, git)
 * - Progress milestones
 */

const fs = require('fs');
const path = require('path');

const SESSION_FILE = path.join(process.cwd(), '.claude', 'session', 'current.json');

// Patterns that indicate significant actions worth tracking
const SIGNIFICANT_PATTERNS = {
  deployment: /deploy|staging|production|fibreflow\.service|systemctl restart/i,
  migration: /migration|migrate|\.sql/i,
  git: /git (push|commit|merge)/i,
  service: /systemctl|restart|service/i,
  test: /npm test|vitest|jest/i,
  build: /npm run build|next build/i,
};

function loadSession() {
  try {
    if (fs.existsSync(SESSION_FILE)) {
      return JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8'));
    }
  } catch (e) {
    // Ignore parse errors
  }

  // Return default session structure
  return {
    session_id: `session-${Date.now()}`,
    started_at: new Date().toISOString(),
    last_updated: new Date().toISOString(),
    working_on: {
      task: 'Unknown task',
      status: 'in_progress',
      progress: [],
      files_modified: [],
      last_action: null
    },
    pending_tasks: [],
    context: {}
  };
}

function saveSession(session) {
  session.last_updated = new Date().toISOString();

  const sessionDir = path.dirname(SESSION_FILE);
  if (!fs.existsSync(sessionDir)) {
    fs.mkdirSync(sessionDir, { recursive: true });
  }

  fs.writeFileSync(SESSION_FILE, JSON.stringify(session, null, 2));
}

function getActionType(toolName, toolInput) {
  if (toolName === 'Edit' || toolName === 'Write') {
    return 'file_change';
  }

  if (toolName === 'Bash') {
    for (const [type, pattern] of Object.entries(SIGNIFICANT_PATTERNS)) {
      if (pattern.test(toolInput)) {
        return type;
      }
    }
    return 'command';
  }

  return 'other';
}

function extractFilePath(toolInput) {
  const match = toolInput.match(/"file_path":\s*"([^"]+)"/);
  return match ? match[1] : null;
}

function extractCommand(toolInput) {
  const match = toolInput.match(/"command":\s*"([^"]+)"/);
  return match ? match[1].substring(0, 100) : null;
}

function formatProgress(actionType, details) {
  const timestamp = new Date().toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' });
  const icons = {
    file_change: '📝',
    deployment: '🚀',
    migration: '🗃️',
    git: '📦',
    service: '⚙️',
    test: '🧪',
    build: '🔨',
    command: '💻',
    other: '•'
  };

  return `${icons[actionType] || '•'} [${timestamp}] ${details}`;
}

function main() {
  const toolName = process.env.TOOL_NAME || '';
  const toolInput = process.env.TOOL_INPUT || '';

  // Only track significant tools
  const trackableTools = ['Edit', 'Write', 'Bash'];
  if (!trackableTools.includes(toolName)) {
    return;
  }

  const actionType = getActionType(toolName, toolInput);

  // Skip non-significant commands
  if (actionType === 'command' || actionType === 'other') {
    return;
  }

  const session = loadSession();

  // Track file modifications
  if (toolName === 'Edit' || toolName === 'Write') {
    const filePath = extractFilePath(toolInput);
    if (filePath) {
      // Store relative path
      const relativePath = filePath.replace(process.cwd() + '/', '');

      if (!session.working_on.files_modified.includes(relativePath)) {
        session.working_on.files_modified.push(relativePath);

        // Keep only last 20 files
        if (session.working_on.files_modified.length > 20) {
          session.working_on.files_modified = session.working_on.files_modified.slice(-20);
        }
      }

      session.working_on.last_action = `Modified ${path.basename(filePath)}`;

      // Add to progress for significant files
      if (relativePath.includes('service') || relativePath.includes('api/') || relativePath.includes('.claude/')) {
        const progress = formatProgress('file_change', `Modified ${relativePath}`);
        session.working_on.progress.push(progress);
      }
    }
  }

  // Track significant bash commands
  if (toolName === 'Bash' && actionType !== 'command') {
    const command = extractCommand(toolInput);
    const details = {
      deployment: 'Deployment action',
      migration: 'Database migration',
      git: 'Git operation',
      service: 'Service operation',
      test: 'Running tests',
      build: 'Building project'
    }[actionType] || command;

    session.working_on.last_action = details;

    const progress = formatProgress(actionType, details);
    session.working_on.progress.push(progress);
  }

  // Keep only last 50 progress entries
  if (session.working_on.progress.length > 50) {
    session.working_on.progress = session.working_on.progress.slice(-50);
  }

  saveSession(session);
}

main();
