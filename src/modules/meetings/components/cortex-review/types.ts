/**
 * Shared client-side types for the Cortex Meeting Reviewer panel.
 * Mirrors the proxy route's response shapes (kept client-local to avoid a
 * server→client import of the API route module).
 */

export interface ProposedAction {
  action_id: string;
  text: string;
  owner: string | null;
  due: string | null;
  confidence: number;
  state: string;          // 'proposed' | 'approved' | 'rejected'
  source_quotes: string[];
  history: unknown[];
}

export interface SealedItem {
  action_id: string;
  text: string;
  owner: string | null;
  due: string | null;
  confidence: number;
  kind: string;
}

export interface SealedPanel {
  panelState: 'sealed';
  cortexMeetingId: string;
  sealSource: string;
  humanReviewed: boolean;
  sealedAt: string | null;
  summary: string | null;
  items: SealedItem[];
}

// Cortex /live-state returns running-minute entries as an array of objects,
// not a string — rendering the raw array crashed the panel (React #31).
export interface Minute {
  entry_id: string;
  kind: string;
  text: string;
  superseded_by?: string | null;
}

export interface UnsealedPanel {
  panelState: 'unsealed';
  cortexMeetingId: string;
  proposedActions: ProposedAction[];
  minutes: Minute[] | null;
  // Effective executive summary (human override if set, else AI). Editable in the panel.
  summary: string | null;
}

export interface NonePanel {
  panelState: 'none';
}

export type PanelData = SealedPanel | UnsealedPanel | NonePanel;

/**
 * Mutation payload sent to POST /api/cortex/meeting-review/:meetingId.
 * NOTE: no cortexMeetingId — the server resolves it from the path param (IDOR fix).
 */
export interface MutationPayload {
  op: 'approve' | 'reject' | 'edit' | 'editSummary' | 'publish' | 'unpublish';
  actionId?: string;
  text?: string;
  owner?: string;
  due?: string;
}

// ── presentation helpers ────────────────────────────────────────────────────────

export function confidenceLabel(n: number): string {
  if (n >= 0.85) return 'High';
  if (n >= 0.6) return 'Med';
  return 'Low';
}

export function confidenceColor(n: number): string {
  if (n >= 0.85) return 'text-green-500';
  if (n >= 0.6) return 'text-yellow-500';
  return 'text-red-400';
}

export function stateColor(state: string): string {
  switch (state) {
    case 'approved': return 'text-green-500';
    case 'rejected': return 'text-red-400';
    default: return 'text-[var(--ff-text-secondary)]';
  }
}
