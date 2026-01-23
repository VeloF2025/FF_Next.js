/**
 * GitHub MVP Sync Service
 *
 * Creates GitHub Issues in VelocityFibre/mvp-builds when devQueue items
 * are approved and have effort XS, S, or M.
 */

import { log } from '@/lib/logger';

const GITHUB_API = 'https://api.github.com';
const MVP_REPO = 'VelocityFibre/mvp-builds';

interface DevQueueItemForGitHub {
  id: string;
  title: string;
  description?: string;
  priority: string;
  effort_estimate?: string;
  business_value?: number;
  votes: number;
  created_by_name?: string;
  creator_email?: string;
  problem_statement?: string;
  acceptance_criteria?: string;
  target_module?: string;
  test_scenarios?: string;
}

interface GitHubIssueResponse {
  number: number;
  html_url: string;
  state: string;
}

/**
 * Check if item effort is eligible for MVP automation (XS, S, or M)
 */
export function isEligibleForMvp(effortEstimate?: string): boolean {
  const eligible = ['XS', 'S', 'M'];
  return effortEstimate ? eligible.includes(effortEstimate.toUpperCase()) : false;
}

/**
 * Generate spec template for GitHub Issue body
 */
export function generateSpecTemplate(item: DevQueueItemForGitHub): string {
  const lines: string[] = [];

  lines.push('## Problem Statement');
  lines.push(item.problem_statement || '_Not specified - please add context_');
  lines.push('');

  lines.push('## Acceptance Criteria');
  lines.push(item.acceptance_criteria || '_Not specified - please add requirements_');
  lines.push('');

  lines.push('## Target Module');
  lines.push(item.target_module || '_Not specified_');
  lines.push('');

  lines.push('## Test Scenarios');
  lines.push(item.test_scenarios || '_Not specified - please add test cases_');
  lines.push('');

  lines.push('## Description');
  lines.push(item.description || '_No description provided_');
  lines.push('');

  lines.push('---');
  lines.push('## Metadata');
  lines.push('');
  lines.push(`| Field | Value |`);
  lines.push(`|-------|-------|`);
  lines.push(`| DevQueue ID | \`${item.id}\` |`);
  lines.push(`| Priority | ${item.priority || 'medium'} |`);
  lines.push(`| Effort | ${item.effort_estimate || 'Not estimated'} |`);
  lines.push(`| Business Value | ${item.business_value ? `${item.business_value}/10` : 'Not rated'} |`);
  lines.push(`| Votes | ${item.votes} |`);
  lines.push(`| Requested By | ${item.created_by_name || 'Unknown'} |`);
  if (item.creator_email) {
    lines.push(`| Notify Email | ${item.creator_email} |`);
  }
  lines.push('');

  lines.push('---');
  lines.push('_Auto-generated from FibreFlow DevQueue_');
  lines.push('');
  lines.push('**Build Instructions:**');
  lines.push('1. Claude Code agent will implement this feature');
  lines.push('2. Tests will be generated based on acceptance criteria');
  lines.push('3. PR will be created when build completes');
  lines.push('4. Creator will be notified via email');

  return lines.join('\n');
}

/**
 * Create a GitHub Issue in the mvp-builds repo
 */
export async function createMvpIssue(
  item: DevQueueItemForGitHub
): Promise<{ issueNumber: number; issueUrl: string } | null> {
  const token = process.env.GITHUB_TOKEN;

  if (!token) {
    log.error('GITHUB_TOKEN not configured - cannot create MVP issue', null, 'GitHubMvpSync');
    return null;
  }

  try {
    const issueBody = generateSpecTemplate(item);
    const labels = ['mvp-ready', 'auto-generated'];

    // Add effort label
    if (item.effort_estimate) {
      labels.push(`effort-${item.effort_estimate.toLowerCase()}`);
    }

    // Add priority label
    if (item.priority) {
      labels.push(`priority-${item.priority}`);
    }

    const response = await fetch(`${GITHUB_API}/repos/${MVP_REPO}/issues`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        title: `[MVP] ${item.title}`,
        body: issueBody,
        labels,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      log.error(`GitHub API error: ${response.status} - ${errorText}`, null, 'GitHubMvpSync');
      return null;
    }

    const issue: GitHubIssueResponse = await response.json();

    log.info(`Created GitHub Issue #${issue.number} for devQueue item ${item.id}`, 'GitHubMvpSync');

    return {
      issueNumber: issue.number,
      issueUrl: issue.html_url,
    };
  } catch (error) {
    log.error('Failed to create GitHub issue:', error, 'GitHubMvpSync');
    return null;
  }
}

/**
 * Update issue with PR link when build completes
 */
export async function linkPrToIssue(
  issueNumber: number,
  prUrl: string
): Promise<boolean> {
  const token = process.env.GITHUB_TOKEN;

  if (!token) {
    return false;
  }

  try {
    // Add a comment linking to the PR
    await fetch(`${GITHUB_API}/repos/${MVP_REPO}/issues/${issueNumber}/comments`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        body: `## MVP Build Complete! \n\nPull Request: ${prUrl}\n\nThe feature has been implemented and is ready for review.`,
      }),
    });

    // Add 'pr-ready' label
    await fetch(`${GITHUB_API}/repos/${MVP_REPO}/issues/${issueNumber}/labels`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        labels: ['pr-ready'],
      }),
    });

    return true;
  } catch (error) {
    log.error('Failed to link PR to issue:', error, 'GitHubMvpSync');
    return false;
  }
}

/**
 * Close issue when PR is merged
 */
export async function closeIssue(issueNumber: number): Promise<boolean> {
  const token = process.env.GITHUB_TOKEN;

  if (!token) {
    return false;
  }

  try {
    await fetch(`${GITHUB_API}/repos/${MVP_REPO}/issues/${issueNumber}`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        state: 'closed',
        state_reason: 'completed',
      }),
    });

    return true;
  } catch (error) {
    log.error('Failed to close issue:', error, 'GitHubMvpSync');
    return false;
  }
}
