#!/usr/bin/env tsx
/**
 * Drift gate for CLAUDE.md / .claude.md docs.
 * Greps every path-shaped reference and fails if the path doesn't exist on disk.
 *
 * Usage: npm run claude-md:check
 *        npm run claude-md:check -- --strict   (fail on stale paths)
 */

import { readFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';

const REPO_ROOT = resolve(__dirname, '..');
const STRICT = process.argv.includes('--strict');

const DOC_GLOBS = [
  'CLAUDE.md',
  '.claude/**/*.md',
  'src/**/.claude.md',
  'src/**/CLAUDE.md',
];

const PATH_REGEXES: { name: string; re: RegExp }[] = [
  { name: 'backtick-path', re: /`((?:\.\/)?(?:src|scripts|pages|app|public|docs|\.claude|neon|tests|server)\/[^\s`]+?)`/g },
  { name: 'backtick-relpath', re: /`(\.{1,2}\/[^\s`]+?)`/g },
];

const IGNORE_PATTERNS = [
  /^https?:/,
  /^@\//,
  /\$\{/,
  /\*/,
  /\.\.\..*$/,
  /^node_modules\//,
  /<[^>]+>/,    // template placeholders like <name>, <area>
  /\{[^}]+\}/,  // template placeholders like {feature}, {module}
];

// Paths that exist locally but are gitignored — skip in drift detection.
const GITIGNORED_PATHS = [
  '.claude/credentials.local.md',
];

interface Finding {
  doc: string;
  line: number;
  rawPath: string;
  resolved: string;
}

function listDocs(): string[] {
  const out = execFileSync(
    'git',
    ['ls-files', '--', ...DOC_GLOBS],
    { cwd: REPO_ROOT, encoding: 'utf8' },
  );
  return out
    .split('\n')
    .filter((l) => l.trim().length > 0)
    .filter((l) => !l.includes('node_modules'));
}

function checkDoc(docRel: string): Finding[] {
  const docAbs = join(REPO_ROOT, docRel);
  const content = readFileSync(docAbs, 'utf8');
  const lines = content.split('\n');
  const findings: Finding[] = [];
  const docDir = dirname(docAbs);

  lines.forEach((line, idx) => {
    for (const { re } of PATH_REGEXES) {
      re.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = re.exec(line)) !== null) {
        const raw = match[1];
        if (IGNORE_PATTERNS.some((p) => p.test(raw))) continue;

        // Strip trailing punctuation and `:line-num` / `:line-start-end` suffixes used in code-review docs
        const cleaned = raw
          .replace(/[`,)\].]+$/, '')
          .replace(/:\d+(-\d+)?$/, '');
        if (GITIGNORED_PATHS.includes(cleaned)) continue;

        const resolved = cleaned.startsWith('./') || cleaned.startsWith('../')
          ? resolve(docDir, cleaned)
          : resolve(REPO_ROOT, cleaned);

        if (!existsSync(resolved)) {
          findings.push({ doc: docRel, line: idx + 1, rawPath: raw, resolved });
        }
      }
    }
  });

  return findings;
}

function main(): void {
  const docs = listDocs();
  console.log(`Scanning ${docs.length} doc files for stale paths...`);

  const allFindings: Finding[] = [];
  for (const doc of docs) {
    try {
      allFindings.push(...checkDoc(doc));
    } catch (err) {
      console.warn(`  skipped ${doc}: ${(err as Error).message}`);
    }
  }

  if (allFindings.length === 0) {
    console.log('✓ All referenced paths exist.');
    return;
  }

  console.log(`\nFound ${allFindings.length} stale path reference(s):\n`);
  const byDoc = new Map<string, Finding[]>();
  for (const f of allFindings) {
    if (!byDoc.has(f.doc)) byDoc.set(f.doc, []);
    byDoc.get(f.doc)!.push(f);
  }

  for (const [doc, list] of byDoc) {
    console.log(`  ${doc}:`);
    for (const f of list) {
      console.log(`    L${f.line}  ${f.rawPath}`);
    }
  }

  if (STRICT) {
    console.error(`\n✗ ${allFindings.length} stale path(s) — failing (strict mode).`);
    process.exit(1);
  } else {
    console.log(`\n(non-strict mode — re-run with --strict to fail CI)`);
  }
}

main();
