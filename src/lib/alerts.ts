/**
 * Alert Configuration and Management
 * Story 3.5: Monitoring Dashboard & Alerts
 *
 * Defines alert rules and thresholds for system monitoring
 */

import { log } from '@/lib/logger';

export type AlertSeverity = 'info' | 'warning' | 'critical';
export type AlertChannel = 'email' | 'slack' | 'log';

export interface AlertRule {
  id: string;
  name: string;
  description: string;
  metric: string;
  threshold: number;
  operator: 'gt' | 'lt' | 'gte' | 'lte' | 'eq';
  severity: AlertSeverity;
  channels: AlertChannel[];
  cooldown: number; // Minutes before re-alerting
  enabled: boolean;
}

export interface Alert {
  id: string;
  ruleId: string;
  ruleName: string;
  severity: AlertSeverity;
  message: string;
  value: number;
  threshold: number;
  timestamp: string;
  acknowledged: boolean;
}

/**
 * Alert Rules Configuration
 */
export const ALERT_RULES: AlertRule[] = [
  // System Health
  {
    id: 'uptime-critical',
    name: 'Uptime Below SLA',
    description: 'System uptime dropped below 99.9% target',
    metric: 'system.uptime',
    threshold: 99.9,
    operator: 'lt',
    severity: 'critical',
    channels: ['email', 'slack'],
    cooldown: 15,
    enabled: true,
  },

  // Performance
  {
    id: 'lcp-poor',
    name: 'Poor LCP Score',
    description: 'Largest Contentful Paint exceeds 4 seconds',
    metric: 'webvitals.lcp',
    threshold: 4000,
    operator: 'gt',
    severity: 'warning',
    channels: ['slack', 'log'],
    cooldown: 30,
    enabled: true,
  },
  {
    id: 'fid-poor',
    name: 'Poor FID Score',
    description: 'First Input Delay exceeds 300ms',
    metric: 'webvitals.fid',
    threshold: 300,
    operator: 'gt',
    severity: 'warning',
    channels: ['slack', 'log'],
    cooldown: 30,
    enabled: true,
  },
  {
    id: 'cls-poor',
    name: 'Poor CLS Score',
    description: 'Cumulative Layout Shift exceeds 0.25',
    metric: 'webvitals.cls',
    threshold: 0.25,
    operator: 'gt',
    severity: 'warning',
    channels: ['slack', 'log'],
    cooldown: 30,
    enabled: true,
  },

  // API Performance
  {
    id: 'api-slow',
    name: 'Slow API Response',
    description: 'API response time p95 exceeds 500ms',
    metric: 'api.response_time.p95',
    threshold: 500,
    operator: 'gt',
    severity: 'warning',
    channels: ['slack', 'log'],
    cooldown: 15,
    enabled: true,
  },
  {
    id: 'api-critical',
    name: 'Critical API Response Time',
    description: 'API response time p95 exceeds 1 second',
    metric: 'api.response_time.p95',
    threshold: 1000,
    operator: 'gt',
    severity: 'critical',
    channels: ['email', 'slack'],
    cooldown: 10,
    enabled: true,
  },

  // Error Rates
  {
    id: 'error-rate-high',
    name: 'High Error Rate',
    description: 'Error rate exceeds 0.1% of requests',
    metric: 'errors.rate',
    threshold: 0.1,
    operator: 'gt',
    severity: 'warning',
    channels: ['slack', 'log'],
    cooldown: 15,
    enabled: true,
  },
  {
    id: 'error-rate-critical',
    name: 'Critical Error Rate',
    description: 'Error rate exceeds 1% of requests',
    metric: 'errors.rate',
    threshold: 1.0,
    operator: 'gt',
    severity: 'critical',
    channels: ['email', 'slack'],
    cooldown: 5,
    enabled: true,
  },

  // Database
  {
    id: 'db-slow-queries',
    name: 'Slow Database Queries',
    description: 'More than 10 queries exceed 100ms threshold',
    metric: 'database.slow_queries',
    threshold: 10,
    operator: 'gt',
    severity: 'warning',
    channels: ['slack', 'log'],
    cooldown: 30,
    enabled: true,
  },
  {
    id: 'db-n-plus-one',
    name: 'N+1 Query Detected',
    description: 'N+1 query pattern detected',
    metric: 'database.n_plus_one',
    threshold: 0,
    operator: 'gt',
    severity: 'warning',
    channels: ['slack', 'log'],
    cooldown: 60,
    enabled: true,
  },

  // Cache Performance
  {
    id: 'cache-hit-rate-low',
    name: 'Low Cache Hit Rate',
    description: 'Cache hit rate below 70% target',
    metric: 'cache.hit_rate',
    threshold: 70,
    operator: 'lt',
    severity: 'info',
    channels: ['log'],
    cooldown: 60,
    enabled: true,
  },

  // Rate Limiting
  {
    id: 'rate-limit-abuse',
    name: 'Excessive Rate Limiting',
    description: 'More than 1000 requests blocked in last hour',
    metric: 'ratelimit.blocked',
    threshold: 1000,
    operator: 'gt',
    severity: 'warning',
    channels: ['slack', 'log'],
    cooldown: 60,
    enabled: true,
  },
];

/**
 * Check if metric value triggers an alert
 */
export function checkAlertRule(
  rule: AlertRule,
  value: number
): { triggered: boolean; message: string } {
  if (!rule.enabled) {
    return { triggered: false, message: '' };
  }

  let triggered = false;

  switch (rule.operator) {
    case 'gt':
      triggered = value > rule.threshold;
      break;
    case 'lt':
      triggered = value < rule.threshold;
      break;
    case 'gte':
      triggered = value >= rule.threshold;
      break;
    case 'lte':
      triggered = value <= rule.threshold;
      break;
    case 'eq':
      triggered = value === rule.threshold;
      break;
  }

  if (triggered) {
    const message = `${rule.name}: ${rule.description}. Current value: ${value}, Threshold: ${rule.threshold}`;
    return { triggered: true, message };
  }

  return { triggered: false, message: '' };
}

/**
 * Create alert from triggered rule
 */
export function createAlert(
  rule: AlertRule,
  value: number,
  message: string
): Alert {
  return {
    id: `${rule.id}-${Date.now()}`,
    ruleId: rule.id,
    ruleName: rule.name,
    severity: rule.severity,
    message,
    value,
    threshold: rule.threshold,
    timestamp: new Date().toISOString(),
    acknowledged: false,
  };
}

/**
 * Send alert through configured channels
 */
export async function sendAlert(alert: Alert, channels: AlertChannel[]): Promise<void> {
  const promises = channels.map((channel) => {
    switch (channel) {
      case 'email':
        return sendEmailAlert(alert);
      case 'slack':
        return sendSlackAlert(alert);
      case 'log':
        return logAlert(alert);
      default:
        return Promise.resolve();
    }
  });

  await Promise.allSettled(promises);
}

/**
 * Send email alert
 */
async function sendEmailAlert(alert: Alert): Promise<void> {
  // In production, integrate with email service (SendGrid, AWS SES, etc.)
  log.info('alerts', {
    action: 'sendEmailAlert',
    to: process.env.ALERT_EMAIL || 'ops@example.com',
    subject: `[${alert.severity.toUpperCase()}] ${alert.ruleName}`,
    body: alert.message,
    timestamp: alert.timestamp,
  });

  // Example: Send to SendGrid
  // await sendgrid.send({
  //   to: process.env.ALERT_EMAIL,
  //   subject: `[${alert.severity.toUpperCase()}] ${alert.ruleName}`,
  //   text: alert.message,
  // });
}

/**
 * Send Slack alert
 */
async function sendSlackAlert(alert: Alert): Promise<void> {
  // In production, integrate with Slack webhook
  const webhookUrl = process.env.SLACK_WEBHOOK_URL;

  if (!webhookUrl) {
    log.warn('alerts', { action: 'sendSlackAlert', message: 'No webhook configured', alert });
    return;
  }

  const color = alert.severity === 'critical' ? 'danger' : alert.severity === 'warning' ? 'warning' : 'good';

  try {
    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        attachments: [
          {
            color,
            title: `[${alert.severity.toUpperCase()}] ${alert.ruleName}`,
            text: alert.message,
            footer: 'FibreFlow Monitoring',
            ts: Math.floor(new Date(alert.timestamp).getTime() / 1000),
          },
        ],
      }),
    });
  } catch (error) {
    log.error('alerts', { action: 'sendSlackAlert', error });
  }
}

/**
 * Log alert
 */
async function logAlert(alert: Alert): Promise<void> {
  const logFn = alert.severity === 'critical' ? log.error : alert.severity === 'warning' ? log.warn : log.info;
  logFn('alerts', {
    action: 'alert',
    id: alert.id,
    rule: alert.ruleName,
    severity: alert.severity,
    message: alert.message,
    value: alert.value,
    threshold: alert.threshold,
    timestamp: alert.timestamp,
  });
}

/**
 * Get alert history
 */
export function getAlertHistory(): Alert[] {
  // In production, fetch from database
  // For now, return empty array
  return [];
}

/**
 * Acknowledge alert
 */
export async function acknowledgeAlert(alertId: string): Promise<void> {
  // In production, update alert status in database
  log.info('alerts', { action: 'acknowledgeAlert', alertId });
}
