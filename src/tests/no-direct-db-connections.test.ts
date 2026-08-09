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
  /**
   * Blank out comments before scanning, keeping line numbers intact.
   *
   * The patterns below look for code, but a regex over raw text also matches
   * PROSE about code. src/modules/fleet/parking/complianceQueries.ts documents
   * why conditional SQL fragments are broken in this codebase — and quoting the
   * broken form in that explanation was enough to report the file as a direct
   * database connection, at the comment's line rather than any import. A guard
   * that fires on documentation teaches people to stop writing it.
   *
   * This walks the source rather than running two regexes over it, because
   * regexes cannot tell a comment from a string that merely contains one.
   * `'//cdn.example.com'` would start a "line comment" and blank the real code
   * after it, and an unterminated `/*` inside a string would swallow everything
   * up to the next real close-comment several lines away — both of which make
   * the guard MISS genuine database calls. Tracking quote state is the whole
   * difference between hiding prose and hiding evidence.
   */
  function stripComments(source: string): string {
    let out = '';
    let i = 0;
    // One of: null (code), "'" / '"' / '`' (inside that string), '//', '/*'
    let state: string | null = null;

    while (i < source.length) {
      const ch = source[i]!;
      const next = source[i + 1];

      if (state === null) {
        if (ch === '/' && next === '/') { state = '//'; out += '  '; i += 2; continue; }
        if (ch === '/' && next === '*') { state = '/*'; out += '  '; i += 2; continue; }
        if (ch === "'" || ch === '"' || ch === '`') { state = ch; out += ch; i += 1; continue; }
        out += ch; i += 1; continue;
      }

      if (state === '//') {
        if (ch === '\n') { state = null; out += ch; } else { out += ' '; }
        i += 1; continue;
      }

      if (state === '/*') {
        if (ch === '*' && next === '/') { state = null; out += '  '; i += 2; continue; }
        out += ch === '\n' ? ch : ' ';
        i += 1; continue;
      }

      // Inside a string literal: copy through, honouring escapes so a trailing
      // backslash cannot end the string early.
      if (ch === '\\') { out += source.slice(i, i + 2); i += 2; continue; }
      if (ch === state) { state = null; }
      out += ch; i += 1; continue;
    }
    return out;
  }

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

  it.each([
    ['a direct tagged template', 'const rows = sql`SELECT 1`;', true],
    ['a spaced direct tagged template', 'const rows = sql   `SELECT 1`;', true],
    ['Markdown inline code', 'Every `sql` must return three columns.', false],
  ])('classifies %s correctly', (_name, source, expected) => {
    expect(dbPatterns.some((pattern) => pattern.test(source))).toBe(expected);
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

  it('ignores database patterns that appear only inside comments', () => {
    // The regression: a file documenting why `sql`AND x`` fragments are broken
    // was itself reported as a direct database connection, at the comment's
    // line. Real connections are code, never prose.
    const prose = [
      '/**',
      ' * Explains that ${cond ? sql`AND x` : sql``} is broken here.',
      ' */',
      "import { thing } from '@/lib/thing';",
    ].join('\n');
    expect(dbPatterns.some((pattern) => pattern.test(stripComments(prose)))).toBe(false);

    // ...and the same text as CODE still trips it, so stripping comments has
    // not blunted the guard.
    const code = 'const rows = await sql`SELECT 1`;';
    expect(dbPatterns.some((pattern) => pattern.test(stripComments(code)))).toBe(true);
  });

  it('does not let a string containing comment markers hide real code', () => {
    // These are the ways a regex-based stripper silently blinds the guard.
    // Each case has a REAL sql`` call that must still be detected.
    const cases: Array<[string, string]> = [
      [
        'protocol-relative URL starts a fake line comment',
        "const url = '//cdn.example.com'; const rows = await sql`SELECT 1`;",
      ],
      [
        'comment marker inside a template literal',
        'const note = `see //notes`; const rows = await sql`SELECT 1`;',
      ],
      [
        'unterminated block-comment marker in a string swallows later code',
        [
          "const a = '/* not a comment';",
          'const rows = await sql`SELECT 1`;',
          '/* a genuine comment */',
        ].join('\n'),
      ],
      [
        'escaped quote must not end the string early',
        "const s = 'it\\'s fine'; const rows = await sql`SELECT 1`;",
      ],
    ];
    for (const [label, source] of cases) {
      const detected = dbPatterns.some((pattern) => pattern.test(stripComments(source)));
      expect(detected, `should still detect the sql call: ${label}`).toBe(true);
    }
  });

  it('still blanks a real comment that follows code on the same line', () => {
    const source = "const x = 1; // mentions sql`SELECT 1` in passing";
    expect(dbPatterns.some((pattern) => pattern.test(stripComments(source)))).toBe(false);
  });

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
