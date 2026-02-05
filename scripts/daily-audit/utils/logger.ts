/**
 * Audit Logger Utility
 * Structured logging specifically for the audit framework
 */

import * as fs from 'fs';
import * as path from 'path';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface AuditLogEntry {
  timestamp: string;
  level: LogLevel;
  suite: string | null;
  message: string;
  data?: Record<string, any>;
}

interface LoggerConfig {
  level: LogLevel;
  writeToFile: boolean;
  logDir: string;
  colorize: boolean;
}

const levelPriority: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const levelColors: Record<LogLevel, string> = {
  debug: '\x1b[36m',  // Cyan
  info: '\x1b[32m',   // Green
  warn: '\x1b[33m',   // Yellow
  error: '\x1b[31m',  // Red
};

const resetColor = '\x1b[0m';

class AuditLogger {
  private config: LoggerConfig;
  private logFile: string | null = null;
  private entries: AuditLogEntry[] = [];
  private currentSuite: string | null = null;

  constructor(config: Partial<LoggerConfig> = {}) {
    this.config = {
      level: (process.env.AUDIT_LOG_LEVEL as LogLevel) || 'info',
      writeToFile: process.env.AUDIT_LOG_FILE === 'true',
      logDir: 'scripts/daily-audit/results',
      colorize: process.stdout.isTTY ?? false,
      ...config,
    };

    if (this.config.writeToFile) {
      this.initLogFile();
    }
  }

  /**
   * Initialize log file for this run
   */
  private initLogFile(): void {
    const date = new Date().toISOString().split('T')[0];
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    this.logFile = path.join(this.config.logDir, `audit-${date}-${timestamp}.log`);

    // Ensure directory exists
    const dir = path.dirname(this.logFile);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  /**
   * Set the current suite for logging context
   */
  setSuite(suite: string | null): void {
    this.currentSuite = suite;
  }

  /**
   * Log debug message
   */
  debug(message: string, data?: Record<string, any>): void {
    this.log('debug', message, data);
  }

  /**
   * Log info message
   */
  info(message: string, data?: Record<string, any>): void {
    this.log('info', message, data);
  }

  /**
   * Log warning message
   */
  warn(message: string, data?: Record<string, any>): void {
    this.log('warn', message, data);
  }

  /**
   * Log error message
   */
  error(message: string, data?: Record<string, any>): void {
    this.log('error', message, data);
  }

  /**
   * Internal log method
   */
  private log(level: LogLevel, message: string, data?: Record<string, any>): void {
    if (levelPriority[level] < levelPriority[this.config.level]) {
      return;
    }

    const entry: AuditLogEntry = {
      timestamp: new Date().toISOString(),
      level,
      suite: this.currentSuite,
      message,
      data,
    };

    this.entries.push(entry);
    this.writeToConsole(entry);

    if (this.config.writeToFile && this.logFile) {
      this.writeToFile(entry);
    }
  }

  /**
   * Write log entry to console
   */
  private writeToConsole(entry: AuditLogEntry): void {
    const time = entry.timestamp.split('T')[1].split('.')[0];
    const level = entry.level.toUpperCase().padEnd(5);
    const suite = entry.suite ? `[${entry.suite}] ` : '';

    let line: string;
    if (this.config.colorize) {
      const color = levelColors[entry.level];
      line = `${color}${time} ${level}${resetColor} ${suite}${entry.message}`;
    } else {
      line = `${time} ${level} ${suite}${entry.message}`;
    }

    if (entry.data && Object.keys(entry.data).length > 0) {
      const dataStr = JSON.stringify(entry.data);
      // Truncate long data
      line += ` ${dataStr.length > 100 ? dataStr.substring(0, 100) + '...' : dataStr}`;
    }

    // Use process.stdout directly to avoid console.*
    process.stdout.write(line + '\n');
  }

  /**
   * Write log entry to file
   */
  private writeToFile(entry: AuditLogEntry): void {
    if (!this.logFile) return;

    const line = JSON.stringify(entry) + '\n';
    fs.appendFileSync(this.logFile, line, 'utf8');
  }

  /**
   * Get all log entries
   */
  getEntries(): AuditLogEntry[] {
    return [...this.entries];
  }

  /**
   * Get entries for a specific suite
   */
  getSuiteEntries(suite: string): AuditLogEntry[] {
    return this.entries.filter((e) => e.suite === suite);
  }

  /**
   * Get error entries
   */
  getErrors(): AuditLogEntry[] {
    return this.entries.filter((e) => e.level === 'error');
  }

  /**
   * Get warnings
   */
  getWarnings(): AuditLogEntry[] {
    return this.entries.filter((e) => e.level === 'warn');
  }

  /**
   * Clear log entries
   */
  clear(): void {
    this.entries = [];
  }

  /**
   * Create a suite-scoped logger
   */
  forSuite(suite: string): ScopedLogger {
    return new ScopedLogger(this, suite);
  }

  /**
   * Log a section header (visual separator)
   */
  section(title: string): void {
    const line = '═'.repeat(60);
    process.stdout.write(`\n${line}\n  ${title}\n${line}\n\n`);
  }

  /**
   * Log a subsection header
   */
  subsection(title: string): void {
    process.stdout.write(`\n  ▸ ${title}\n`);
  }

  /**
   * Log a result line (for test results)
   */
  result(name: string, passed: boolean, details?: string): void {
    const icon = passed ? '✓' : '✗';
    const color = this.config.colorize
      ? passed
        ? '\x1b[32m'
        : '\x1b[31m'
      : '';
    const reset = this.config.colorize ? resetColor : '';

    let line = `    ${color}${icon}${reset} ${name}`;
    if (details) {
      line += ` ${this.config.colorize ? '\x1b[90m' : ''}(${details})${reset}`;
    }
    process.stdout.write(line + '\n');
  }

  /**
   * Log a summary table
   */
  summary(stats: { passed: number; failed: number; skipped: number; duration: number }): void {
    const total = stats.passed + stats.failed + stats.skipped;
    const passRate = total > 0 ? ((stats.passed / total) * 100).toFixed(1) : '0.0';

    process.stdout.write('\n');
    process.stdout.write(`  Total:    ${total}\n`);
    process.stdout.write(`  Passed:   ${stats.passed} (${passRate}%)\n`);
    process.stdout.write(`  Failed:   ${stats.failed}\n`);
    process.stdout.write(`  Skipped:  ${stats.skipped}\n`);
    process.stdout.write(`  Duration: ${(stats.duration / 1000).toFixed(2)}s\n`);
    process.stdout.write('\n');
  }
}

/**
 * Scoped logger for suite-specific logging
 */
class ScopedLogger {
  constructor(
    private parent: AuditLogger,
    private suite: string
  ) {}

  debug(message: string, data?: Record<string, any>): void {
    this.parent.setSuite(this.suite);
    this.parent.debug(message, data);
    this.parent.setSuite(null);
  }

  info(message: string, data?: Record<string, any>): void {
    this.parent.setSuite(this.suite);
    this.parent.info(message, data);
    this.parent.setSuite(null);
  }

  warn(message: string, data?: Record<string, any>): void {
    this.parent.setSuite(this.suite);
    this.parent.warn(message, data);
    this.parent.setSuite(null);
  }

  error(message: string, data?: Record<string, any>): void {
    this.parent.setSuite(this.suite);
    this.parent.error(message, data);
    this.parent.setSuite(null);
  }

  result(name: string, passed: boolean, details?: string): void {
    this.parent.result(name, passed, details);
  }
}

// Export singleton instance
export const auditLogger = new AuditLogger();

// Export class for custom instances
export { AuditLogger, ScopedLogger };

export default auditLogger;
