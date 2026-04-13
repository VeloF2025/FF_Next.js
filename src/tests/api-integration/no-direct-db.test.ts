import fs from 'fs';
import { glob } from 'glob';

describe('No Direct Database Connections', () => {
  test('Frontend code should not import database clients', async () => {
    const srcFiles = await glob('src/**/*.{ts,tsx}', {
      ignore: [
        'src/lib/**', 
        'src/api/**', 
        '**/node_modules/**',
        'src/tests/**'
      ]
    });

    const violations: { file: string; lines: string[] }[] = [];
    
    const dbPatterns = [
      /import\s*{\s*sql\s*}\s*from\s*['"]@\/lib\/neon['"]/,
      /import\s*.*\s*from\s*['"]@\/lib\/neon['"]/,
      /createNeonClient/,
      /neon\(/,
      /\.query\(/,
      /\.execute\(/,
      /BEGIN;/,
      /COMMIT;/,
      /ROLLBACK;/
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