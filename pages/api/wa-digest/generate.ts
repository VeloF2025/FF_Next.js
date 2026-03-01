/**
 * WA Digest Generation Endpoint
 *
 * Cron-triggered endpoint that generates daily markdown digests from field ops
 * WhatsApp messages and ingests them into the Qdrant knowledge base.
 *
 * POST /api/wa-digest/generate
 * Auth: x-cron-secret header
 * Body: { date?: string } — defaults to yesterday SAST (UTC+2)
 *
 * @module api/wa-digest/generate
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { createLogger } from '@/lib/logger';
import { apiResponse } from '@/lib/apiResponse';
import { generateDailyDigest } from '@/lib/wa-digest/generateDailyDigest';
import { ingestToQdrant } from '@/lib/wa-digest/ingestToQdrant';

const logger = createLogger('api:wa-digest:generate');

interface GenerateRequestBody {
  date?: string;
}

interface IngestedFileSummary {
  file: string;
  project: string;
  group_type: string;
  chunks_ingested: number;
}

interface GenerateResponseData {
  date: string;
  projects: string[];
  message_count: number;
  photo_count: number;
  files_generated: string[];
  ingestion: IngestedFileSummary[];
  total_chunks_ingested: number;
}

/**
 * Returns yesterday's date in SAST (UTC+2) as YYYY-MM-DD.
 */
function yesterdaySAST(): string {
  const nowUTC = Date.now();
  const sastOffset = 2 * 60 * 60 * 1000; // UTC+2
  const nowSAST = new Date(nowUTC + sastOffset);
  // Subtract one day
  const yesterday = new Date(nowSAST.getTime() - 24 * 60 * 60 * 1000);
  return yesterday.toISOString().slice(0, 10);
}

/**
 * Validates a YYYY-MM-DD date string.
 */
function isValidDate(dateStr: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(dateStr) && !isNaN(Date.parse(dateStr));
}

/**
 * Extracts project and group_type from a digest file path.
 * Expected structure: docs/wa-digests/{project}/{date}-{group_type}.md
 */
function parseFilePath(
  filePath: string
): { project: string; group_type: string } {
  const parts = filePath.replace(/\\/g, '/').split('/');
  const filename = parts[parts.length - 1] ?? '';
  const projectSlug = parts[parts.length - 2] ?? 'unknown';

  // filename format: YYYY-MM-DD-{group_type}.md
  const withoutExt = filename.replace(/\.md$/, '');
  const groupType = withoutExt.slice(11) || 'unknown'; // strip "YYYY-MM-DD-"

  return {
    project: projectSlug,
    group_type: groupType,
  };
}

async function handler(req: NextApiRequest, res: NextApiResponse): Promise<void> {
  if (req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method ?? 'UNKNOWN', ['POST']);
  }

  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    logger.error('CRON_SECRET env var not set');
    return apiResponse.internalError(res, new Error('Server configuration error'));
  }

  const headerSecret = req.headers['x-cron-secret'];
  if (headerSecret !== cronSecret) {
    logger.warn('Invalid or missing x-cron-secret header');
    return apiResponse.unauthorized(res, 'Invalid cron secret');
  }

  const body = (req.body ?? {}) as GenerateRequestBody;

  // Resolve date — use provided date or yesterday SAST
  let targetDate: string;
  if (body.date) {
    if (!isValidDate(body.date)) {
      return apiResponse.badRequest(res, `Invalid date format: ${body.date}. Use YYYY-MM-DD.`);
    }
    targetDate = body.date;
  } else {
    targetDate = yesterdaySAST();
  }

  logger.info('Starting WA digest generation', { date: targetDate });

  try {
    // Step 1: Generate markdown digests
    const digestResult = await generateDailyDigest({ date: targetDate });

    logger.info('Digest generation complete', {
      date: targetDate,
      projects: digestResult.projects,
      messages: digestResult.messageCount,
      photos: digestResult.photoCount,
      files: digestResult.files.length,
    });

    // Step 2: Ingest each generated file into Qdrant
    const ingestionSummaries: IngestedFileSummary[] = [];
    let totalChunks = 0;

    for (const filePath of digestResult.files) {
      const { project, group_type } = parseFilePath(filePath);

      try {
        const ingestResult = await ingestToQdrant({
          filePath,
          project,
          groupType: group_type,
          date: targetDate,
          messageCount: digestResult.messageCount,
          photoCount: digestResult.photoCount,
        });

        ingestionSummaries.push({
          file: filePath,
          project,
          group_type,
          chunks_ingested: ingestResult.chunksIngested,
        });

        totalChunks += ingestResult.chunksIngested;

        logger.info('File ingested to Qdrant', {
          filePath,
          chunks: ingestResult.chunksIngested,
        });
      } catch (ingestError) {
        // Log but don't fail the whole request — digest is already written
        logger.error('Qdrant ingestion failed for file', {
          filePath,
          error:
            ingestError instanceof Error ? ingestError.message : String(ingestError),
        });

        ingestionSummaries.push({
          file: filePath,
          project,
          group_type,
          chunks_ingested: 0,
        });
      }
    }

    const responseData: GenerateResponseData = {
      date: targetDate,
      projects: digestResult.projects,
      message_count: digestResult.messageCount,
      photo_count: digestResult.photoCount,
      files_generated: digestResult.files,
      ingestion: ingestionSummaries,
      total_chunks_ingested: totalChunks,
    };

    logger.info('WA digest pipeline complete', {
      date: targetDate,
      totalChunks,
      filesGenerated: digestResult.files.length,
    });

    return apiResponse.success(res, responseData);
  } catch (error) {
    logger.error('WA digest generation failed', {
      date: targetDate,
      error: error instanceof Error ? error.message : String(error),
    });
    return apiResponse.internalError(res, error);
  }
}

export default handler;
