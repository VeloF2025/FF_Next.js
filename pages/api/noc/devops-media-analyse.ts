/**
 * DevOps Media Analysis API — Video & Audio processing
 *
 * POST /api/noc/devops-media-analyse
 * Accepts video or audio files via FormData.
 * - Video: extracts key frames → VLM + extracts audio → Whisper → combined analysis
 * - Audio: Whisper transcription → LLM field extraction
 *
 * // WORKING: VLM + Whisper pipeline for DevOps ticket auto-fill from video/audio
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { createLogger } from '@/lib/logger';
import { apiResponse, ErrorCode } from '@/lib/apiResponse';
import { withAuth } from '@/lib/auth';
import formidable from 'formidable';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { VLM_CHAT_ENDPOINT, VLM_EXTRACTION_MODEL, VLM_MAX_TOKENS_OCR } from '@/lib/vlm';

const logger = createLogger('noc:devops-media');

// Disable Next.js body parser for file uploads
export const config = { api: { bodyParser: false } };

const MAX_FRAMES = 3;
const MAX_DIMENSION = 1024;

const FIBREFLOW_MODULES = [
  'Dashboard', 'NOC', 'Activate', 'Procurement', 'Accounting',
  'Assets', 'Projects', 'Data Sync', 'Fleet', 'QField',
  'Field Ops', 'Stock Portal', 'Reports', 'Other',
];

// ==================== Helpers ====================

function parseForm(req: NextApiRequest): Promise<{ fields: formidable.Fields; files: formidable.Files }> {
  const form = formidable({ maxFileSize: 50 * 1024 * 1024, uploadDir: '/tmp', keepExtensions: true });
  return new Promise((resolve, reject) => {
    form.parse(req, (err, fields, files) => {
      if (err) reject(err);
      else resolve({ fields, files });
    });
  });
}

function extractFrames(videoPath: string, jobId: string): string[] {
  const frameDir = `/tmp/devops-frames-${jobId}`;
  if (fs.existsSync(frameDir)) fs.rmSync(frameDir, { recursive: true });
  fs.mkdirSync(frameDir, { recursive: true });

  // Get duration
  let duration = 10;
  try {
    const d = execSync(
      `ffprobe -i "${videoPath}" -show_entries format=duration -v quiet -of csv="p=0"`,
      { encoding: 'utf-8', timeout: 15000 },
    ).trim();
    duration = parseFloat(d) || 10;
  } catch { /* use default */ }

  // Extract frames: first frame + evenly spaced up to MAX_FRAMES
  const interval = Math.max(1, Math.floor(duration / MAX_FRAMES));
  try {
    execSync(
      `ffmpeg -i "${videoPath}" -vf "fps=1/${interval},scale='min(${MAX_DIMENSION},iw)':'-1'" -frames:v ${MAX_FRAMES} -q:v 2 "${frameDir}/frame_%02d.jpg" -y 2>/dev/null`,
      { timeout: 30000 },
    );
  } catch {
    // Try simpler extraction — just first frame
    try {
      execSync(
        `ffmpeg -i "${videoPath}" -frames:v 1 -q:v 2 "${frameDir}/frame_01.jpg" -y 2>/dev/null`,
        { timeout: 15000 },
      );
    } catch {
      logger.error('Failed to extract any frames from video');
    }
  }

  return fs.readdirSync(frameDir)
    .filter(f => f.endsWith('.jpg'))
    .sort()
    .map(f => path.join(frameDir, f));
}

function extractAudio(mediaPath: string, jobId: string): string {
  const outPath = `/tmp/devops-audio-${jobId}.mp3`;
  execSync(
    `ffmpeg -i "${mediaPath}" -vn -ac 1 -ar 16000 -b:a 48k "${outPath}" -y 2>/dev/null`,
    { timeout: 60000 },
  );
  return outPath;
}

async function whisperTranscribe(audioPath: string): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY not set');

  const audioBuffer = fs.readFileSync(audioPath);
  const blob = new Blob([audioBuffer], { type: 'audio/mpeg' });
  const formData = new FormData();
  formData.append('file', blob, path.basename(audioPath));
  formData.append('model', 'whisper-1');
  formData.append('response_format', 'text');

  const response = await fetch('https://api.openai.com/v1/audio/translations', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: formData,
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Whisper failed: ${response.status} ${err}`);
  }

  return response.text();
}

async function vlmAnalyseFrame(frameBase64: string): Promise<string> {
  const prompt = `You are analyzing a screenshot/frame from a screen recording of the FibreFlow web application showing a bug or issue.

Describe what you see:
- Any visible error messages, modals, broken UI elements
- The URL in the browser address bar (if visible)
- Which module/page is shown (sidebar highlight or page content)
- Any console errors visible in DevTools
- The browser and environment (production/dev/local based on URL)

Be specific and concise. Focus on what's wrong.`;

  const response = await fetch(VLM_CHAT_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: VLM_EXTRACTION_MODEL,
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: frameBase64, detail: 'high' } },
        ],
      }],
      max_tokens: VLM_MAX_TOKENS_OCR,
      temperature: 0.1,
    }),
  });

  if (!response.ok) return '';
  const result = await response.json();
  return result.choices?.[0]?.message?.content || '';
}

async function extractFieldsFromText(
  transcript: string,
  frameDescriptions: string[],
): Promise<Record<string, string>> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY not set');

  const frameContext = frameDescriptions.length > 0
    ? `\n\nVisual analysis of video frames:\n${frameDescriptions.map((d, i) => `Frame ${i + 1}: ${d}`).join('\n')}`
    : '';

  const prompt = `You are processing a bug report for the FibreFlow web application. The user provided a ${frameDescriptions.length > 0 ? 'screen recording' : 'voice memo'} describing an issue.

Transcript of the recording:
"${transcript}"${frameContext}

Extract the following fields and return as JSON:

{
  "title": "Short bug title (max 80 chars)",
  "description": "Detailed description combining the transcript and visual observations",
  "affected_module": "Must be one of: ${FIBREFLOW_MODULES.join(', ')}",
  "environment": "production, dev, or local (default: production)",
  "error_url": "URL if mentioned or visible",
  "stack_trace": "Any error messages mentioned or visible",
  "steps_to_reproduce": "Steps inferred from the narration/video",
  "browser_info": "Browser info if mentioned or visible",
  "priority_suggestion": "critical, high, normal, or low based on severity",
  "confidence": 0.0 to 1.0
}

Return ONLY valid JSON.`;

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: VLM_MAX_TOKENS_OCR,
      temperature: 0.1,
    }),
  });

  if (!response.ok) throw new Error(`LLM field extraction failed: ${response.status}`);
  const result = await response.json();
  const raw = result.choices?.[0]?.message?.content || '{}';

  try {
    return JSON.parse(raw.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim());
  } catch {
    return { title: '', description: transcript };
  }
}

function cleanup(paths: string[]) {
  for (const p of paths) {
    try {
      if (fs.existsSync(p)) {
        const stat = fs.statSync(p);
        if (stat.isDirectory()) fs.rmSync(p, { recursive: true });
        else fs.unlinkSync(p);
      }
    } catch { /* non-critical */ }
  }
}

// ==================== Handler ====================

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['POST']);
  }

  const jobId = Date.now().toString(36);
  const cleanupPaths: string[] = [];

  try {
    const { files } = await parseForm(req);

    const fileField = files.file;
    const file = Array.isArray(fileField) ? fileField[0] : fileField;
    if (!file) {
      return apiResponse.badRequest(res, 'No file uploaded');
    }

    const filePath = file.filepath;
    const mimeType = file.mimetype || '';
    cleanupPaths.push(filePath);

    logger.info('Processing DevOps media', { type: mimeType, size: file.size, jobId });

    const isVideo = mimeType.startsWith('video/');
    const isAudio = mimeType.startsWith('audio/');

    if (!isVideo && !isAudio) {
      return apiResponse.badRequest(res, 'Only video and audio files are accepted');
    }

    // Step 1: Extract audio and transcribe
    let transcript = '';
    try {
      const audioPath = extractAudio(filePath, jobId);
      cleanupPaths.push(audioPath);
      logger.info('Audio extracted, transcribing with Whisper', { jobId });
      transcript = await whisperTranscribe(audioPath);
      logger.info('Transcription complete', { jobId, chars: transcript.length });
    } catch (err) {
      logger.error('Audio extraction/transcription failed', { jobId, error: err });
      // Continue — frames alone may still provide useful data for video
    }

    // Step 2: Extract and analyse video frames (video only)
    const frameDescriptions: string[] = [];
    if (isVideo) {
      try {
        const framePaths = extractFrames(filePath, jobId);
        cleanupPaths.push(`/tmp/devops-frames-${jobId}`);
        logger.info('Frames extracted, analysing with VLM', { jobId, count: framePaths.length });

        for (const fp of framePaths) {
          const imgBuffer = fs.readFileSync(fp);
          const base64 = `data:image/jpeg;base64,${imgBuffer.toString('base64')}`;
          const desc = await vlmAnalyseFrame(base64);
          if (desc) frameDescriptions.push(desc);
        }

        logger.info('Frame analysis complete', { jobId, analysed: frameDescriptions.length });
      } catch (err) {
        logger.error('Frame extraction/analysis failed', { jobId, error: err });
      }
    }

    // Step 3: Combine transcript + frame descriptions → structured fields
    if (!transcript && frameDescriptions.length === 0) {
      return apiResponse.error(res, ErrorCode.SERVICE_UNAVAILABLE, 'Could not extract any content from the media file');
    }

    const analysis = await extractFieldsFromText(transcript, frameDescriptions);

    // Validate fields
    if (analysis.affected_module && !FIBREFLOW_MODULES.includes(analysis.affected_module)) {
      const lower = (analysis.affected_module || '').toLowerCase();
      const match = FIBREFLOW_MODULES.find(m => m.toLowerCase().includes(lower) || lower.includes(m.toLowerCase()));
      analysis.affected_module = match || 'Other';
    }
    if (!['production', 'dev', 'local'].includes(analysis.environment || '')) {
      analysis.environment = 'production';
    }
    if (!['low', 'normal', 'high', 'urgent', 'critical'].includes(analysis.priority_suggestion || '')) {
      analysis.priority_suggestion = 'normal';
    }

    // Include raw transcript as supplementary data
    analysis.transcript = transcript;

    logger.info('DevOps media analysis complete', {
      jobId,
      module: analysis.affected_module,
      hasTranscript: !!transcript,
      frameCount: frameDescriptions.length,
    });

    return apiResponse.success(res, analysis);
  } catch (err) {
    logger.error('DevOps media analysis error', { jobId, error: err });
    return apiResponse.internalError(res, err instanceof Error ? err : new Error('Unknown error'));
  } finally {
    cleanup(cleanupPaths);
  }
}

export default withAuth(handler);
