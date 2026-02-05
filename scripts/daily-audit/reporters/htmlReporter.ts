/**
 * HTML Report Generator
 * Generates a visual HTML dashboard for audit results
 */

import * as fs from 'fs';
import * as path from 'path';
import { config } from '../config';
import { type AuditResult, type SuiteResult, type TestResult } from '../types';

/**
 * Get status color class
 */
function getStatusColor(status: string): string {
  switch (status) {
    case 'passed':
    case 'healthy':
      return '#10b981'; // Green
    case 'warning':
    case 'degraded':
      return '#f59e0b'; // Amber
    case 'failed':
    case 'unhealthy':
      return '#ef4444'; // Red
    case 'skipped':
      return '#6b7280'; // Gray
    default:
      return '#6b7280';
  }
}

/**
 * Get status icon
 */
function getStatusIcon(status: string): string {
  switch (status) {
    case 'passed':
    case 'healthy':
      return '✓';
    case 'warning':
    case 'degraded':
      return '⚠';
    case 'failed':
    case 'unhealthy':
      return '✗';
    case 'skipped':
      return '○';
    default:
      return '?';
  }
}

/**
 * Format duration
 */
function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${ms}ms`;
  }
  return `${(ms / 1000).toFixed(2)}s`;
}

/**
 * Generate HTML for a single test result
 */
function renderTest(test: TestResult): string {
  const color = getStatusColor(test.status);
  const icon = getStatusIcon(test.status);

  return `
    <div class="test-item" style="border-left: 3px solid ${color};">
      <div class="test-header">
        <span class="test-icon" style="color: ${color};">${icon}</span>
        <span class="test-name">${escapeHtml(test.name)}</span>
        <span class="test-priority priority-${test.priority}">${test.priority}</span>
        <span class="test-duration">${formatDuration(test.duration)}</span>
      </div>
      ${test.message ? `<div class="test-message">${escapeHtml(test.message)}</div>` : ''}
    </div>
  `;
}

/**
 * Generate HTML for a suite
 */
function renderSuite(suite: SuiteResult): string {
  const passRate = suite.summary.total > 0
    ? ((suite.summary.passed / suite.summary.total) * 100).toFixed(1)
    : '0.0';

  const statusClass = suite.summary.failed > 0 ? 'failed' : suite.summary.warnings > 0 ? 'warning' : 'passed';

  return `
    <div class="suite">
      <div class="suite-header ${statusClass}" onclick="toggleSuite(this)">
        <div class="suite-title">
          <span class="suite-icon">${getStatusIcon(statusClass)}</span>
          <span class="suite-name">${escapeHtml(suite.name)}</span>
          <span class="suite-priority priority-${suite.priority}">${suite.priority}</span>
        </div>
        <div class="suite-stats">
          <span class="stat passed">${suite.summary.passed} passed</span>
          <span class="stat failed">${suite.summary.failed} failed</span>
          <span class="stat warnings">${suite.summary.warnings} warnings</span>
          <span class="stat skipped">${suite.summary.skipped} skipped</span>
          <span class="stat rate">${passRate}%</span>
          <span class="stat duration">${formatDuration(suite.duration)}</span>
        </div>
      </div>
      <div class="suite-content" style="display: none;">
        <div class="tests">
          ${suite.tests.map(renderTest).join('')}
        </div>
      </div>
    </div>
  `;
}

/**
 * Escape HTML special characters
 */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Generate the full HTML report
 */
export function generateHtmlReport(result: AuditResult): string {
  const statusColor = getStatusColor(result.status);
  const statusIcon = getStatusIcon(result.status);

  const passRate = result.summary.totalTests > 0
    ? ((result.summary.passed / result.summary.totalTests) * 100).toFixed(1)
    : '0.0';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>FibreFlow Audit Report - ${result.startTime.split('T')[0]}</title>
  <style>
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
      background: #0f172a;
      color: #e2e8f0;
      line-height: 1.6;
      padding: 20px;
    }

    .container {
      max-width: 1200px;
      margin: 0 auto;
    }

    header {
      text-align: center;
      margin-bottom: 30px;
      padding: 30px;
      background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%);
      border-radius: 12px;
      border: 1px solid #334155;
    }

    h1 {
      font-size: 2rem;
      color: #f1f5f9;
      margin-bottom: 10px;
    }

    .status-badge {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 12px 24px;
      border-radius: 8px;
      font-size: 1.25rem;
      font-weight: 600;
      background: ${statusColor}20;
      color: ${statusColor};
      border: 1px solid ${statusColor}40;
      margin: 20px 0;
    }

    .meta {
      display: flex;
      justify-content: center;
      gap: 30px;
      color: #94a3b8;
      font-size: 0.9rem;
    }

    .summary {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
      gap: 15px;
      margin-bottom: 30px;
    }

    .summary-card {
      background: #1e293b;
      border-radius: 8px;
      padding: 20px;
      text-align: center;
      border: 1px solid #334155;
    }

    .summary-card .value {
      font-size: 2rem;
      font-weight: bold;
      color: #f1f5f9;
    }

    .summary-card .label {
      color: #94a3b8;
      font-size: 0.85rem;
      margin-top: 5px;
    }

    .summary-card.passed .value { color: #10b981; }
    .summary-card.failed .value { color: #ef4444; }
    .summary-card.warnings .value { color: #f59e0b; }

    .suite {
      background: #1e293b;
      border-radius: 8px;
      margin-bottom: 15px;
      overflow: hidden;
      border: 1px solid #334155;
    }

    .suite-header {
      padding: 15px 20px;
      cursor: pointer;
      display: flex;
      justify-content: space-between;
      align-items: center;
      transition: background 0.2s;
    }

    .suite-header:hover {
      background: #334155;
    }

    .suite-header.passed { border-left: 4px solid #10b981; }
    .suite-header.warning { border-left: 4px solid #f59e0b; }
    .suite-header.failed { border-left: 4px solid #ef4444; }

    .suite-title {
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .suite-icon {
      font-size: 1.25rem;
    }

    .suite-name {
      font-weight: 600;
      color: #f1f5f9;
    }

    .suite-stats {
      display: flex;
      gap: 15px;
      font-size: 0.85rem;
    }

    .stat.passed { color: #10b981; }
    .stat.failed { color: #ef4444; }
    .stat.warnings { color: #f59e0b; }
    .stat.skipped { color: #6b7280; }
    .stat.rate { color: #60a5fa; font-weight: 600; }
    .stat.duration { color: #94a3b8; }

    .suite-content {
      border-top: 1px solid #334155;
      padding: 15px 20px;
    }

    .test-item {
      padding: 10px 15px;
      margin-bottom: 8px;
      background: #0f172a;
      border-radius: 6px;
    }

    .test-header {
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .test-icon {
      font-weight: bold;
    }

    .test-name {
      flex: 1;
      color: #e2e8f0;
    }

    .test-duration {
      color: #6b7280;
      font-size: 0.85rem;
    }

    .test-message {
      margin-top: 5px;
      padding-left: 25px;
      color: #94a3b8;
      font-size: 0.85rem;
    }

    .priority-P0 {
      background: #ef444420;
      color: #ef4444;
      padding: 2px 8px;
      border-radius: 4px;
      font-size: 0.75rem;
      font-weight: 600;
    }

    .priority-P1 {
      background: #f59e0b20;
      color: #f59e0b;
      padding: 2px 8px;
      border-radius: 4px;
      font-size: 0.75rem;
      font-weight: 600;
    }

    .priority-P2 {
      background: #6b728020;
      color: #94a3b8;
      padding: 2px 8px;
      border-radius: 4px;
      font-size: 0.75rem;
      font-weight: 600;
    }

    footer {
      text-align: center;
      margin-top: 30px;
      padding: 20px;
      color: #64748b;
      font-size: 0.85rem;
    }

    @media (max-width: 768px) {
      .suite-header {
        flex-direction: column;
        gap: 10px;
      }

      .suite-stats {
        flex-wrap: wrap;
        justify-content: center;
      }

      .meta {
        flex-direction: column;
        gap: 10px;
      }
    }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <h1>🔍 FibreFlow Daily Audit</h1>
      <div class="status-badge">
        <span>${statusIcon}</span>
        <span>System ${result.status.toUpperCase()}</span>
      </div>
      <div class="meta">
        <span>📅 ${result.startTime.split('T')[0]}</span>
        <span>🕐 ${result.startTime.split('T')[1].split('.')[0]} UTC</span>
        <span>⏱️ Duration: ${formatDuration(result.duration)}</span>
        <span>🌍 Environment: ${result.environment}</span>
      </div>
    </header>

    <div class="summary">
      <div class="summary-card">
        <div class="value">${result.summary.totalTests}</div>
        <div class="label">Total Tests</div>
      </div>
      <div class="summary-card passed">
        <div class="value">${result.summary.passed}</div>
        <div class="label">Passed</div>
      </div>
      <div class="summary-card failed">
        <div class="value">${result.summary.failed}</div>
        <div class="label">Failed</div>
      </div>
      <div class="summary-card warnings">
        <div class="value">${result.summary.warnings}</div>
        <div class="label">Warnings</div>
      </div>
      <div class="summary-card">
        <div class="value">${passRate}%</div>
        <div class="label">Pass Rate</div>
      </div>
      <div class="summary-card">
        <div class="value">${result.summary.totalSuites}</div>
        <div class="label">Suites</div>
      </div>
    </div>

    <div class="suites">
      ${result.suites.map(renderSuite).join('')}
    </div>

    <footer>
      <p>Generated by FibreFlow Daily Audit v${result.version}</p>
      <p>Last updated: ${new Date().toISOString()}</p>
    </footer>
  </div>

  <script>
    function toggleSuite(header) {
      const content = header.nextElementSibling;
      if (content.style.display === 'none') {
        content.style.display = 'block';
      } else {
        content.style.display = 'none';
      }
    }

    // Auto-expand failed suites
    document.querySelectorAll('.suite-header.failed').forEach(header => {
      const content = header.nextElementSibling;
      content.style.display = 'block';
    });
  </script>
</body>
</html>`;
}

/**
 * Write HTML report to file
 */
export async function writeHtmlReport(result: AuditResult): Promise<string> {
  const html = generateHtmlReport(result);
  const outputPath = path.resolve(process.cwd(), config.reports.htmlPath);

  // Ensure directory exists
  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(outputPath, html, 'utf8');
  return outputPath;
}

export default writeHtmlReport;
