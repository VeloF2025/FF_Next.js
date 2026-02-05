/**
 * JSON Report Generator
 * Generates machine-readable JSON reports for CI/CD integration
 */

import * as fs from 'fs';
import * as path from 'path';
import { config } from '../config';
import { type AuditResult } from '../types';

/**
 * Generate JSON report content
 */
export function generateJsonReport(result: AuditResult): string {
  return JSON.stringify(result, null, 2);
}

/**
 * Write JSON report to file
 */
export async function writeJsonReport(result: AuditResult): Promise<string> {
  const date = result.startTime.split('T')[0];
  const filename = `${date}.json`;
  const outputPath = path.resolve(process.cwd(), config.reports.jsonDir, filename);

  // Ensure directory exists
  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // Write current result
  fs.writeFileSync(outputPath, generateJsonReport(result), 'utf8');

  // Also write latest.json for easy access
  const latestPath = path.resolve(process.cwd(), config.reports.jsonDir, 'latest.json');
  fs.writeFileSync(latestPath, generateJsonReport(result), 'utf8');

  // Clean up old reports
  cleanupOldReports(dir);

  return outputPath;
}

/**
 * Clean up reports older than retention period
 */
function cleanupOldReports(dir: string): void {
  const files = fs.readdirSync(dir);
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - config.reports.retentionDays);

  for (const file of files) {
    if (!file.endsWith('.json') || file === 'latest.json') {
      continue;
    }

    // Extract date from filename (YYYY-MM-DD.json)
    const dateStr = file.replace('.json', '');
    const fileDate = new Date(dateStr);

    if (fileDate < cutoff) {
      const filePath = path.join(dir, file);
      fs.unlinkSync(filePath);
    }
  }
}

/**
 * Read historical reports
 */
export function readHistoricalReports(days: number = 7): AuditResult[] {
  const dir = path.resolve(process.cwd(), config.reports.jsonDir);
  if (!fs.existsSync(dir)) {
    return [];
  }

  const files = fs.readdirSync(dir)
    .filter((f) => f.endsWith('.json') && f !== 'latest.json')
    .sort()
    .reverse()
    .slice(0, days);

  const reports: AuditResult[] = [];

  for (const file of files) {
    try {
      const content = fs.readFileSync(path.join(dir, file), 'utf8');
      reports.push(JSON.parse(content));
    } catch {
      // Skip invalid files
    }
  }

  return reports;
}

/**
 * Get trend data from historical reports
 */
export function getTrendData(days: number = 7): {
  dates: string[];
  passRates: number[];
  failCounts: number[];
  totalTests: number[];
} {
  const reports = readHistoricalReports(days);

  return {
    dates: reports.map((r) => r.startTime.split('T')[0]),
    passRates: reports.map((r) =>
      r.summary.totalTests > 0
        ? (r.summary.passed / r.summary.totalTests) * 100
        : 0
    ),
    failCounts: reports.map((r) => r.summary.failed),
    totalTests: reports.map((r) => r.summary.totalTests),
  };
}

/**
 * Generate CI/CD compatible exit code
 */
export function getExitCode(result: AuditResult): number {
  // P0 failures = exit code 1 (failure)
  if (result.summary.p0Failures > 0) {
    return 1;
  }
  // P1 failures = exit code 2 (warning, but CI might allow)
  if (result.summary.p1Failures > 0) {
    return 2;
  }
  // All passed
  return 0;
}

export default writeJsonReport;
