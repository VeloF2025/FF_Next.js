/**
 * Integration test to ensure no direct database connections in frontend code
 * This test scans the codebase and fails if any direct connections are found
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

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
   * Blank out comments so the scanner sees code, not prose.
   *
   * A doc comment that *describes* a SQL rule is not a database connection,
   * but the patterns above cannot tell the two apart. On 2026-08-07 a JSDoc
   * block in modules/fleet/parking/complianceQueries.ts — explaining that
   * `${cond ? sql`AND x` : sql``}` is broken in this codebase — tripped the
   * `sql\`` pattern and held master's full-suite gate red for two days. The
   * file's actual queries were never what matched.
   *
   * Comment bodies become spaces rather than being deleted, so every surviving
   * character keeps its original line and column and the line number reported
   * below still points at the real offender.
   *
   * Deliberately line-oriented, and deliberately conservative: a line is only
   * blanked from the point where a comment DEMONSTRABLY begins the line's
   * content. Nothing is ever blanked on a line that has code in front of the
   * comment marker.
   *
   * That asymmetry is the whole design. This is a guard, so the two error
   * directions are not equal: a false positive is loud, visible and quickly
   * fixed, while a false negative silently licenses the exact thing the guard
   * exists to stop. A character-level scanner tracking string and template
   * state is more precise in the common case and strictly more dangerous in
   * the uncommon one — a regex literal like `/a\//`, or a backtick inside a
   * `${}` interpolation, desyncs it, and from there it blanks real code until
   * the next newline or `*​/`. Precision is not worth a hole in a guard.
   *
   * Accepted cost: a trailing comment (`const a = 1; // sql`X``) is still
   * scanned and can still raise a false positive. If that ever fires, write
   * the comment on its own line.
   */
  function stripComments(source: string): string {
    const blank = (text: string) => text.replace(/[^\n\r]/g, ' ');
    let inBlock = false;

    return source
      .split('\n')
      .map((line) => {
        if (inBlock) {
          const end = line.indexOf('*/');
          if (end === -1) return blank(line);
          inBlock = false;
          // Keep anything after the block ends — code may follow `*/`.
          return blank(line.slice(0, end + 2)) + line.slice(end + 2);
        }

        const indent = line.length - line.trimStart().length;
        const trimmed = line.trimStart();

        if (trimmed.startsWith('//')) return blank(line);

        if (trimmed.startsWith('/*')) {
          const end = line.indexOf('*/', indent + 2);
          if (end === -1) {
            inBlock = true;
            return blank(line);
          }
          return blank(line.slice(0, end + 2)) + line.slice(end + 2);
        }

        // A continuation line of a block comment is handled by `inBlock`
        // above; anything else is code and is left exactly as written.
        return line;
      })
      .join('\n');
  }

  it.each([
    ['a direct tagged template', 'const rows = sql`SELECT 1`;', true],
    ['a spaced direct tagged template', 'const rows = sql   `SELECT 1`;', true],
    ['Markdown inline code', 'Every `sql` must return three columns.', false],
  ])('classifies %s correctly', (_name, source, expected) => {
    expect(dbPatterns.some((pattern) => pattern.test(source))).toBe(expected);
  });

  const scanMatches = (source: string) =>
    dbPatterns.some((pattern) => pattern.test(stripComments(source)));

  // Comment-only text must not raise a violation. Each of these DOES match the
  // raw patterns, so each one fails if stripComments becomes a no-op.
  it.each([
    ['a line comment', '// use sql`SELECT 1` here\nconst a = 1;'],
    ['a JSDoc block', '/**\n * `${c ? sql`AND x` : sql``}` is broken\n */\nconst a = 1;'],
    ['a commented-out query', '/* const r = sql`SELECT 1`; */'],
    ['an indented JSDoc continuation', 'class A {\n  /**\n   * sql`SELECT 1`\n   */\n}'],
  ])('does not flag %s', (_name, source) => {
    expect(dbPatterns.some((pattern) => pattern.test(source))).toBe(true); // raw text matches
    expect(scanMatches(source)).toBe(false); // stripped text does not
  });

  // The dangerous direction: real code must survive stripping. Each of these
  // fails if stripComments over-reaches and blanks live code — the two
  // desync vectors a character-level string/template scanner is prone to.
  it.each([
    ['real code below a comment that mentions it', '// sql`SELECT 1`\nconst r = sql`SELECT 2`;'],
    ['a URL in a string on the same line', "const u = 'https://x.com'; const r = sql`SELECT 1`;"],
    ['a regex literal containing an escaped slash', 'const re = /a\\//; const r = sql`SELECT 1`;'],
    ['a backtick inside a nested interpolation', "const a = `${'`'}`;\nconst r = sql`SELECT 1`;"],
    ['code following the end of a block comment', '/* note */ const r = sql`SELECT 1`;'],
    ['code after a multi-line block comment ends', '/*\n x\n */ const r = sql`SELECT 1`;'],
  ])('still flags %s', (_name, source) => {
    expect(scanMatches(source)).toBe(true);
  });

  it('preserves line numbers when blanking comments', () => {
    const source = '/**\n * sql`X`\n */\nconst r = sql`SELECT 1`;';
    const scanned = stripComments(source);
    expect(scanned.split('\n')).toHaveLength(4);
    const hit = scanned.split('\n').findIndex((line) => /(?<!`)sql\s*`/.test(line)) + 1;
    expect(hit).toBe(4);
  });

  it('preserves CRLF line structure', () => {
    const scanned = stripComments('/**\r\n * sql`X`\r\n */\r\nconst r = sql`SELECT 1`;');
    expect(scanned.split('\n')).toHaveLength(4);
    expect(scanned.split('\r\n')).toHaveLength(4);
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
            // Comments are blanked first: this gate is about code that opens a
            // database connection, not prose that mentions one.
            const content = stripComments(readFileSync(filePath, 'utf-8'));

            // Check for database patterns
            for (const pattern of dbPatterns) {
              if (pattern.test(content)) {
                // Find line number for better error reporting
                const lines = content.split('\n');
                const lineNumber = lines.findIndex(line => pattern.test(line)) + 1;
                violations.push(`${filePath}:${lineNumber} - Direct database connection found`);
                break; // Only report once per file
              }
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
