/**
 * Integration test to ensure no direct database connections in frontend code
 * This test scans the codebase and fails if any direct connections are found
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

describe('No Direct Database Connections', () => {
  const srcDir = join(process.cwd(), 'src');
  const excludedDirs = ['api', 'lib/neon', 'tests'];
  const _excludedFiles = ['neonServiceAPI.ts'];
  
  // Patterns that indicate direct database usage
  const dbPatterns = [
    /createNeonClient\s*\(/,
    /sql\s*`/,
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
  ];

  function isExcluded(filePath: string): boolean {
    // Check if file is in excluded directories
    for (const dir of excludedDirs) {
      if (filePath.includes(`/${dir}/`) || filePath.includes(`\\${dir}\\`)) {
        return true;
      }
    }
    
    // Check if file is in allowed list
    const fileName = filePath.split('/').pop() || filePath.split('\\').pop() || '';
    return allowedFiles.includes(fileName);
  }

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
            const content = readFileSync(filePath, 'utf-8');
            
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
    // Check that API service files exist
    const apiServices = [
      'src/services/api/clientApi.ts',
      'src/services/api/projectApi.ts',
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
    // Check that API endpoints exist
    const apiEndpoints = [
      'api/clients/index.js',
      'api/projects/index.js',
      'api/staff/index.js',
      'api/sow/index.js',
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