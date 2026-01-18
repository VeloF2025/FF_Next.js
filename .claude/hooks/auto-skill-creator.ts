#!/usr/bin/env node

/**
 * Auto Skill Creator Hook - FibreFlow
 *
 * Automatically generates skill stubs when patterns are detected:
 * 1. New module created without skill
 * 2. Repeated questions about same topic
 * 3. Complex troubleshooting that should be documented
 *
 * Hook Type: PostToolUse (monitors for skill creation triggers)
 *
 * Creates: Skill stub in .claude/skills/{category}/{name}.md
 */

import * as fs from 'fs';
import * as path from 'path';

interface SkillStub {
  name: string;
  category: 'modules' | 'infrastructure' | 'integrations' | 'workflows';
  triggers: string[];
  context: string;
}

const SKILL_TEMPLATE = `# {NAME} Skill

## Overview
{DESCRIPTION}

## Quick Reference

| Setting | Value |
|---------|-------|
| **Location** | \`{LOCATION}\` |
| **Status** | Draft (auto-generated) |

## When to Activate

**Trigger phrases**:
{TRIGGERS}

## Common Tasks

### Task 1: [TODO]
\`\`\`bash
# Add common commands
\`\`\`

## Troubleshooting

### Issue: [TODO]
- **Cause:** ...
- **Fix:** ...

## Related Skills

- [Link to related skills]

---
*Auto-generated stub. Please expand with actual documentation.*
`;

function detectSkillCreationTrigger(toolInput: string, toolResult: string): SkillStub | null {
  // Pattern 1: New module directory created
  const newModuleMatch = toolInput.match(/mkdir.*src\/modules\/([^/\s"]+)/);
  if (newModuleMatch) {
    const moduleName = newModuleMatch[1];
    return {
      name: moduleName,
      category: 'modules',
      triggers: [`"${moduleName}"`, `"${moduleName} module"`, `"working on ${moduleName}"`],
      context: `New module created: src/modules/${moduleName}/`,
    };
  }

  // Pattern 2: New API endpoint created
  const newApiMatch = toolInput.match(/pages\/api\/([^/]+).*\.ts/);
  if (newApiMatch && toolInput.includes('Write')) {
    const apiName = newApiMatch[1];
    // Only if it's a major new endpoint (not a sub-route)
    if (!apiName.includes('[') && apiName.length > 3) {
      return {
        name: apiName,
        category: 'integrations',
        triggers: [`"${apiName} API"`, `"/api/${apiName}"`, `"${apiName} endpoint"`],
        context: `New API endpoint: /api/${apiName}`,
      };
    }
  }

  // Pattern 3: New service file created
  const newServiceMatch = toolInput.match(/services\/([^/]+)Service\.ts/);
  if (newServiceMatch) {
    const serviceName = newServiceMatch[1];
    return {
      name: serviceName.toLowerCase(),
      category: 'infrastructure',
      triggers: [`"${serviceName}"`, `"${serviceName} service"`, `"${serviceName.toLowerCase()}"`],
      context: `New service created: ${serviceName}Service.ts`,
    };
  }

  return null;
}

function createSkillStub(workDir: string, stub: SkillStub): boolean {
  const skillDir = path.join(workDir, '.claude', 'skills', stub.category);
  const skillPath = path.join(skillDir, `${stub.name}.md`);

  // Don't overwrite existing skills
  if (fs.existsSync(skillPath)) {
    return false;
  }

  // Ensure directory exists
  if (!fs.existsSync(skillDir)) {
    fs.mkdirSync(skillDir, { recursive: true });
  }

  // Generate content from template
  const triggersFormatted = stub.triggers.map(t => `- ${t}`).join('\n');
  const content = SKILL_TEMPLATE
    .replace('{NAME}', stub.name.charAt(0).toUpperCase() + stub.name.slice(1))
    .replace('{DESCRIPTION}', stub.context)
    .replace('{LOCATION}', `src/modules/${stub.name}/` )
    .replace('{TRIGGERS}', triggersFormatted);

  fs.writeFileSync(skillPath, content);
  return true;
}

function main() {
  const toolInput = process.env.TOOL_INPUT || '';
  const toolResult = process.env.TOOL_RESULT || '';
  const workDir = process.cwd();

  // Only process successful operations
  if (toolResult.includes('error') || toolResult.includes('Error')) {
    return;
  }

  const stub = detectSkillCreationTrigger(toolInput, toolResult);
  if (!stub) return;

  const created = createSkillStub(workDir, stub);
  if (created) {
    console.error('');
    console.error('━'.repeat(50));
    console.error('✨ AUTO-SKILL STUB CREATED');
    console.error('━'.repeat(50));
    console.error(`Skill: .claude/skills/${stub.category}/${stub.name}.md`);
    console.error(`Context: ${stub.context}`);
    console.error('');
    console.error('📝 Action needed: Expand the skill with actual documentation');
    console.error('   Run: /Createskill to enhance with workflows');
    console.error('━'.repeat(50));
    console.error('');
  }
}

main();
