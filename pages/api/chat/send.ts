/**
 * Chat API - Velo, the FibreFlow assistant
 *
 * POST /api/chat/send
 * Body: { message, userName?, userRole?, userId?, topic?, history?, dataAccess? }
 *
 * Architecture: always-on RAG (no tool_choice — local models don't reliably emit tool calls)
 * 1. Embed query → search Qdrant fibreflow_kb → inject top-5 chunks as context
 * 2. If dataAccess + data-query detected → also run SQL and inject results
 * 3. Single LLM call with full context → plain text response
 *
 * LLM: qwen2.5-coder:14b-instruct-q4_K_M via local Ollama on Mac Mini (192.168.1.79)
 * Embeddings: nomic-embed-text via local proxy (localhost:11435)
 * Knowledge: Qdrant fibreflow_kb (2,714 chunks — user manual + module docs)
 *
 * Rate limited to 10 requests per minute per user.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth } from '@/lib/auth/middleware';
import { createLogger } from '@/lib/logger';
import { apiResponse, ErrorCode } from '@/lib/apiResponse';
import rateLimiter, { RateLimits } from '@/lib/rateLimiter';
import pool from '@/lib/db';

const logger = createLogger('api:chat:send');

const OLLAMA_BASE = process.env.OLLAMA_URL ?? 'http://192.168.1.79:11434';
const EMBED_BASE = process.env.EMBED_URL ?? 'http://localhost:11435';
const QDRANT_BASE = process.env.QDRANT_URL ?? 'http://localhost:6333';
const MODEL = 'qwen2.5-coder:14b-instruct-q4_K_M';
const EMBED_MODEL = 'nomic-embed-text';
const QDRANT_COLLECTION = 'fibreflow_kb';

// ── Embeddings ─────────────────────────────────────────────────

async function embedQuery(text: string): Promise<number[]> {
  const response = await fetch(`${EMBED_BASE}/v1/embeddings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: EMBED_MODEL, input: text }),
  });
  if (!response.ok) throw new Error(`Embed error: ${response.status}`);
  const data = await response.json();
  return data.data[0].embedding;
}

// ── Qdrant semantic search ─────────────────────────────────────

async function searchKnowledge(query: string, limit: number = 5): Promise<string> {
  try {
    const vector = await embedQuery(query);
    const response = await fetch(
      `${QDRANT_BASE}/collections/${QDRANT_COLLECTION}/points/search`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vector, limit, with_payload: true }),
      }
    );
    if (!response.ok) throw new Error(`Qdrant error: ${response.status}`);
    const data = await response.json();
    const results: any[] = data.result ?? [];
    if (results.length === 0) return '';
    return results
      .map((r, i) =>
        `[${i + 1}] ${r.payload.source} — ${r.payload.section} (${(r.score * 100).toFixed(0)}% match)\n${r.payload.content}`
      )
      .join('\n\n---\n\n');
  } catch (err: any) {
    logger.error('Knowledge search failed', { error: err.message });
    return '';
  }
}

// ── SQL execution (read-only) ──────────────────────────────────

const SQL_BLOCKLIST = /\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|GRANT|REVOKE|EXECUTE|COPY|VACUUM|REINDEX)\b/i;

async function queryDatabase(sql: string): Promise<string> {
  const trimmed = sql.trim().replace(/;+$/, '');
  if (!trimmed.toUpperCase().startsWith('SELECT') || SQL_BLOCKLIST.test(trimmed)) {
    return '';
  }
  try {
    const client = await pool.connect();
    try {
      await client.query('SET statement_timeout = 5000');
      const safeSql = /\bLIMIT\s+\d+/i.test(trimmed) ? trimmed : `${trimmed} LIMIT 50`;
      const result = await client.query(safeSql);
      if (result.rows.length === 0) return 'Query returned no results.';
      const cols = Object.keys(result.rows[0]);
      const header = cols.join(' | ');
      const rows = result.rows.map((row: any) =>
        cols.map(c => {
          const val = row[c];
          if (val === null) return 'NULL';
          if (val instanceof Date) return val.toISOString().split('T')[0];
          return String(val);
        }).join(' | ')
      );
      return `${header}\n${rows.join('\n')}\n(${result.rows.length} rows)`;
    } finally {
      client.release();
    }
  } catch (err: any) {
    logger.error('SQL query failed', { sql: trimmed.substring(0, 200), error: err.message });
    return '';
  }
}

// ── Data query heuristic ───────────────────────────────────────
// Returns a best-effort SQL for simple data questions, or empty string.

function inferDataQuery(message: string): string {
  const m = message.toLowerCase();
  if (/how many (activations|homes? activated)/.test(m)) {
    return `SELECT COUNT(*) AS total_activations FROM oes_activations WHERE activation_date >= CURRENT_DATE - 30`;
  }
  if (/how many (purchase orders?|pos?)\b/.test(m)) {
    return `SELECT status, COUNT(*) FROM purchase_orders GROUP BY status ORDER BY count DESC`;
  }
  if (/how many (projects?)\b/.test(m)) {
    return `SELECT status, COUNT(*) FROM projects GROUP BY status ORDER BY count DESC`;
  }
  if (/how many (suppliers?)\b/.test(m)) {
    return `SELECT COUNT(*) AS total_suppliers FROM suppliers`;
  }
  if (/how many (staff|users?|team members?)\b/.test(m)) {
    return `SELECT COUNT(*) AS total_staff FROM staff WHERE is_active = true`;
  }
  if (/how many (tickets?|faults?)\b/.test(m)) {
    return `SELECT status, COUNT(*) FROM maintenance_tickets GROUP BY status ORDER BY count DESC`;
  }
  return '';
}

// ── Ollama chat completion ─────────────────────────────────────

async function callOllama(messages: any[]): Promise<string> {
  const response = await fetch(`${OLLAMA_BASE}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MODEL, messages, temperature: 0.3, max_tokens: 1024 }),
  });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Ollama API ${response.status}: ${errorText}`);
  }
  const data = await response.json();
  return data.choices?.[0]?.message?.content ?? '';
}

// ── System prompt ──────────────────────────────────────────────

const SYSTEM_PROMPT = `You are Velo, the FibreFlow assistant for Velocity Fibre internal staff.

FibreFlow (app.fibreflow.app) is a fibre network project management platform. You help staff understand features, workflows, and live data.

Key FibreFlow terms (use these exact definitions):
- BOQ: Bill of Quantities — materials list for a project, created in Procurement
- RFQ: Request for Quotation — sent to suppliers for BOQ pricing
- PO: Purchase Order — issued to supplier after quote approval
- GRN: Goods Received Note — confirms physical stock receipt
- OES: Outside Equipment Survey — field survey data via QField
- DR: Drop Request — fibre installation request to a customer premises
- QA: Quality Assurance — photo review workflow for civil/activation work
- VLM: Vision Language Model — AI for automated photo analysis
- NOC: Network Operations Centre — network fault and maintenance monitoring
- OTIF: On Time In Full — supplier delivery performance metric
- KYC: Know Your Customer — customer document verification
- SOW: Schedule of Works — project breakdown from spreadsheet import
- PP: Planned Premises — premises in a project's coverage plan
- OLT: Optical Line Terminal — backbone network device
- PON: Passive Optical Network — fibre distribution network

Guidelines:
- Answer based ONLY on the knowledge context provided below
- If the context doesn't cover the question, say so honestly
- Use markdown for clarity (headers, bullet points, bold paths)
- Navigation paths: **Sidebar → Module → Tab**
- Be concise — 2-4 paragraphs unless step-by-step is needed
- You can ONLY read data, never modify anything`;

// ── Main handler ───────────────────────────────────────────────

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return apiResponse.error(res, ErrorCode.METHOD_NOT_ALLOWED, 'Only POST requests allowed');
  }

  const { message, userName, userRole, topic, history, dataAccess } = req.body;
  if (!message) {
    return apiResponse.error(res, ErrorCode.VALIDATION_ERROR, 'message is required');
  }

  const authenticatedUser = (req as any).user;
  const trackingName = authenticatedUser?.name || userName || 'Anonymous';
  const trackingRole = authenticatedUser?.role || userRole || 'Guest';
  const userId = authenticatedUser?.id || req.socket.remoteAddress || 'anonymous';

  // Rate limiting
  const rateLimitKey = `chat:${userId}`;
  const { success, remaining, resetAt } = rateLimiter.check(
    rateLimitKey,
    RateLimits.CHAT_API.limit,
    RateLimits.CHAT_API.windowMs
  );
  if (!success) {
    const retryAfter = Math.ceil((resetAt - Date.now()) / 1000);
    logger.warn('Rate limit exceeded', { userId, userName: trackingName });
    res.setHeader('Retry-After', retryAfter);
    return apiResponse.error(res, ErrorCode.RATE_LIMIT, `Too many requests. Please wait ${retryAfter} seconds.`);
  }
  res.setHeader('X-RateLimit-Remaining', remaining);

  try {
    logger.info('Chat request', {
      userId, userName: trackingName, userRole: trackingRole,
      topic: topic || 'general', dataAccess: !!dataAccess,
      messageLength: message.length, model: MODEL,
    });

    // ── Phase 1: Always search knowledge base ──
    const knowledgeContext = await searchKnowledge(message, 6);

    // ── Phase 2: Data query if applicable ──
    let dataContext = '';
    if (dataAccess) {
      const sql = inferDataQuery(message);
      if (sql) {
        const result = await queryDatabase(sql);
        if (result) dataContext = `Live data:\n${result}`;
      }
    }

    // ── Phase 3: Build context block ──
    const contextParts: string[] = [];
    if (knowledgeContext) contextParts.push(`Knowledge base results:\n${knowledgeContext}`);
    if (dataContext) contextParts.push(dataContext);
    const contextBlock = contextParts.length > 0
      ? `\n\n---\n${contextParts.join('\n\n')}\n---\n`
      : '\n\n(No relevant knowledge base entries found for this query.)\n';

    // ── Phase 4: Build messages ──
    const messages: any[] = [{ role: 'system', content: SYSTEM_PROMPT }];

    // Conversation history (last 6 turns)
    if (Array.isArray(history)) {
      for (const msg of history.slice(-6)) {
        if (msg.role === 'user' || msg.role === 'assistant') {
          messages.push({ role: msg.role, content: msg.content });
        }
      }
    }

    const userContent = `[${trackingName}${trackingRole ? ` — ${trackingRole}` : ''}] ${message}${contextBlock}`;
    messages.push({ role: 'user', content: userContent });

    // ── Phase 5: Single LLM call ──
    const assistantResponse = await callOllama(messages);

    if (!assistantResponse) {
      logger.error('Empty response from Ollama', { userId });
      return apiResponse.error(res, ErrorCode.INTERNAL_ERROR, 'Failed to generate response.');
    }

    logger.info('Chat response', {
      userId, responseLength: assistantResponse.length,
      hadKnowledge: !!knowledgeContext, hadData: !!dataContext, model: MODEL,
    });

    return apiResponse.success(res, { response: assistantResponse, model: MODEL });
  } catch (err: any) {
    logger.error('Chat API error', { error: err.message, stack: err.stack, userId });
    return apiResponse.error(res, ErrorCode.INTERNAL_ERROR, 'An unexpected error occurred. Please try again.');
  }
}

export default withAuth(handler);
