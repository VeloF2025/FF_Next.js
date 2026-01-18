#!/usr/bin/env npx ts-node

/**
 * Expert Load Hook - FibreFlow
 *
 * Loads expertise.yaml at session start and injects into context.
 * Ensures agent has "mental model" of FF before acting.
 *
 * Hook Type: SessionStart
 *
 * What it does:
 * 1. Find expertise.yaml in .claude/
 * 2. Validate key locations still exist
 * 3. Output expertise summary for context
 */

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'yaml';

interface ExpertiseFile {
  expertise: {
    project: string;
    domain: string;
    version: number;
    last_updated: string;
    key_locations?: Record<string, string>;
    patterns?: Array<{
      name: string;
      when: string;
      example?: string;
      notes?: string;
    }>;
    anti_patterns?: Array<{
      name: string;
      why_bad: string;
      what_to_do: string;
    }>;
    commands?: Record<string, string>;
  };
}

function findExpertiseFile(startDir: string): string | null {
  const expertisePath = path.join(startDir, '.claude', 'expertise.yaml');
  if (fs.existsSync(expertisePath)) {
    return expertisePath;
  }
  return null;
}

/**
 * Detect modules without corresponding skills
 */
function detectSkillGaps(baseDir: string): string[] {
  const gaps: string[] = [];
  const modulesDir = path.join(baseDir, 'src', 'modules');
  const skillsDir = path.join(baseDir, '.claude', 'skills', 'modules');

  if (!fs.existsSync(modulesDir) || !fs.existsSync(skillsDir)) {
    return gaps;
  }

  // Get all module directories
  const modules = fs.readdirSync(modulesDir, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name);

  // Get existing skill files (without .md extension)
  const skills = fs.readdirSync(skillsDir)
    .filter(f => f.endsWith('.md'))
    .map(f => f.replace('.md', '').toLowerCase());

  // Find modules without skills
  for (const mod of modules) {
    const normalizedMod = mod.toLowerCase().replace(/-/g, '');
    const hasSkill = skills.some(s => {
      const normalizedSkill = s.replace(/-/g, '');
      return normalizedSkill === normalizedMod ||
             normalizedSkill.includes(normalizedMod) ||
             normalizedMod.includes(normalizedSkill);
    });

    if (!hasSkill) {
      gaps.push(mod);
    }
  }

  return gaps;
}

function validateLocations(
  baseDir: string,
  locations: Record<string, string>
): { valid: string[]; missing: string[] } {
  const valid: string[] = [];
  const missing: string[] = [];

  for (const [name, loc] of Object.entries(locations)) {
    const fullPath = path.join(baseDir, loc);
    if (fs.existsSync(fullPath)) {
      valid.push(name);
    } else {
      missing.push(`${name} (${loc})`);
    }
  }

  return { valid, missing };
}

function formatExpertise(
  expertise: ExpertiseFile,
  validation: { valid: string[]; missing: string[] }
): string {
  const e = expertise.expertise;
  const lines: string[] = [];

  lines.push(`## Project Expertise: ${e.project}`);
  lines.push(`Domain: ${e.domain} | Version: ${e.version} | Updated: ${e.last_updated}`);
  lines.push('');

  // Key locations (top 5)
  if (e.key_locations) {
    lines.push('### Key Locations');
    const entries = Object.entries(e.key_locations).slice(0, 5);
    for (const [name, loc] of entries) {
      const status = validation.valid.includes(name) ? 'OK' : 'MISSING';
      lines.push(`- ${name}: \`${loc}\` [${status}]`);
    }
    lines.push('');
  }

  // Patterns (top 3)
  if (e.patterns && e.patterns.length > 0) {
    lines.push('### Patterns');
    for (const pattern of e.patterns.slice(0, 3)) {
      lines.push(`- **${pattern.name}**: ${pattern.when}`);
    }
    lines.push('');
  }

  // Anti-patterns (top 3)
  if (e.anti_patterns && e.anti_patterns.length > 0) {
    lines.push('### Anti-Patterns (AVOID)');
    for (const ap of e.anti_patterns.slice(0, 3)) {
      lines.push(`- **${ap.name}**: ${ap.what_to_do}`);
    }
    lines.push('');
  }

  // Commands (top 3)
  if (e.commands) {
    lines.push('### Quick Commands');
    const cmds = Object.entries(e.commands).slice(0, 3);
    for (const [name, cmd] of cmds) {
      lines.push(`- ${name}: \`${cmd}\``);
    }
    lines.push('');
  }

  // Validation warnings
  if (validation.missing.length > 0) {
    lines.push('### Warnings');
    lines.push('Missing locations (may have moved):');
    for (const m of validation.missing) {
      lines.push(`- ${m}`);
    }
  }

  return lines.join('\n');
}

async function main() {
  const workDir = process.cwd();

  // Find expertise file
  const expertisePath = findExpertiseFile(workDir);

  if (!expertisePath) {
    console.error('[expert-load] No expertise.yaml found');
    console.error('[expert-load] Expected at: .claude/expertise.yaml');
    return;
  }

  // Load expertise
  let expertise: ExpertiseFile;
  try {
    const content = fs.readFileSync(expertisePath, 'utf-8');
    expertise = yaml.parse(content) as ExpertiseFile;
  } catch (error) {
    console.error(`[expert-load] Failed to parse expertise: ${error}`);
    return;
  }

  // Validate locations
  const validation = validateLocations(
    workDir,
    expertise.expertise.key_locations || {}
  );

  // Format output
  const formatted = formatExpertise(expertise, validation);

  // Detect skill gaps
  const skillGaps = detectSkillGaps(workDir);

  // Output to stderr (visible in session)
  console.error('');
  console.error('='.repeat(50));
  console.error('EXPERTISE LOADED - Read First, Validate, Then Act');
  console.error('='.repeat(50));
  console.error(formatted);

  // Output skill gap detection
  if (skillGaps.length > 0) {
    console.error('');
    console.error('### SKILL GAPS DETECTED');
    console.error('These modules need skills (use /Createskill):');
    for (const gap of skillGaps.slice(0, 5)) {
      console.error(`  - src/modules/${gap}/`);
    }
    if (skillGaps.length > 5) {
      console.error(`  ... and ${skillGaps.length - 5} more`);
    }
  }

  console.error('='.repeat(50));
  console.error('');
}

main().catch(err => {
  console.error(`[expert-load] Error: ${err.message}`);
});
