/**
 * Integration test to ensure no direct database connections in frontend code
 * This test scans the codebase and fails if any direct connections are found
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import * as ts from 'typescript';

describe('No Direct Database Connections', () => {
  const srcDir = join(process.cwd(), 'src');
  // Exclude server-side directories; modules/*/services/, utils/, portal/, scripts/ are server-side
  const excludedDirs = ['api', 'lib', 'tests', '__tests__', 'services', 'scripts', 'utils', 'portal'];
  const _excludedFiles = ['neonServiceAPI.ts'];

  // Patterns that indicate direct database usage
  const dbPatterns = [
    /createNeonClient\s*\(/,
    /(?<!`)sql\s*`/,
    /neon\s*\(/,
    /import.*from\s*['"]@neondatabase\/serverless['"]/,
    /import.*from\s*['"]@\/lib\/neon-sql['"]/,
    /import.*sql.*from\s*['"]@\/lib\/neon['"]/,
  ];

  // Files that are allowed to have database connections (server-side only)
  const allowedFiles = [
    'neonServiceAPI.ts', // API wrapper
    'analyticsApi.ts',   // API service files
    'clientApi.ts',
    'projectApi.ts',
    'sowApi.ts',
    'staffApi.ts',
    'ClientsDebug.tsx',  // Dev-only debug component
    // Server-side, but in directories excludedDirs does not cover (`config/`
    // and a module-root `queries.ts`). Listed as PATHS, not bare filenames:
    // entries containing '/' are matched against the src-relative path exactly
    // (see isExcluded below). `queries.ts` as a
    // basename would have exempted all EIGHT files of that name under src/,
    // handing a free pass to any future one that genuinely leaks DB code into
    // the client — the exact thing this test exists to catch.
    // Both verified as genuinely backend rather than assumed:
    //   reached only from pages/api/** and the WA send clients; no component
    //   imports it, and it appears in no client chunk.
    'modules/communications/whatsapp/config/waProviderConfig.ts',
    //   five files reference it, all in type position and therefore erased at
    //   compile time — StatusPill.tsx, SummaryBar.tsx, FilterBar.tsx and
    //   filters.ts via `import type`, and types.ts via a type-position
    //   `import('...').ReceiptStatus` expression. Nothing is pulled into the
    //   bundle; confirmed absent from every client chunk.
    'modules/receipts/queries.ts',
  ];

  function isExcluded(filePath: string): boolean {
    // Check if file is in excluded directories
    for (const dir of excludedDirs) {
      if (filePath.includes(`/${dir}/`) || filePath.includes(`\\${dir}\\`)) {
        return true;
      }
    }
    
    // Check if file is in allowed list. An entry containing '/' is matched
    // against the path RELATIVE TO src/, exactly — not as a suffix. `endsWith`
    // would have exempted any deeper path ending the same way (a hypothetical
    // src/vendor/modules/receipts/queries.ts), which is a subtler version of
    // the basename hole this replaced. A bare filename still matches by
    // basename, preserving the original entries above.
    const normalised = filePath.replace(/\\/g, '/');
    const relative = normalised.startsWith(srcDir.replace(/\\/g, '/') + '/')
      ? normalised.slice(srcDir.replace(/\\/g, '/').length + 1)
      : normalised;
    const fileName = normalised.split('/').pop() || '';
    return allowedFiles.some((allowed) =>
      allowed.includes('/') ? relative === allowed : fileName === allowed
    );
  }

  /**
   * Offsets of pattern matches that are real CODE, not prose.
   *
   * A doc comment that *describes* a SQL rule is not a database connection,
   * but the patterns above cannot tell the two apart. On 2026-08-07 a JSDoc
   * block in modules/fleet/parking/complianceQueries.ts — explaining that
   * `${cond ? sql`AND x` : sql``}` is broken in this codebase — tripped the
   * `sql\`` pattern and held master's full-suite gate red for two days. The
   * file's actual queries were never what matched.
   *
   * Comment boundaries come from the TypeScript parser, not from a regex.
   * Three hand-rolled lexers were tried first and blind review broke every
   * one of them with valid JS that hid a live query from this gate:
   *
   *   - a character-level string/template scanner desynced on the regex
   *     literal `/a\//` and on a backtick inside `${\'`\'}`;
   *   - a line-oriented scanner read multi-line template CONTINUATION lines
   *     as comments, and a `/*`-shaped line of string data swallowed every
   *     remaining line of the file;
   *   - adding backtick parity fixed that but a stray backtick inside a
   *     `${}` interpolation cleared the parity early and reopened the hole.
   *
   * Each fix moved the defect one layer deeper rather than removing it,
   * because deciding where a comment ends in JS/TS *is* lexing. TypeScript
   * is already a devDependency and does it correctly, including regex
   * literals, nested template interpolations and JSX.
   *
   * Only files whose raw text already matches a pattern are parsed — today
   * four of ~2,600 — so the common case stays a regex scan.
   */
  function codeMatchOffsets(source: string, fileName: string): number[] {
    // Fast path: nothing matches even before comments are considered.
    if (!dbPatterns.some((pattern) => pattern.test(source))) return [];

    const sourceFile = ts.createSourceFile(
      fileName,
      source,
      ts.ScriptTarget.Latest,
      /* setParentNodes */ true,
      fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );

    const comments: Array<[number, number]> = [];
    const seen = new Set<string>();
    const add = (ranges?: ts.CommentRange[]) => {
      for (const range of ranges ?? []) {
        const key = `${range.pos}:${range.end}`;
        if (seen.has(key)) continue;
        seen.add(key);
        comments.push([range.pos, range.end]);
      }
    };

    // Comments are trivia attached to token boundaries, so every token has
    // to be visited — not just the named nodes.
    const visit = (node: ts.Node) => {
      add(ts.getLeadingCommentRanges(source, node.getFullStart()));
      add(ts.getTrailingCommentRanges(source, node.getEnd()));
      for (const child of node.getChildren(sourceFile)) visit(child);
    };
    visit(sourceFile);

    const insideComment = (offset: number) =>
      comments.some(([from, to]) => offset >= from && offset < to);

    const offsets: number[] = [];
    for (const pattern of dbPatterns) {
      const global = new RegExp(pattern.source, `${pattern.flags.replace('g', '')}g`);
      let match: RegExpExecArray | null;
      while ((match = global.exec(source)) !== null) {
        if (!insideComment(match.index)) offsets.push(match.index);
        if (match[0].length === 0) global.lastIndex += 1;
      }
    }
    return offsets.sort((a, b) => a - b);
  }

  const lineOf = (source: string, offset: number) =>
    source.slice(0, offset).split('\n').length;

  it.each([
    ['a direct tagged template', 'const rows = sql`SELECT 1`;', true],
    ['a spaced direct tagged template', 'const rows = sql   `SELECT 1`;', true],
    ['Markdown inline code', 'Every `sql` must return three columns.', false],
  ])('classifies %s correctly', (_name, source, expected) => {
    expect(dbPatterns.some((pattern) => pattern.test(source))).toBe(expected);
  });

  const flags = (source: string) => codeMatchOffsets(source, 'probe.tsx').length > 0;

  // Prose that merely mentions a query. Every one of these matches the raw
  // patterns, so each fails if comment detection regresses to a no-op.
  it.each([
    ['a line comment', '// use sql`SELECT 1` here\nconst a = 1;'],
    ['a JSDoc block', '/**\n * `${c ? sql`AND x` : sql``}` is broken\n */\nconst a = 1;'],
    ['a commented-out query', '/* const r = sql`SELECT 1`; */'],
    ['an indented JSDoc continuation', 'class A {\n  /**\n   * sql`SELECT 1`\n   */\n}'],
    ['a trailing comment after code', 'const a = 1; // sql`SELECT 1`'],
  ])('does not flag %s', (_name, source) => {
    expect(dbPatterns.some((pattern) => pattern.test(source))).toBe(true); // raw text matches
    expect(flags(source)).toBe(false); // the parser knows it is a comment
  });

  // The dangerous direction. Every case here is a vector that broke one of the
  // three hand-rolled lexers this replaced — each hid a live query.
  it.each([
    ['real code below a comment that mentions it', '// sql`SELECT 1`\nconst r = sql`SELECT 2`;'],
    ['a URL in a string on the same line', "const u = 'https://x.com'; const r = sql`SELECT 1`;"],
    ['a regex literal containing an escaped slash', 'const re = /a\\//; const r = sql`SELECT 1`;'],
    ['code following the end of a block comment', '/* note */ const r = sql`SELECT 1`;'],
    ['code after a multi-line block comment ends', '/*\n x\n */ const r = sql`SELECT 1`;'],
    // Round 2: a template continuation line is string DATA, and reading one as
    // a comment swallowed every remaining line of the file.
    [
      'code after a template line that looks like an unterminated block comment',
      'const doc = `\n/* still just string data\n`;\nexport const r = sql`SELECT 1`;',
    ],
    [
      'an interpolated query on a template line that looks like a comment',
      'export const doc = `\n// note: ${sql`SELECT 1`}\n`;',
    ],
    // Round 3: a stray backtick inside a `${}` interpolation desynced parity
    // and cleared the in-template flag, reopening the round-2 hole.
    [
      'a stray backtick in an interpolation, then comment-shaped data, then code',
      "const doc = `\nbefore ${'a literal ` backtick'} after\n/* still just string data\n`;\nexport const r = sql`SELECT 1`;",
    ],
    [
      'a stray backtick in an interpolation, then an interpolated query',
      "const doc = `\nbefore ${'a literal ` backtick'} after\n// still data: ${sql`SELECT 1`}\n`;",
    ],
    ['a query inside a nested template interpolation', 'const a = `${`${sql`SELECT 1`}`}`;'],
  ])('still flags %s', (_name, source) => {
    expect(flags(source)).toBe(true);
  });

  it('reports the line of the first real match, not of a comment', () => {
    const source = '/**\n * sql`X`\n */\nconst r = sql`SELECT 1`;';
    const offsets = codeMatchOffsets(source, 'probe.ts');
    expect(offsets).toHaveLength(1);
    expect(lineOf(source, offsets[0])).toBe(4);
  });

  it('reports the correct line with CRLF endings', () => {
    const source = '/**\r\n * sql`X`\r\n */\r\nconst r = sql`SELECT 1`;';
    const offsets = codeMatchOffsets(source, 'probe.ts');
    expect(offsets).toHaveLength(1);
    expect(lineOf(source, offsets[0])).toBe(4);
  });

  it('still flags code in a file the parser cannot fully parse', () => {
    // createSourceFile is error-tolerant; a syntax error must not silence the
    // gate by making every match look like trivia.
    expect(flags('const r = sql`SELECT 1`;\nfunction ( { ] }')).toBe(true);
  });

  it('scans the metrics snapshot source instead of allowlisting it', () => {
    const metricsSource = join(srcDir, 'modules/metrics/snapshot/sources.ts');
    expect(isExcluded(metricsSource)).toBe(false);
  });

  function scanDirectory(dir: string): string[] {
    const violations: string[] = [];
    
    try {
      const files = readdirSync(dir);
      
      for (const file of files) {
        const filePath = join(dir, file);
        const stat = statSync(filePath);
        
        if (stat.isDirectory()) {
          // Skip excluded directories
          if (!excludedDirs.includes(file) && !file.startsWith('.')) {
            violations.push(...scanDirectory(filePath));
          }
        } else if (file.endsWith('.ts') || file.endsWith('.tsx')) {
          // Skip excluded files
          if (!isExcluded(filePath)) {
            // This gate is about code that opens a database connection, not
            // prose that mentions one, so matches inside comments don't count.
            const content = readFileSync(filePath, 'utf-8');
            const offsets = codeMatchOffsets(content, filePath);

            if (offsets.length > 0) {
              // Report the first real one; one violation per file.
              violations.push(
                `${filePath}:${lineOf(content, offsets[0])} - Direct database connection found`,
              );
            }
          }
        }
      }
    } catch (error) {
      console.error(`Error scanning directory ${dir}:`, error);
    }
    
    return violations;
  }

  it('should not have any direct database connections in frontend code', () => {
    const violations = scanDirectory(srcDir);
    
    if (violations.length > 0) {
      console.error('\nDirect database connections found in frontend code:');
      violations.forEach(v => console.error(`  - ${v}`));
      console.error('\nThese files should use API endpoints instead of direct database connections.');
      console.error('Move database logic to /api routes or use existing API services.\n');
    }
    
    expect(violations).toHaveLength(0);
  });

  it('should use API services for data access', () => {
    // Check that API service files exist (project/ moved to directory structure)
    const apiServices = [
      'src/services/api/clientApi.ts',
      'src/services/api/project/index.ts',
      'src/services/api/sowApi.ts',
    ];
    
    const missingServices: string[] = [];
    
    for (const service of apiServices) {
      const servicePath = join(process.cwd(), service);
      try {
        statSync(servicePath);
      } catch {
        missingServices.push(service);
      }
    }
    
    if (missingServices.length > 0) {
      console.error('\nMissing API service files:');
      missingServices.forEach(s => console.error(`  - ${s}`));
    }
    
    expect(missingServices).toHaveLength(0);
  });

  it('should have proper API endpoints for database operations', () => {
    // Check that API endpoints exist (Next.js pages/api structure)
    const apiEndpoints = [
      'src/pages/api/health/index.ts',
      'src/pages/api/projects/[projectId]/sp-tracker.ts',
    ];
    
    const missingEndpoints: string[] = [];
    
    for (const endpoint of apiEndpoints) {
      const endpointPath = join(process.cwd(), endpoint);
      try {
        statSync(endpointPath);
      } catch {
        missingEndpoints.push(endpoint);
      }
    }
    
    if (missingEndpoints.length > 0) {
      console.error('\nMissing API endpoints:');
      missingEndpoints.forEach(e => console.error(`  - ${e}`));
      console.error('\nThese endpoints are required for database operations.');
    }
    
    expect(missingEndpoints).toHaveLength(0);
  });
});
