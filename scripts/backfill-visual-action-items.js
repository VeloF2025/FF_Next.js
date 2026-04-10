/**
 * Backfill: extract visual action items from meeting recordings
 *
 * For each meeting with a recording but no visual action items,
 * extracts frames, runs VLM analysis, merges with transcript items.
 *
 * Usage:
 *   node scripts/backfill-visual-action-items.js [--dry-run] [--limit N] [--meeting-id N]
 *
 * Requires: DATABASE_URL, OPENAI_API_KEY, VLM on port 8100
 */

const { neon } = require('@neondatabase/serverless');
const { execFile } = require('child_process');
const { promisify } = require('util');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const OpenAI = require('openai');

const execFileAsync = promisify(execFile);
const sql = neon(process.env.DATABASE_URL);
const openai = new OpenAI.default({ apiKey: process.env.OPENAI_API_KEY });

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const limitIdx = args.indexOf('--limit');
const LIMIT = limitIdx >= 0 ? parseInt(args[limitIdx + 1], 10) : 10;
const meetingIdx = args.indexOf('--meeting-id');
const MEETING_ID = meetingIdx >= 0 ? parseInt(args[meetingIdx + 1], 10) : null;

const VLM_URL = process.env.VLM_API_URL || 'http://100.96.203.105:8100';
const VLM_MODEL = 'QuantTrio/Qwen3-VL-32B-Instruct-AWQ';
const INTERVAL_SEC = 10;
const DIFF_THRESHOLD = 5;
const MAX_FRAMES = 100;

const VLM_PROMPT = `Examine this screenshot from a meeting recording. Extract any visible task items, action items, to-do lists, or assignments.

Look for:
- Excel/spreadsheet rows with tasks, assignees, deadlines
- PowerPoint slides with action items or next steps
- Kanban boards or similar task views
- Written notes or whiteboard items with tasks

Return ONLY valid JSON (no markdown fences):
{"has_tasks": true, "items": [{"description": "What needs to be done", "assignee": "Person name or Unassigned", "priority": "high|medium|low", "confidence": 0.9, "raw_text": "Exact text visible"}], "screen_type": "excel|powerpoint|kanban|other"}

If no tasks visible: {"has_tasks": false, "items": [], "screen_type": "none"}`;

function formatTs(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

async function extractFrames(recordingPath) {
  const tempDir = `/tmp/ff-frames-${Date.now()}`;
  fs.mkdirSync(tempDir, { recursive: true });

  try {
    await execFileAsync('ffmpeg', [
      '-i', recordingPath,
      '-vf', `fps=1/${INTERVAL_SEC},scale=1024:768:force_original_aspect_ratio=decrease`,
      '-q:v', '3', '-y',
      path.join(tempDir, 'frame_%05d.jpg'),
    ], { timeout: 300000 });

    const files = fs.readdirSync(tempDir).filter(f => f.endsWith('.jpg')).sort();
    const unique = [];
    let lastBuf = null;

    for (let i = 0; i < files.length && unique.length < MAX_FRAMES; i++) {
      const buf = fs.readFileSync(path.join(tempDir, files[i]));
      if (lastBuf) {
        const [a, b] = await Promise.all([
          sharp(buf).resize(320, 240, { fit: 'fill' }).grayscale().raw().toBuffer(),
          sharp(lastBuf).resize(320, 240, { fit: 'fill' }).grayscale().raw().toBuffer(),
        ]);
        let diff = 0;
        for (let j = 0; j < Math.min(a.length, b.length); j++) diff += Math.abs(a[j] - b[j]);
        if (diff / a.length < DIFF_THRESHOLD) continue;
      }

      const optimized = await sharp(buf)
        .resize(1024, 768, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 85 }).toBuffer();

      unique.push({ base64: optimized.toString('base64'), timestamp: formatTs(i * INTERVAL_SEC), sec: i * INTERVAL_SEC });
      lastBuf = buf;
    }

    return { frames: unique, total: files.length };
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

async function callVlm(base64) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60000);
  try {
    const resp = await fetch(`${VLM_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: VLM_MODEL,
        messages: [{ role: 'user', content: [
          { type: 'text', text: VLM_PROMPT },
          { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${base64}` } },
        ]}],
        max_tokens: 1500,
        temperature: 0.1,
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!resp.ok) return null;
    const data = await resp.json();
    const text = data.choices?.[0]?.message?.content || '';
    const clean = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    return JSON.parse(clean);
  } catch { clearTimeout(timeout); return null; }
}

async function processMeeting(meeting) {
  const { id, title, recording_path } = meeting;
  const prefix = `[${id}] ${(title || '').substring(0, 40).padEnd(40)}`;

  if (!fs.existsSync(recording_path)) {
    console.log(`${prefix} SKIP: file not found`);
    return 'skip';
  }

  if (DRY_RUN) {
    console.log(`${prefix} DRY RUN: would process ${recording_path}`);
    return 'dry_run';
  }

  // 1. Extract frames
  console.log(`${prefix} Extracting frames...`);
  const { frames, total } = await extractFrames(recording_path);
  console.log(`${prefix} ${total} raw → ${frames.length} unique frames`);

  // 2. VLM analysis
  const visualItems = [];
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i];
    const result = await callVlm(f.base64);
    if (result?.has_tasks && result.items?.length > 0) {
      for (const item of result.items) {
        visualItems.push({
          description: item.description,
          assignee: item.assignee || 'Unassigned',
          priority: item.priority || 'medium',
          frameTimestamp: f.timestamp,
          rawText: item.raw_text || '',
        });
      }
    }
    if ((i + 1) % 10 === 0) process.stdout.write(`  VLM: ${i + 1}/${frames.length}\r`);
  }
  console.log(`${prefix} VLM found ${visualItems.length} visual items`);

  if (visualItems.length === 0) return 'no_items';

  // 3. Load existing transcript items
  const existing = await sql`
    SELECT description, assignee_name as assignee, priority
    FROM meeting_action_items WHERE meeting_id = ${id} AND (source = 'transcript' OR source IS NULL)
  `;

  // 4. GPT-4o merge
  const mergeResp = await openai.chat.completions.create({
    model: 'gpt-4o', max_tokens: 4096,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: `Deduplicate action items from transcript and visual sources for the same meeting. Output JSON: {"items": [{"description","assignee","priority","source":"transcript|visual|merged","visual_frame_ref":"HH:MM:SS or null"}]}` },
      { role: 'user', content: `TRANSCRIPT:\n${JSON.stringify(existing)}\n\nVISUAL:\n${JSON.stringify(visualItems)}` },
    ],
  });

  let merged;
  try { merged = JSON.parse(mergeResp.choices[0]?.message?.content || '{}'); }
  catch { console.log(`${prefix} ERROR: merge parse failed`); return 'error'; }

  const items = merged.items || [];
  const newItems = items.filter(i => i.source === 'visual' || i.source === 'merged');

  // 5. Persist visual/merged items
  await sql`DELETE FROM meeting_action_items WHERE meeting_id = ${id} AND source IN ('visual', 'merged')`;
  for (const item of newItems) {
    await sql`
      INSERT INTO meeting_action_items (meeting_id, description, assignee_name, status, priority, source, visual_frame_ref)
      VALUES (${id}, ${item.description}, ${item.assignee || 'Unassigned'}, 'pending', ${item.priority || 'medium'}, ${item.source}, ${item.visual_frame_ref || null})
    `;
  }

  const stats = {
    visual: items.filter(i => i.source === 'visual').length,
    merged: items.filter(i => i.source === 'merged').length,
    transcript: items.filter(i => i.source === 'transcript').length,
  };
  console.log(`${prefix} OK: +${stats.visual} visual, ${stats.merged} merged, ${stats.transcript} transcript kept`);
  return 'success';
}

async function main() {
  console.log(`\n=== Visual Action Items Backfill ===`);
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN' : 'LIVE'} | Limit: ${LIMIT}\n`);

  let candidates;
  if (MEETING_ID) {
    candidates = await sql`
      SELECT id, title, recording_path FROM meetings WHERE id = ${MEETING_ID} AND recording_path IS NOT NULL
    `;
  } else {
    candidates = await sql`
      SELECT m.id, m.title, m.recording_path FROM meetings m
      WHERE m.recording_path IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM meeting_action_items ai WHERE ai.meeting_id = m.id AND ai.source IN ('visual', 'merged'))
      ORDER BY m.meeting_date DESC
      LIMIT ${LIMIT}
    `;
  }

  console.log(`Found ${candidates.length} candidates\n`);
  const results = { success: 0, skip: 0, dry_run: 0, no_items: 0, error: 0 };

  for (const meeting of candidates) {
    try {
      const status = await processMeeting(meeting);
      results[status] = (results[status] || 0) + 1;
    } catch (err) {
      console.log(`[${meeting.id}] FATAL: ${err.message}`);
      results.error++;
    }
  }

  console.log(`\n=== Results ===`);
  console.log(JSON.stringify(results, null, 2));
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
