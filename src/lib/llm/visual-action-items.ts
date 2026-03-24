/**
 * Visual Action Item Extraction
 *
 * Extracts action items from meeting recording frames using VLM (Qwen3-VL),
 * then merges with transcript-based items via GPT-4o to deduplicate.
 */

import { log } from '@/lib/logger';
import { neon } from '@/lib/db-neon';
import { callVlmExtraction } from '@/modules/activate/services/vlmClient';
import { getOpenAIClient } from './client';
import { extractUniqueFrames, type ExtractedFrame } from '@/lib/video/frame-extractor';

const sql = neon(process.env.DATABASE_URL!);
const LOGGER = 'VisualActionItems';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface VisualActionItem {
  description: string;
  assignee: string;
  priority: 'high' | 'medium' | 'low';
  frameTimestamp: string;
  confidence: number;
  rawText: string;
}

interface VlmFrameResult {
  has_tasks: boolean;
  items: Array<{
    description: string;
    assignee: string;
    priority: string;
    confidence: number;
    raw_text: string;
  }>;
  screen_type: string;
}

export interface MergedActionItem {
  description: string;
  assignee: string;
  priority: 'high' | 'medium' | 'low';
  source: 'transcript' | 'visual' | 'merged';
  visualFrameRef: string | null;
}

export interface MergeResult {
  items: MergedActionItem[];
  stats: {
    fromTranscript: number;
    fromVisual: number;
    merged: number;
    totalUnique: number;
  };
}

// ---------------------------------------------------------------------------
// VLM Prompt
// ---------------------------------------------------------------------------

const VLM_TASK_PROMPT = `Examine this screenshot from a meeting recording. Extract any visible task items, action items, to-do lists, or assignments.

Look for:
- Excel/spreadsheet rows with tasks, assignees, deadlines
- PowerPoint slides with action items or next steps
- Kanban boards, Trello, Jira, or similar task views
- Written notes or whiteboard items with tasks
- Chat messages containing task assignments

Return ONLY valid JSON (no markdown fences):
{
  "has_tasks": true,
  "items": [
    {
      "description": "What needs to be done",
      "assignee": "Person name or Unassigned",
      "priority": "high|medium|low",
      "confidence": 0.9,
      "raw_text": "Exact text visible on screen"
    }
  ],
  "screen_type": "excel|powerpoint|kanban|whiteboard|chat|other"
}

If no tasks are visible, return: {"has_tasks": false, "items": [], "screen_type": "none"}`;

// ---------------------------------------------------------------------------
// VLM Frame Analysis
// ---------------------------------------------------------------------------

/**
 * Send frames to VLM and extract any visible action items.
 */
export async function extractVisualActionItems(
  frames: ExtractedFrame[]
): Promise<{ items: VisualActionItem[]; framesWithContent: number }> {
  const allItems: VisualActionItem[] = [];
  let framesWithContent = 0;

  for (let i = 0; i < frames.length; i++) {
    const frame = frames[i]!;
    try {
      const result = await callVlmExtraction<VlmFrameResult>(
        frame.base64,
        VLM_TASK_PROMPT,
        `Meeting frame at ${frame.timestamp}`
      );

      if (result.success && result.data?.has_tasks && result.data.items.length > 0) {
        framesWithContent++;
        for (const item of result.data.items) {
          allItems.push({
            description: item.description,
            assignee: item.assignee || 'Unassigned',
            priority: (['high', 'medium', 'low'].includes(item.priority) ? item.priority : 'medium') as 'high' | 'medium' | 'low',
            frameTimestamp: frame.timestamp,
            confidence: item.confidence ?? 0.5,
            rawText: item.raw_text || '',
          });
        }
        log.info('Frame has tasks', {
          frame: frame.timestamp,
          items: result.data.items.length,
          screenType: result.data.screen_type,
        }, LOGGER);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn('VLM frame analysis failed', { frame: frame.timestamp, error: msg }, LOGGER);
    }

    // Progress logging every 10 frames
    if ((i + 1) % 10 === 0) {
      log.info('Frame progress', { processed: i + 1, total: frames.length, itemsSoFar: allItems.length }, LOGGER);
    }
  }

  return { items: allItems, framesWithContent };
}

// ---------------------------------------------------------------------------
// GPT-4o Merge
// ---------------------------------------------------------------------------

/**
 * Merge visual items with transcript items using GPT-4o to deduplicate.
 */
export async function mergeActionItems(
  transcriptItems: Array<{ description: string; assignee: string; priority: string }>,
  visualItems: VisualActionItem[]
): Promise<MergeResult> {
  if (visualItems.length === 0) {
    return {
      items: transcriptItems.map(i => ({
        description: i.description,
        assignee: i.assignee,
        priority: (i.priority || 'medium') as 'high' | 'medium' | 'low',
        source: 'transcript' as const,
        visualFrameRef: null,
      })),
      stats: { fromTranscript: transcriptItems.length, fromVisual: 0, merged: 0, totalUnique: transcriptItems.length },
    };
  }

  const client = getOpenAIClient();
  const response = await client.chat.completions.create({
    model: 'gpt-4o',
    max_tokens: 4096,
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content: `You deduplicate action items from two sources for the same meeting.
Output ONLY valid JSON: { "items": [...] }

For each item determine:
- If a visual item matches a transcript item (same task, possibly worded differently): keep the more detailed description, source="merged", include visual_frame_ref
- If a visual item has no transcript match: source="visual", include visual_frame_ref
- If a transcript item has no visual match: source="transcript", visual_frame_ref=null

Each item: { "description": "...", "assignee": "...", "priority": "high|medium|low", "source": "transcript|visual|merged", "visual_frame_ref": "HH:MM:SS or null" }`,
      },
      {
        role: 'user',
        content: `TRANSCRIPT ITEMS:\n${JSON.stringify(transcriptItems, null, 2)}\n\nVISUAL ITEMS:\n${JSON.stringify(visualItems.map(v => ({
          description: v.description,
          assignee: v.assignee,
          priority: v.priority,
          frame: v.frameTimestamp,
          raw_text: v.rawText,
        })), null, 2)}`,
      },
    ],
  });

  const text = response.choices[0]?.message?.content || '{}';
  let parsed: { items: MergedActionItem[] };
  try {
    parsed = JSON.parse(text);
  } catch {
    log.error('Failed to parse merge response', { preview: text.substring(0, 200) }, LOGGER);
    // Fallback: return both sets unmerged
    return {
      items: [
        ...transcriptItems.map(i => ({ description: i.description, assignee: i.assignee, priority: (i.priority || 'medium') as 'high' | 'medium' | 'low', source: 'transcript' as const, visualFrameRef: null })),
        ...visualItems.map(v => ({ description: v.description, assignee: v.assignee, priority: v.priority, source: 'visual' as const, visualFrameRef: v.frameTimestamp })),
      ],
      stats: { fromTranscript: transcriptItems.length, fromVisual: visualItems.length, merged: 0, totalUnique: transcriptItems.length + visualItems.length },
    };
  }

  const items = (parsed.items || []).map(i => ({
    description: i.description,
    assignee: i.assignee || 'Unassigned',
    priority: (['high', 'medium', 'low'].includes(i.priority) ? i.priority : 'medium') as 'high' | 'medium' | 'low',
    source: (['transcript', 'visual', 'merged'].includes(i.source) ? i.source : 'visual') as 'transcript' | 'visual' | 'merged',
    visualFrameRef: i.visualFrameRef || null,
  }));

  const stats = {
    fromTranscript: items.filter(i => i.source === 'transcript').length,
    fromVisual: items.filter(i => i.source === 'visual').length,
    merged: items.filter(i => i.source === 'merged').length,
    totalUnique: items.length,
  };

  log.info('Merge complete', stats, LOGGER);
  return { items, stats };
}

// ---------------------------------------------------------------------------
// Full Pipeline
// ---------------------------------------------------------------------------

/**
 * Full visual action items pipeline for a meeting.
 * Extracts frames → VLM analysis → GPT-4o merge → persist to DB.
 */
export async function processVisualActionItems(
  meetingId: number,
  recordingPath: string
): Promise<MergeResult> {
  log.info('Starting visual action items pipeline', { meetingId, recordingPath }, LOGGER);

  // 1. Extract unique frames
  const extraction = await extractUniqueFrames(recordingPath);
  log.info('Frames ready', {
    meetingId,
    total: extraction.totalExtracted,
    unique: extraction.uniqueAfterDedup,
  }, LOGGER);

  // 2. VLM analysis on each frame
  const { items: visualItems, framesWithContent } = await extractVisualActionItems(extraction.frames);
  log.info('VLM analysis complete', { meetingId, visualItems: visualItems.length, framesWithContent }, LOGGER);

  if (visualItems.length === 0) {
    log.info('No visual action items found', { meetingId }, LOGGER);
    return { items: [], stats: { fromTranscript: 0, fromVisual: 0, merged: 0, totalUnique: 0 } };
  }

  // 3. Load existing transcript-based action items
  const existingItems = await sql`
    SELECT description, assignee_name as assignee, priority
    FROM action_items
    WHERE meeting_id = ${meetingId} AND (source = 'transcript' OR source IS NULL)
  `;

  // 4. GPT-4o merge
  const result = await mergeActionItems(
    existingItems as Array<{ description: string; assignee: string; priority: string }>,
    visualItems
  );

  // 5. Persist: remove old visual/merged items, insert new ones
  await sql`DELETE FROM action_items WHERE meeting_id = ${meetingId} AND source IN ('visual', 'merged')`;

  for (const item of result.items) {
    if (item.source === 'visual' || item.source === 'merged') {
      await sql`
        INSERT INTO action_items (meeting_id, description, assignee_name, status, priority, source, visual_frame_ref)
        VALUES (${meetingId}, ${item.description}, ${item.assignee}, 'pending', ${item.priority}, ${item.source}, ${item.visualFrameRef})
      `;
    }
  }

  log.info('Visual action items persisted', { meetingId, ...result.stats }, LOGGER);
  return result;
}
