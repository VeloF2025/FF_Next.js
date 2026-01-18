#!/usr/bin/env node

/**
 * Failed Task Analyzer Hook - FibreFlow
 *
 * Analyzes failed tasks and errors to suggest new skills or documentation.
 * Tracks patterns of repeated issues that indicate missing knowledge.
 *
 * Hook Type: PostToolUse (monitors Bash errors, API failures)
 *
 * Actions:
 * - Logs failed patterns to .claude/memories/failed-patterns.json
 * - Suggests skill creation when pattern repeats 3+ times
 * - Identifies knowledge gaps from error messages
 */

import * as fs from 'fs';
import * as path from 'path';

interface FailedPattern {
  pattern: string;
  module: string | null;
  count: number;
  lastSeen: string;
  suggestedSkill: string | null;
}

interface FailedPatternsStore {
  patterns: FailedPattern[];
  lastAnalyzed: string;
}

const PATTERNS_FILE = '.claude/memories/failed-patterns.json';
const THRESHOLD = 3; // Suggest skill after 3 occurrences

function loadPatterns(workDir: string): FailedPatternsStore {
  const filePath = path.join(workDir, PATTERNS_FILE);
  if (fs.existsSync(filePath)) {
    try {
      return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    } catch {
      return { patterns: [], lastAnalyzed: new Date().toISOString() };
    }
  }
  return { patterns: [], lastAnalyzed: new Date().toISOString() };
}

function savePatterns(workDir: string, store: FailedPatternsStore): void {
  const filePath = path.join(workDir, PATTERNS_FILE);
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(filePath, JSON.stringify(store, null, 2));
}

function extractErrorPattern(output: string): { pattern: string; module: string | null } | null {
  // Common error patterns that indicate missing knowledge
  const errorPatterns = [
    // Module-specific errors
    { regex: /src\/modules\/([^/]+).*(?:not found|undefined|error)/i, type: 'module' },
    // API errors
    { regex: /\/api\/([^/]+).*(?:500|404|failed)/i, type: 'api' },
    // Database errors
    { regex: /table "([^"]+)".*(?:not exist|error)/i, type: 'database' },
    // Service errors
    { regex: /(VLM|WhatsApp|OneMap|Sage).*(?:timeout|failed|error)/i, type: 'service' },
    // Config errors
    { regex: /(?:missing|invalid).*(?:config|env|setting)/i, type: 'config' },
  ];

  for (const { regex, type } of errorPatterns) {
    const match = output.match(regex);
    if (match) {
      return {
        pattern: `${type}:${match[1] || match[0].slice(0, 50)}`,
        module: type === 'module' ? match[1] : null,
      };
    }
  }

  return null;
}

function suggestSkillName(pattern: string, module: string | null): string {
  if (module) {
    return `modules/${module}.md`;
  }

  if (pattern.startsWith('api:')) {
    return `integrations/${pattern.split(':')[1]}.md`;
  }

  if (pattern.startsWith('service:')) {
    return `infrastructure/${pattern.split(':')[1].toLowerCase()}.md`;
  }

  if (pattern.startsWith('database:')) {
    return `infrastructure/database.md`;
  }

  return `workflows/${pattern.replace(/[^a-z0-9]/gi, '-').toLowerCase()}.md`;
}

function analyzeFailure(workDir: string, output: string): void {
  const extracted = extractErrorPattern(output);
  if (!extracted) return;

  const store = loadPatterns(workDir);
  const existingIndex = store.patterns.findIndex(p => p.pattern === extracted.pattern);

  if (existingIndex >= 0) {
    // Increment existing pattern
    store.patterns[existingIndex].count++;
    store.patterns[existingIndex].lastSeen = new Date().toISOString();
  } else {
    // Add new pattern
    store.patterns.push({
      pattern: extracted.pattern,
      module: extracted.module,
      count: 1,
      lastSeen: new Date().toISOString(),
      suggestedSkill: suggestSkillName(extracted.pattern, extracted.module),
    });
  }

  store.lastAnalyzed = new Date().toISOString();
  savePatterns(workDir, store);

  // Check if threshold reached
  const pattern = store.patterns.find(p => p.pattern === extracted.pattern);
  if (pattern && pattern.count >= THRESHOLD) {
    console.error('');
    console.error('━'.repeat(50));
    console.error('🔍 REPEATED FAILURE PATTERN DETECTED');
    console.error('━'.repeat(50));
    console.error(`Pattern: ${pattern.pattern}`);
    console.error(`Occurrences: ${pattern.count}`);
    console.error('');
    console.error('💡 Suggested action: Create skill to document this');
    console.error(`   Skill: .claude/skills/${pattern.suggestedSkill}`);
    console.error('   Run: /Createskill to generate');
    console.error('━'.repeat(50));
    console.error('');
  }
}

function main() {
  const toolResult = process.env.TOOL_RESULT || '';
  const workDir = process.cwd();

  // Only analyze if there's an error indicator
  if (
    toolResult.includes('error') ||
    toolResult.includes('Error') ||
    toolResult.includes('failed') ||
    toolResult.includes('not found') ||
    toolResult.includes('Exit code')
  ) {
    analyzeFailure(workDir, toolResult);
  }
}

main();
