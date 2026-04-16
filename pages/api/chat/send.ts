/**
 * Chat API - Velo, the FibreFlow assistant
 *
 * POST /api/chat/send
 * Body: { message, userName?, userRole?, userId?, topic?, history?, dataAccess? }
 *
 * Architecture: always-on RAG + SSE streaming
 * 1. Embed query → Qdrant search (score ≥ 0.65, topic-scoped) → inject chunks
 * 2. Optional data query for common metrics
 * 3. Stream Ollama tokens via SSE — first token arrives in ~2s
 *
 * SSE events:
 *   data: {"token":"..."}   — incremental token
 *   data: [DONE]            — stream complete
 *   data: {"error":"..."}   — error
 *
 * LLM: qwen2.5-coder:14b-instruct-q4_K_M via local Ollama (Mac Mini 192.168.1.79)
 * Embeddings: nomic-embed-text via local proxy (localhost:11435)
 * Knowledge: Qdrant fibreflow_kb (~2,700 chunks)
 *
 * Rate limited to 10 requests per minute per user.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth } from '@/lib/auth/middleware';
import { createLogger } from '@/lib/logger';
import { ErrorCode } from '@/lib/apiResponse';
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

// ── Topic → source path prefix map ────────────────────────────
// Used to filter Qdrant results to topic-relevant sources

const TOPIC_SOURCE_PREFIXES: Record<string, string[]> = {
  'procurement':     ['docs/user-manuals', 'docs/docs/procurement', 'procurement'],
  'projects':        ['docs/user-manuals', 'docs/docs/project'],
  'activate':        ['docs/user-manuals', 'docs/docs/activate', 'activate'],
  'construction-qa': ['docs/user-manuals', 'docs/docs/construction', 'construction-qa'],
  'field-ops':       ['docs/user-manuals', 'docs/docs/field', 'qfield'],
  'maintenance':     ['docs/user-manuals', 'docs/docs/maintenance', 'noc'],
  'assets':          ['docs/user-manuals', 'docs/docs/asset'],
  'fleet':           ['docs/user-manuals', 'docs/docs/fleet'],
  'hr':              ['docs/user-manuals', 'docs/docs/staff', 'staff'],
  'analytics':       ['docs/user-manuals', 'docs/docs/kpi'],
  'communications':  ['docs/user-manuals', 'docs/docs/communications', 'wa-monitor'],
  'system':          ['docs/user-manuals', 'docs/docs/system'],
};

const SCORE_THRESHOLD = 0.62; // drop chunks below this relevance score

// ── Qdrant semantic search ─────────────────────────────────────

async function searchKnowledge(query: string, topic?: string, limit: number = 8): Promise<string> {
  try {
    const vector = await embedQuery(query);

    // Build optional source filter for topic-scoped search
    const prefixes = topic ? TOPIC_SOURCE_PREFIXES[topic] : null;
    const body: any = { vector, limit, with_payload: true, score_threshold: SCORE_THRESHOLD };
    if (prefixes) {
      body.filter = {
        should: prefixes.map(p => ({
          key: 'source',
          match: { text: p },
        })),
      };
    }

    const response = await fetch(
      `${QDRANT_BASE}/collections/${QDRANT_COLLECTION}/points/search`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }
    );
    if (!response.ok) throw new Error(`Qdrant error: ${response.status}`);
    const data = await response.json();
    let results: any[] = data.result ?? [];

    // Fallback: if topic filter returns <3 results, retry without filter
    if (prefixes && results.length < 3) {
      const fallback = await fetch(
        `${QDRANT_BASE}/collections/${QDRANT_COLLECTION}/points/search`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ vector, limit, with_payload: true, score_threshold: SCORE_THRESHOLD }),
        }
      );
      if (fallback.ok) {
        const fd = await fallback.json();
        results = fd.result ?? [];
      }
    }

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
  if (!trimmed.toUpperCase().startsWith('SELECT') || SQL_BLOCKLIST.test(trimmed)) return '';
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

function inferDataQuery(message: string): string {
  const m = message.toLowerCase();
  if (/how many (activations|homes? activated)/.test(m))
    return `SELECT COUNT(*) AS total_activations FROM oes_activations WHERE activation_date >= CURRENT_DATE - 30`;
  if (/how many (purchase orders?|pos?)\b/.test(m))
    return `SELECT status, COUNT(*) FROM purchase_orders GROUP BY status ORDER BY count DESC`;
  if (/how many (projects?)\b/.test(m))
    return `SELECT status, COUNT(*) FROM projects GROUP BY status ORDER BY count DESC`;
  if (/how many (suppliers?)\b/.test(m))
    return `SELECT COUNT(*) AS total_suppliers FROM suppliers`;
  if (/how many (staff|users?|team members?)\b/.test(m))
    return `SELECT COUNT(*) AS total_staff FROM staff WHERE is_active = true`;
  if (/how many (tickets?|faults?)\b/.test(m))
    return `SELECT status, COUNT(*) FROM maintenance_tickets GROUP BY status ORDER BY count DESC`;
  return '';
}

// ── System prompt ──────────────────────────────────────────────

const SYSTEM_PROMPT = `You are Velo, the FibreFlow assistant for Velocity Fibre internal staff.

FibreFlow (app.fibreflow.app) is a fibre network project management platform.

Key FibreFlow terms (exact definitions — never guess):
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
- Answer based ONLY on the knowledge context provided
- If the context doesn't cover the question, say so honestly
- Use markdown (headers, bullets, bold paths like **Sidebar → Module → Tab**)
- Be concise — 2-4 paragraphs unless steps are needed
- You can ONLY read data, never modify anything`;

// ── SSE helper ─────────────────────────────────────────────────

function sseWrite(res: NextApiResponse, data: string): void {
  res.write(`data: ${data}\n\n`);
  if (typeof (res as any).flush === 'function') (res as any).flush();
}

// ── Main handler ───────────────────────────────────────────────

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: { code: ErrorCode.METHOD_NOT_ALLOWED, message: 'Only POST requests allowed' } });
    return;
  }

  const { message, userName, userRole, topic, history, dataAccess } = req.body;
  if (!message) {
    res.status(400).json({ error: { code: ErrorCode.VALIDATION_ERROR, message: 'message is required' } });
    return;
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
    res.status(429).json({ error: { code: ErrorCode.RATE_LIMIT, message: `Too many requests. Please wait ${retryAfter} seconds.` } });
    return;
  }

  // Switch to SSE streaming mode
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-RateLimit-Remaining', remaining);
  res.flushHeaders();

  try {
    logger.info('Chat request', {
      userId, userName: trackingName, userRole: trackingRole,
      topic: topic || 'general', dataAccess: !!dataAccess,
      messageLength: message.length, model: MODEL,
    });

    // Phase 1: RAG — embed + Qdrant search (topic-scoped, score-filtered)
    const knowledgeContext = await searchKnowledge(message, topic);

    // Phase 2: optional data query
    let dataContext = '';
    if (dataAccess) {
      const sql = inferDataQuery(message);
      if (sql) {
        const result = await queryDatabase(sql);
        if (result) dataContext = `Live data:\n${result}`;
      }
    }

    // Phase 3: build context block
    const contextParts: string[] = [];
    if (knowledgeContext) contextParts.push(`Knowledge base results:\n${knowledgeContext}`);
    if (dataContext) contextParts.push(dataContext);
    const contextBlock = contextParts.length > 0
      ? `\n\n---\n${contextParts.join('\n\n')}\n---\n`
      : '\n\n(No relevant knowledge base entries found.)\n';

    // Phase 4: build messages
    const messages: any[] = [{ role: 'system', content: SYSTEM_PROMPT }];
    if (Array.isArray(history)) {
      for (const msg of history.slice(-6)) {
        if (msg.role === 'user' || msg.role === 'assistant') {
          messages.push({ role: msg.role, content: msg.content });
        }
      }
    }
    messages.push({
      role: 'user',
      content: `[${trackingName}${trackingRole ? ` — ${trackingRole}` : ''}] ${message}${contextBlock}`,
    });

    // Phase 5: streaming Ollama call
    const ollamaRes = await fetch(`${OLLAMA_BASE}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        messages,
        temperature: 0.3,
        max_tokens: 1024,
        stream: true,
      }),
    });

    if (!ollamaRes.ok || !ollamaRes.body) {
      const errText = await ollamaRes.text().catch(() => 'unknown');
      throw new Error(`Ollama API ${ollamaRes.status}: ${errText}`);
    }

    // Phase 6: pipe SSE tokens to client
    const reader = ollamaRes.body.getReader();
    const decoder = new TextDecoder();
    let fullResponse = '';
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed === 'data: [DONE]') continue;
        const jsonStr = trimmed.startsWith('data: ') ? trimmed.slice(6) : trimmed;
        try {
          const chunk = JSON.parse(jsonStr);
          const token = chunk.choices?.[0]?.delta?.content;
          if (token) {
            fullResponse += token;
            sseWrite(res, JSON.stringify({ token }));
          }
        } catch {
          // malformed chunk — skip
        }
      }
    }

    sseWrite(res, '[DONE]');

    logger.info('Chat response', {
      userId, responseLength: fullResponse.length,
      hadKnowledge: !!knowledgeContext, hadData: !!dataContext, model: MODEL,
    });
  } catch (err: any) {
    logger.error('Chat API error', { error: err.message, stack: err.stack, userId });
    sseWrite(res, JSON.stringify({ error: 'An unexpected error occurred. Please try again.' }));
  } finally {
    res.end();
  }
}

export default withAuth(handler);
