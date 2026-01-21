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

// Keywords that indicate a significant change worth capturing
const FIX_MARKERS = [
  // Explicit markers
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
  // Common code patterns indicating significant changes
  'TODO:',
  'HACK:',
  'NOTE:',
  // SQL/DB changes
  'ALTER TABLE',
  'CREATE INDEX',
  'ADD COLUMN',
  'DROP COLUMN',
  // API changes
  'apiResponse',
  'throw new Error',
  'catch (error)',
  // Filter/query changes
  'WHERE',
  'conditions.push',
  'params.push',
  // Infrastructure & health checks
  'healthCheck',
  'health-check',
  'health_check',
  'systemctl',
  'restart',
  'service',
  'container',
  'docker',
  'nginx',
  'port',
  'timeout',
  'connection refused',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'DATABASE_URL',
  'VLM_API',
  'ssh',
  'deploy',
  'environment',
  '.env',
  'process.env',

  // Velocity Server (100.96.203.105)
  'velo@',
  'louis@',
  '100.96.203.105',
  'Velocity',

  // FibreFlow Services
  'fibreflow.service',
  'fibreflow-dev.service',
  'pdfcraft.service',
  'pdfcraft',

  // WhatsApp Services
  'wa-monitor-prod',
  'wa-monitor-dev',
  'wa-monitor',
  'whatsapp-bridge',
  'whatsapp-bridge-prod',
  'wa-feedback',
  'bridge.log',

  // VLM/AI Services
  'vllm-qwen',
  'vllm',
  'Qwen',
  'ollama',
  'qdrant',

  // QFieldCloud Infrastructure
  'qfield',
  'qfieldcloud',
  'qfieldcloud-app',
  'qfieldcloud-worker',
  'qfieldcloud-nginx',
  'qfieldcloud-postgres',
  'cloudflared',
  'minio',
  'MinIO',

  // Docker & Portainer
  'docker-compose',
  'portainer',
  'grafana',

  // Database
  'neon',
  'postgresql',
  'postgres',
  'pgpool',
  'ep-dry-night',
  'ep-aged-poetry',

  // Staging/Production
  'vf.fibreflow.app',
  'app.fibreflow.app',
  'dev.fibreflow.app',
  'staging',
  'production',
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
  // Infrastructure types
  'healthcheck': 'Health Check Fix',
  'health-check': 'Health Check Fix',
  'systemctl': 'Service Fix',
  'restart': 'Service Restart',
  'docker': 'Container Fix',
  'nginx': 'Nginx Config',
  'database_url': 'Database Connection',
  'econnrefused': 'Connection Fix',
  'etimedout': 'Timeout Fix',
  'deploy': 'Deployment Fix',
  'environment': 'Environment Config',
  '.env': 'Environment Config',
  'ssh': 'Server Access Fix',
  // Service-specific types
  'fibreflow.service': 'FibreFlow Service',
  'wa-monitor': 'WA Monitor Fix',
  'whatsapp-bridge': 'WhatsApp Bridge Fix',
  'wa-feedback': 'WA Feedback Fix',
  'vllm': 'VLM Service Fix',
  'qwen': 'VLM Model Fix',
  'ollama': 'Ollama Fix',
  'qdrant': 'Vector DB Fix',
  'qfield': 'QField Fix',
  'qfieldcloud': 'QFieldCloud Fix',
  'cloudflared': 'Cloudflare Tunnel Fix',
  'minio': 'MinIO Storage Fix',
  'pdfcraft': 'PDFCraft Fix',
  'portainer': 'Portainer Fix',
  'grafana': 'Grafana Fix',
  'neon': 'Neon DB Fix',
  'postgresql': 'PostgreSQL Fix',
  'staging': 'Staging Fix',
  'production': 'Production Fix',
};

function getModuleFromPath(filePath) {
  // Extract module name from path like src/modules/{module}/...
  const moduleMatch = filePath.match(/src\/modules\/([^/]+)/);
  if (moduleMatch) return moduleMatch[1];

  // Map pages/api/{domain}/* to corresponding module
  const apiMatch = filePath.match(/pages\/api\/([^/]+)/);
  if (apiMatch) {
    const apiDomain = apiMatch[1];
    // Map API domains to modules
    const apiToModule = {
      'activate': 'activate',
      'wa-monitor': 'wa-monitor',
      'procurement': 'procurement',
      'fleet': 'fleet',
      'contractors': 'contractors',
      'projects': 'projects',
      'staff': 'staff',
      'meetings': 'meetings',
      'communications': 'communications',
      'maintenance': 'maintenance',
      'assets': 'assets',
      'analytics': 'analytics',
      'workflow': 'workflow',
      'sow': 'sow',
      'system': 'system',
    };
    return apiToModule[apiDomain] || null;
  }

  // Infrastructure files → system module
  const infraPatterns = [
    /\.claude\/hooks\//,      // Claude hooks
    /scripts\/(deploy|cron)/, // Deployment/cron scripts
    /\.env/,                  // Environment files
    /docker/i,                // Docker files
    /nginx/i,                 // Nginx configs
    /systemd/i,               // Systemd services
  ];
  if (infraPatterns.some(p => p.test(filePath))) {
    return 'system';
  }

  return null;
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

function isCriticalFile(filePath) {
  // Always capture significant changes to these files
  const criticalPatterns = [
    /pages\/api\//,           // API endpoints
    /services\/.*Service/,    // Service files
    /services\/.*Crud/,       // CRUD operations
    /lib\/.*\.ts$/,           // Library files
    /hooks\/use.*\.ts$/,      // Custom hooks
  ];
  return criticalPatterns.some(pattern => pattern.test(filePath));
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

  // Extract context from the change
  const context = extractContext(toolInput);

  // Determine if this change should be captured:
  // 1. Has explicit fix markers (any size)
  // 2. Critical file with significant changes (>5 lines added)
  // 3. Large changes (>15 lines added)
  const hasMarker = hasFixMarker(toolInput);
  const isCritical = isCriticalFile(filePath);
  const isSignificant = context.linesAdded >= 5;
  const isLarge = context.linesAdded >= 15;

  if (!hasMarker && !isLarge && !(isCritical && isSignificant)) return;

  // Skip trivial changes (but only if no fix marker)
  if (!hasMarker && context.linesAdded < 3 && context.netChange < 2) return;

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
