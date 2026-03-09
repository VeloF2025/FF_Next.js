/**
 * Action Items Parser
 * Parses Fireflies action items text format into structured data
 */

import { ParsedActionItem } from '@/types/action-items.types';

/**
 * Parse Fireflies action items text into structured data
 *
 * Format example:
 * **Louis**
 * Update and finalize the Request for Proposal documents (16:17)
 * Confirm acquisition rates and finalize negotiations (11:21)
 *
 * **Hein van Vuuren**
 * Provide detailed cost breakdowns (04:21)
 */
export function parseFirefliesActionItems(actionItemsText: string): ParsedActionItem[] {
  if (!actionItemsText || typeof actionItemsText !== 'string') {
    return [];
  }

  const parsed: ParsedActionItem[] = [];
  const lines = actionItemsText.split('\n').filter(line => line.trim());

  let currentAssignee = 'Unassigned';

  for (const line of lines) {
    const trimmed = line.trim();

    // Check if this is an assignee header (e.g., "**Louis**")
    const assigneeMatch = trimmed.match(/^\*\*(.+?)\*\*$/);
    if (assigneeMatch) {
      currentAssignee = assigneeMatch[1]!.trim();
      continue;
    }

    // Check if this is an action item
    // Extract timestamp if present (e.g., "(16:17)")
    const timestampMatch = trimmed.match(/\((\d{1,2}:\d{2})\)$/);
    const mentioned_at = timestampMatch ? timestampMatch[1] : undefined;

    // Remove timestamp from description
    const description = timestampMatch
      ? trimmed.substring(0, timestampMatch.index).trim()
      : trimmed;

    // Skip empty lines or lines that are too short
    if (description.length < 10) {
      continue;
    }

    parsed.push({
      assignee: currentAssignee,
      description,
      mentioned_at,
    });
  }

  return parsed;
}

/**
 * Extract assignee email from meeting participants
 */
export function findAssigneeEmail(
  assigneeName: string,
  participants: Array<{ name: string; email: string; displayName?: string }>
): string | undefined {
  if (!participants || !Array.isArray(participants)) {
    return undefined;
  }

  const normalizedName = assigneeName.toLowerCase().trim();

  return participants.find(
    (p) =>
      p.name?.toLowerCase().includes(normalizedName) ||
      p.displayName?.toLowerCase().includes(normalizedName) ||
      normalizedName.includes(p.name?.toLowerCase() || '')
  )?.email;
}
