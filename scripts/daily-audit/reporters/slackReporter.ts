/**
 * Slack Report Generator
 * Sends audit results to Slack channel
 */

import { config } from '../config';
import { httpClient } from '../utils/httpClient';
import { auditLogger } from '../utils/logger';
import { type AuditResult } from '../types';

interface SlackBlock {
  type: string;
  text?: {
    type: string;
    text: string;
    emoji?: boolean;
  };
  elements?: Array<{
    type: string;
    text?: string;
    emoji?: boolean;
  }>;
  fields?: Array<{
    type: string;
    text: string;
  }>;
}

/**
 * Get status emoji
 */
function getStatusEmoji(status: string): string {
  switch (status) {
    case 'passed':
    case 'healthy':
      return '✅';
    case 'warning':
    case 'degraded':
      return '⚠️';
    case 'failed':
    case 'unhealthy':
      return '🔴';
    default:
      return '❓';
  }
}

/**
 * Format duration for Slack
 */
function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

/**
 * Build Slack message blocks
 */
function buildSlackBlocks(result: AuditResult): SlackBlock[] {
  const emoji = getStatusEmoji(result.status);
  const passRate = result.summary.totalTests > 0
    ? ((result.summary.passed / result.summary.totalTests) * 100).toFixed(1)
    : '0.0';

  const blocks: SlackBlock[] = [
    // Header
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: `${emoji} FibreFlow Daily Audit - ${result.status.toUpperCase()}`,
        emoji: true,
      },
    },
    // Context
    {
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: `📅 ${result.startTime.split('T')[0]} | 🌍 ${result.environment} | ⏱️ ${formatDuration(result.duration)}`,
        },
      ],
    },
    // Divider
    { type: 'divider' },
    // Summary stats
    {
      type: 'section',
      fields: [
        {
          type: 'mrkdwn',
          text: `*Total Tests*\n${result.summary.totalTests}`,
        },
        {
          type: 'mrkdwn',
          text: `*Pass Rate*\n${passRate}%`,
        },
        {
          type: 'mrkdwn',
          text: `*✅ Passed*\n${result.summary.passed}`,
        },
        {
          type: 'mrkdwn',
          text: `*🔴 Failed*\n${result.summary.failed}`,
        },
        {
          type: 'mrkdwn',
          text: `*⚠️ Warnings*\n${result.summary.warnings}`,
        },
        {
          type: 'mrkdwn',
          text: `*⏭️ Skipped*\n${result.summary.skipped}`,
        },
      ],
    },
  ];

  // Add P0 failures section if any
  if (result.summary.p0Failures > 0) {
    blocks.push({ type: 'divider' });
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*🚨 P0 Failures (${result.summary.p0Failures})*`,
      },
    });

    // List P0 failures
    const p0Failures: string[] = [];
    for (const suite of result.suites) {
      for (const test of suite.tests) {
        if (test.priority === 'P0' && test.status === 'failed') {
          p0Failures.push(`• ${suite.name}/${test.name}: ${test.message || 'Failed'}`);
        }
      }
    }

    if (p0Failures.length > 0) {
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: p0Failures.slice(0, 10).join('\n'),  // Limit to 10
        },
      });
    }
  }

  // Add suite summary
  blocks.push({ type: 'divider' });
  blocks.push({
    type: 'section',
    text: {
      type: 'mrkdwn',
      text: '*Suite Results*',
    },
  });

  for (const suite of result.suites) {
    const suiteEmoji = suite.summary.failed > 0 ? '🔴' : suite.summary.warnings > 0 ? '⚠️' : '✅';
    const suitePassRate = suite.summary.total > 0
      ? ((suite.summary.passed / suite.summary.total) * 100).toFixed(0)
      : '0';

    blocks.push({
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: `${suiteEmoji} *${suite.name}* - ${suitePassRate}% (${suite.summary.passed}/${suite.summary.total}) - ${formatDuration(suite.duration)}`,
        },
      ],
    });
  }

  // Footer with link to full report
  blocks.push({ type: 'divider' });
  blocks.push({
    type: 'context',
    elements: [
      {
        type: 'mrkdwn',
        text: `📊 <${config.servers.fibreflow.production}/audit-report.html|View Full Report>`,
      },
    ],
  });

  return blocks;
}

/**
 * Send Slack notification
 */
export async function sendSlackNotification(result: AuditResult): Promise<boolean> {
  if (!config.slack.webhookUrl) {
    auditLogger.warn('Slack webhook URL not configured');
    return false;
  }

  // Check if we should send (based on config)
  if (result.status === 'healthy' && !config.slack.dailySummary) {
    auditLogger.info('Skipping Slack notification (system healthy, daily summary disabled)');
    return true;
  }

  if (result.summary.p0Failures === 0 && !config.slack.alertOnP0Failure && !config.slack.dailySummary) {
    auditLogger.info('Skipping Slack notification (no P0 failures, alerts disabled)');
    return true;
  }

  try {
    const blocks = buildSlackBlocks(result);

    const payload = {
      channel: config.slack.channel,
      username: 'FibreFlow Audit Bot',
      icon_emoji: ':mag:',
      blocks,
    };

    const response = await httpClient.post(config.slack.webhookUrl, payload);

    if (response.success) {
      auditLogger.info('Slack notification sent successfully');
      return true;
    }

    auditLogger.error('Failed to send Slack notification', {
      status: response.status,
      error: response.error,
    });
    return false;
  } catch (error) {
    auditLogger.error('Error sending Slack notification', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return false;
  }
}

/**
 * Send immediate P0 failure alert
 */
export async function sendP0Alert(
  suiteName: string,
  testName: string,
  message: string
): Promise<boolean> {
  if (!config.slack.webhookUrl || !config.slack.alertOnP0Failure) {
    return false;
  }

  try {
    const payload = {
      channel: config.slack.channel,
      username: 'FibreFlow Audit Bot',
      icon_emoji: ':rotating_light:',
      text: `🚨 *P0 FAILURE* - ${suiteName}/${testName}\n${message}`,
    };

    const response = await httpClient.post(config.slack.webhookUrl, payload);
    return response.success;
  } catch {
    return false;
  }
}

export default sendSlackNotification;
