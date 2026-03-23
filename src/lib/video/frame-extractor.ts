/**
 * Video Frame Extractor
 *
 * Extracts unique frames from meeting recordings using ffmpeg,
 * then deduplicates consecutive similar frames via Sharp grayscale MAD.
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import sharp from 'sharp';
import { log } from '@/lib/logger';

const execFileAsync = promisify(execFile);
const LOGGER = 'FrameExtractor';

/** A single extracted + deduplicated frame */
export interface ExtractedFrame {
  base64: string;
  timestampSec: number;
  timestamp: string;
  dimensions: { width: number; height: number };
}

/** Result of frame extraction + dedup pipeline */
export interface FrameExtractionResult {
  frames: ExtractedFrame[];
  totalExtracted: number;
  uniqueAfterDedup: number;
  processingTimeMs: number;
  recordingDurationSec: number;
}

/** Options for frame extraction */
export interface FrameExtractionOptions {
  /** Seconds between frame captures (default: 10) */
  intervalSec?: number;
  /** MAD threshold for duplicate detection, 0-255 (default: 5) */
  diffThreshold?: number;
  /** Maximum unique frames to return (default: 100) */
  maxFrames?: number;
  /** Output frame dimensions (default: 1024x768) */
  maxWidth?: number;
  maxHeight?: number;
}

/** Format seconds as HH:MM:SS */
function formatTimestamp(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/** Get video duration in seconds via ffprobe */
export async function getVideoDuration(filePath: string): Promise<number> {
  const { stdout } = await execFileAsync('ffprobe', [
    '-v', 'error',
    '-show_entries', 'format=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1',
    filePath,
  ], { timeout: 30_000 });
  return parseFloat(stdout.trim());
}

/**
 * Compute mean absolute difference between two frame buffers.
 * Both resized to 320x240 grayscale for speed.
 * Returns value 0-255 (0 = identical).
 */
async function computeFrameDiff(frameA: Buffer, frameB: Buffer): Promise<number> {
  const size = { width: 320, height: 240 };
  const [bufA, bufB] = await Promise.all([
    sharp(frameA).resize(size.width, size.height, { fit: 'fill' }).grayscale().raw().toBuffer(),
    sharp(frameB).resize(size.width, size.height, { fit: 'fill' }).grayscale().raw().toBuffer(),
  ]);

  let totalDiff = 0;
  const len = Math.min(bufA.length, bufB.length);
  for (let i = 0; i < len; i++) {
    totalDiff += Math.abs(bufA[i]! - bufB[i]!);
  }
  return totalDiff / len;
}

/**
 * Extract unique frames from an MP4 recording.
 *
 * 1. Extracts frames at intervalSec intervals via ffmpeg
 * 2. Compares consecutive frames via grayscale MAD
 * 3. Returns deduplicated frames as base64 JPEG optimized for VLM
 */
export async function extractUniqueFrames(
  recordingPath: string,
  options: FrameExtractionOptions = {}
): Promise<FrameExtractionResult> {
  const {
    intervalSec = 10,
    diffThreshold = 5,
    maxFrames = 100,
    maxWidth = 1024,
    maxHeight = 768,
  } = options;

  const startTime = Date.now();

  if (!fs.existsSync(recordingPath)) {
    throw new Error(`Recording not found: ${recordingPath}`);
  }

  const duration = await getVideoDuration(recordingPath);
  log.info('Starting frame extraction', { recordingPath, duration, intervalSec }, LOGGER);

  // Create temp directory
  const tempDir = `/tmp/ff-frames-${Date.now()}`;
  fs.mkdirSync(tempDir, { recursive: true });

  try {
    // Extract frames with ffmpeg
    await execFileAsync('ffmpeg', [
      '-i', recordingPath,
      '-vf', `fps=1/${intervalSec},scale=${maxWidth}:${maxHeight}:force_original_aspect_ratio=decrease`,
      '-q:v', '3',
      '-y',
      path.join(tempDir, 'frame_%05d.jpg'),
    ], { timeout: 300_000 });

    // Read extracted frames in order
    const frameFiles = fs.readdirSync(tempDir)
      .filter(f => f.startsWith('frame_') && f.endsWith('.jpg'))
      .sort();

    const totalExtracted = frameFiles.length;
    log.info('Frames extracted', { totalExtracted, tempDir }, LOGGER);

    // Deduplicate consecutive similar frames
    const uniqueFrames: ExtractedFrame[] = [];
    let lastAcceptedBuffer: Buffer | null = null;

    for (let i = 0; i < frameFiles.length && uniqueFrames.length < maxFrames; i++) {
      const filePath = path.join(tempDir, frameFiles[i]!);
      const buffer = fs.readFileSync(filePath);

      if (lastAcceptedBuffer) {
        const diff = await computeFrameDiff(buffer, lastAcceptedBuffer);
        if (diff < diffThreshold) continue; // Skip duplicate
      }

      // Optimize for VLM output
      const optimized = await sharp(buffer)
        .resize(maxWidth, maxHeight, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 85 })
        .toBuffer();

      const metadata = await sharp(optimized).metadata();
      const timestampSec = i * intervalSec;

      uniqueFrames.push({
        base64: optimized.toString('base64'),
        timestampSec,
        timestamp: formatTimestamp(timestampSec),
        dimensions: { width: metadata.width ?? maxWidth, height: metadata.height ?? maxHeight },
      });

      lastAcceptedBuffer = buffer;
    }

    const processingTimeMs = Date.now() - startTime;

    log.info('Frame extraction complete', {
      totalExtracted,
      uniqueAfterDedup: uniqueFrames.length,
      processingTimeMs,
    }, LOGGER);

    return {
      frames: uniqueFrames,
      totalExtracted,
      uniqueAfterDedup: uniqueFrames.length,
      processingTimeMs,
      recordingDurationSec: duration,
    };
  } finally {
    // Cleanup temp directory
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}
