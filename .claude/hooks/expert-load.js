#!/usr/bin/env node

/**
 * Expert Load Hook - FibreFlow
 *
 * Loads expertise.yaml at session start and injects into context.
 * Ensures agent has "mental model" of FF before acting.
 *
 * Hook Type: SessionStart
 */

const fs = require('fs');
const path = require('path');

// Simple YAML parser for basic structure (no external deps)
function parseSimpleYaml(content) {
  const lines = content.split('\n');
  const result = { expertise: {} };
  let currentSection = null;
  let currentList = null;
  let currentItem = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    // Top level key
    if (line.match(/^expertise:/)) {
      continue;
    }

    // Section headers (2 spaces)
    const sectionMatch = line.match(/^  (\w+):\s*(.*)$/);
    if (sectionMatch) {
      const [, key, value] = sectionMatch;
      if (value) {
        result.expertise[key] = value;
      } else {
        currentSection = key;
        if (key === 'key_locations' || key === 'commands') {
          result.expertise[key] = {};
        } else if (key === 'patterns' || key === 'anti_patterns') {
          result.expertise[key] = [];
          currentList = result.expertise[key];
        }
      }
      continue;
    }

    // Key-value pairs in objects (4 spaces)
    const kvMatch = line.match(/^    (\w+):\s*(.+)$/);
    if (kvMatch && currentSection && typeof result.expertise[currentSection] === 'object' && !Array.isArray(result.expertise[currentSection])) {
      const [, key, value] = kvMatch;
      result.expertise[currentSection][key] = value.replace(/^['"]|['"]$/g, '');
      continue;
    }

    // List items
    if (line.match(/^    - /)) {
      if (currentList) {
        currentItem = {};
        currentList.push(currentItem);
      }
      const itemMatch = line.match(/^    - (\w+):\s*(.*)$/);
      if (itemMatch && currentItem) {
        currentItem[itemMatch[1]] = itemMatch[2].replace(/^['"]|['"]$/g, '');
      }
      continue;
    }

    // List item properties (6 spaces)
    const propMatch = line.match(/^      (\w+):\s*(.+)$/);
    if (propMatch && currentItem) {
      currentItem[propMatch[1]] = propMatch[2].replace(/^['"]|['"]$/g, '');
    }
  }

  return result;
}

function findExpertiseFile(startDir) {
  const expertisePath = path.join(startDir, '.claude', 'expertise.yaml');
  if (fs.existsSync(expertisePath)) {
    return expertisePath;
  }
  return null;
}

function detectSkillGaps(baseDir) {
  const gaps = [];
  const modulesDir = path.join(baseDir, 'src', 'modules');
  const skillsDir = path.join(baseDir, '.claude', 'skills', 'modules');

  if (!fs.existsSync(modulesDir) || !fs.existsSync(skillsDir)) {
    return gaps;
  }

  const modules = fs.readdirSync(modulesDir, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name);

  const skills = fs.readdirSync(skillsDir)
    .filter(f => f.endsWith('.md'))
    .map(f => f.replace('.md', '').toLowerCase());

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

function validateLocations(baseDir, locations) {
  const valid = [];
  const missing = [];

  for (const [name, loc] of Object.entries(locations || {})) {
    const fullPath = path.join(baseDir, loc);
    if (fs.existsSync(fullPath)) {
      valid.push(name);
    } else {
      missing.push(`${name} (${loc})`);
    }
  }

  return { valid, missing };
}

function formatExpertise(expertise, validation) {
  const e = expertise.expertise;
  const lines = [];

  lines.push(`## Project Expertise: ${e.project || 'Unknown'}`);
  lines.push(`Domain: ${e.domain || 'N/A'} | Version: ${e.version || 'N/A'} | Updated: ${e.last_updated || 'N/A'}`);
  lines.push('');

  if (e.key_locations && Object.keys(e.key_locations).length > 0) {
    lines.push('### Key Locations');
    const entries = Object.entries(e.key_locations).slice(0, 5);
    for (const [name, loc] of entries) {
      const status = validation.valid.includes(name) ? 'OK' : 'MISSING';
      lines.push(`- ${name}: \`${loc}\` [${status}]`);
    }
    lines.push('');
  }

  if (e.patterns && e.patterns.length > 0) {
    lines.push('### Patterns');
    for (const pattern of e.patterns.slice(0, 3)) {
      lines.push(`- **${pattern.name}**: ${pattern.when}`);
    }
    lines.push('');
  }

  if (e.anti_patterns && e.anti_patterns.length > 0) {
    lines.push('### Anti-Patterns (AVOID)');
    for (const ap of e.anti_patterns.slice(0, 3)) {
      lines.push(`- **${ap.name}**: ${ap.what_to_do}`);
    }
    lines.push('');
  }

  if (e.commands && Object.keys(e.commands).length > 0) {
    lines.push('### Quick Commands');
    const cmds = Object.entries(e.commands).slice(0, 3);
    for (const [name, cmd] of cmds) {
      lines.push(`- ${name}: \`${cmd}\``);
    }
    lines.push('');
  }

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

  const expertisePath = findExpertiseFile(workDir);

  if (!expertisePath) {
    console.error('[expert-load] No expertise.yaml found');
    return;
  }

  let expertise;
  try {
    const content = fs.readFileSync(expertisePath, 'utf-8');
    expertise = parseSimpleYaml(content);
  } catch (error) {
    console.error(`[expert-load] Failed to parse expertise: ${error.message}`);
    return;
  }

  const validation = validateLocations(
    workDir,
    expertise.expertise.key_locations || {}
  );

  const formatted = formatExpertise(expertise, validation);
  const skillGaps = detectSkillGaps(workDir);

  console.error('');
  console.error('='.repeat(50));
  console.error('EXPERTISE LOADED - Read First, Validate, Then Act');
  console.error('='.repeat(50));
  console.error(formatted);

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
