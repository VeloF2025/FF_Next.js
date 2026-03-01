/**
 * Qdrant Ingestion for WA Daily Digests
 *
 * Reads a markdown digest file, chunks it into sections, generates
 * OpenAI embeddings, and upserts to the Qdrant fibreflow_kb collection.
 *
 * @module lib/wa-digest/ingestToQdrant
 */

import { createLogger } from '@/lib/logger';
import fs from 'fs';
import { randomUUID } from 'crypto';

const logger = createLogger('wa-digest-qdrant');

const QDRANT_URL = process.env.QDRANT_URL || 'http://localhost:6333';
const QDRANT_COLLECTION = 'fibreflow_kb';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const EMBEDDING_MODEL = 'text-embedding-3-small';
const EMBEDDING_DIMS = 1536;
const CHUNK_MAX_CHARS = 500;
const BATCH_SIZE = 50; // OpenAI embeddings batch limit

export interface IngestOptions {
  filePath: string;
  project: string;
  groupType: string;
  date: string;
  messageCount: number;
  photoCount: number;
}

export interface IngestResult {
  chunksIngested: number;
}

interface QdrantPoint {
  id: string;
  vector: number[];
  payload: {
    source: string;
    section: string;
    content: string;
    metadata: {
      project: string;
      group_type: string;
      date: string;
      message_count: number;
      photo_count: number;
      file_path: string;
    };
  };
}

/**
 * Ingests a daily digest markdown file into the Qdrant knowledge base.
 */
export async function ingestToQdrant(options: IngestOptions): Promise<IngestResult> {
  const { filePath, project, groupType, date, messageCount, photoCount } = options;

  if (!OPENAI_API_KEY) {
    logger.warn('OPENAI_API_KEY not set — skipping Qdrant ingestion', { filePath });
    return { chunksIngested: 0 };
  }

  if (!fs.existsSync(filePath)) {
    logger.warn('Digest file not found — skipping ingestion', { filePath });
    return { chunksIngested: 0 };
  }

  const content = fs.readFileSync(filePath, 'utf-8');
  const chunks = chunkMarkdown(content, CHUNK_MAX_CHARS);

  if (chunks.length === 0) {
    logger.warn('No chunks extracted from digest file', { filePath });
    return { chunksIngested: 0 };
  }

  logger.info('Starting Qdrant ingestion', { filePath, chunks: chunks.length });

  // Generate embeddings in batches
  const allEmbeddings: number[][] = [];
  for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
    const batch = chunks.slice(i, i + BATCH_SIZE);
    const batchEmbeddings = await generateEmbeddings(batch);
    allEmbeddings.push(...batchEmbeddings);
  }

  // Build Qdrant points (allEmbeddings.length === chunks.length by construction)
  const points: QdrantPoint[] = chunks.map((chunk, idx) => ({
    id: randomUUID(),
    vector: allEmbeddings[idx] as number[],
    payload: {
      source: 'wa-digest',
      section: extractSectionTitle(chunk),
      content: chunk,
      metadata: {
        project,
        group_type: groupType,
        date,
        message_count: messageCount,
        photo_count: photoCount,
        file_path: filePath,
      },
    },
  }));

  // Upsert to Qdrant in batches of 100
  const UPSERT_BATCH = 100;
  for (let i = 0; i < points.length; i += UPSERT_BATCH) {
    const batch = points.slice(i, i + UPSERT_BATCH);
    await upsertToQdrant(batch);
  }

  logger.info('Qdrant ingestion complete', { filePath, chunksIngested: points.length });
  return { chunksIngested: points.length };
}

/**
 * Splits markdown content into ~500-char sections.
 * Splits on ## headers first, then further splits long sections on paragraph boundaries.
 */
function chunkMarkdown(content: string, maxChars: number): string[] {
  // Split on ## headers (keep the header with the section)
  const sectionPattern = /(?=^## )/m;
  const sections = content.split(sectionPattern).filter((s) => s.trim().length > 0);

  const chunks: string[] = [];
  for (const section of sections) {
    if (section.length <= maxChars) {
      chunks.push(section.trim());
    } else {
      // Further split long sections on blank lines (paragraph boundaries)
      const paragraphs = section.split(/\n\n+/).filter((p) => p.trim().length > 0);
      let current = '';
      for (const para of paragraphs) {
        if (current.length + para.length + 2 > maxChars && current.length > 0) {
          chunks.push(current.trim());
          current = para;
        } else {
          current = current ? `${current}\n\n${para}` : para;
        }
      }
      if (current.trim().length > 0) {
        chunks.push(current.trim());
      }
    }
  }
  return chunks.filter((c) => c.length > 0);
}

/**
 * Extracts a section title from a markdown chunk (first ## heading, or first line).
 */
function extractSectionTitle(chunk: string): string {
  const lines = chunk.split('\n').filter((l) => l.trim().length > 0);
  for (const line of lines) {
    if (line.startsWith('#')) {
      return line.replace(/^#+\s*/, '').trim();
    }
  }
  return lines[0]?.slice(0, 80) ?? 'unknown';
}

/**
 * Generates embeddings for a batch of texts via OpenAI text-embedding-3-small.
 */
async function generateEmbeddings(texts: string[]): Promise<number[][]> {
  const response = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: EMBEDDING_MODEL,
      input: texts,
      dimensions: EMBEDDING_DIMS,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenAI embeddings API error ${response.status}: ${errorText}`);
  }

  const result = (await response.json()) as {
    data: Array<{ embedding: number[]; index: number }>;
  };

  // Sort by index to preserve order
  const sorted = result.data.sort((a, b) => a.index - b.index);
  return sorted.map((d) => d.embedding);
}

/**
 * Upserts a batch of points to Qdrant.
 */
async function upsertToQdrant(points: QdrantPoint[]): Promise<void> {
  const url = `${QDRANT_URL}/collections/${QDRANT_COLLECTION}/points`;
  const response = await fetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ points }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Qdrant upsert error ${response.status}: ${errorText}`);
  }

  const result = (await response.json()) as { status: string };
  if (result.status !== 'ok') {
    throw new Error(`Qdrant upsert returned non-ok status: ${result.status}`);
  }
}
