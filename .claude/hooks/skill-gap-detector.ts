#!/usr/bin/env npx ts-node

/**
 * Skill Gap Detector Hook - FibreFlow
 *
 * Detects when editing a module that doesn't have a corresponding skill.
 * Suggests creating a skill using /Createskill.
 *
 * Hook Type: PreToolUse (Edit, Write)
 *
 * Environment: TOOL_INPUT contains the file path being edited
 */

import * as fs from 'fs';
import * as path from 'path';

function main() {
  const toolInput = process.env.TOOL_INPUT || '';

  // Extract file path from tool input
  const filePathMatch = toolInput.match(/file_path["\s:]+([^"]+)/);
  if (!filePathMatch) return;

  const filePath = filePathMatch[1];

  // Check if editing a module file
  const moduleMatch = filePath.match(/src\/modules\/([^/]+)/);
  if (!moduleMatch) return;

  const moduleName = moduleMatch[1];
  const workDir = process.cwd();
  const skillsDir = path.join(workDir, '.claude', 'skills', 'modules');

  if (!fs.existsSync(skillsDir)) return;

  // Get existing skills
  const skills = fs.readdirSync(skillsDir)
    .filter(f => f.endsWith('.md'))
    .map(f => f.replace('.md', '').toLowerCase());

  // Check if module has skill
  const normalizedMod = moduleName.toLowerCase().replace(/-/g, '');
  const hasSkill = skills.some(s => {
    const normalizedSkill = s.replace(/-/g, '');
    return normalizedSkill === normalizedMod ||
           normalizedSkill.includes(normalizedMod) ||
           normalizedMod.includes(normalizedSkill);
  });

  if (!hasSkill) {
    console.error('');
    console.error(`⚠️  SKILL GAP: Module "${moduleName}" has no skill documentation.`);
    console.error(`   Consider: /Createskill for src/modules/${moduleName}/`);
    console.error('');
  }
}

main();
