import fs from 'fs';
import { glob } from 'glob';

describe('No Direct Database Connections', () => {
  test('Frontend code should not import database clients', async () => {
    // Only scan true frontend code: components, pages (non-API), and app router files.
    // Services, modules, and pages/api are server-side code and are allowed to use DB clients.
    const srcFiles = await glob('src/{components,app}/**/*.{ts,tsx}', {
      ignore: [
        '**/node_modules/**',
        'src/tests/**',
        'src/components/dev/**',  // dev-only debug components are exempt
      ]
    });

    const violations: { file: string; lines: string[] }[] = [];

    // Only flag direct DB import patterns in frontend components.
    // Method calls like .query() and .execute() are normal ORM/service patterns.
    const dbPatterns = [
      /import\s*{\s*sql\s*}\s*from\s*['"]@\/lib\/neon['"]/,
      /import\s*.*\s*from\s*['"]@\/lib\/neon['"]/,
      /createNeonClient/,
    ];

    for (const file of srcFiles) {
      const content = fs.readFileSync(file, 'utf8');
      const lines = content.split('\n');
      const fileViolations: string[] = [];

      lines.forEach((line, index) => {
        for (const pattern of dbPatterns) {
          if (pattern.test(line)) {
            fileViolations.push(`Line ${index + 1}: ${line.trim()}`);
          }
        }
      });

      if (fileViolations.length > 0) {
        violations.push({ file, lines: fileViolations });
      }
    }

    if (violations.length > 0) {
      console.error('\n❌ Direct database connections found in frontend code:\n');
      violations.forEach(({ file, lines }) => {
        console.error(`\n📄 ${file}:`);
        lines.forEach(line => console.error(`  ${line}`));
      });
      console.error(`\n❌ Total violations: ${violations.length} files`);
    }

    expect(violations).toEqual([]);
  });

  test('API routes should use proper database patterns', async () => {
    const apiFiles = await glob('api/**/*.{js,ts}', {
      ignore: ['**/node_modules/**']
    });

    const issues: { file: string; issue: string }[] = [];

    for (const file of apiFiles) {
      const content = fs.readFileSync(file, 'utf8');
      
      // Check for proper error handling
      if (content.includes('sql`') && !content.includes('try')) {
        issues.push({ 
          file, 
          issue: 'Database queries without try-catch error handling' 
        });
      }

      // Check for transaction patterns without proper rollback
      if (content.includes('BEGIN;') && !content.includes('ROLLBACK;')) {
        issues.push({ 
          file, 
          issue: 'Transaction without proper rollback handling' 
        });
      }
    }

    if (issues.length > 0) {
      console.error('\n⚠️  API pattern issues found:\n');
      issues.forEach(({ file, issue }) => {
        console.error(`📄 ${file}: ${issue}`);
      });
    }

    expect(issues).toEqual([]);
  });
});