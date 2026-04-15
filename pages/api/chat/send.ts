/**
 * Chat API - Velo, the FibreFlow assistant
 *
 * POST /api/chat/send
 * Body: { message, userName?, userRole?, userId?, topic?, history?, dataAccess? }
 *
 * Uses three tools:
 * 1. search_knowledge — Qdrant semantic search over fibreflow_kb (nomic-embed-text, 768-dim)
 * 2. query_database — execute validated read-only SQL
 * 3. get_schema — fetch column info for specific tables
 *
 * LLM: gemma4:e4b via local Ollama on Mac Mini (192.168.1.79)
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
const MODEL = 'gemma4:e4b';
const EMBED_MODEL = 'nomic-embed-text';
const QDRANT_COLLECTION = 'fibreflow_kb';

// ── Embeddings via nomic-embed-text (Mac Mini proxy) ──────────

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

// ── Semantic search via Qdrant fibreflow_kb ────────────────────

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

    if (results.length === 0) return 'No relevant knowledge found.';

    return results
      .map((r, i) =>
        `[${i + 1}] (${r.payload.source} — ${r.payload.section}, score: ${(r.score * 100).toFixed(0)}%)\n${r.payload.content}`
      )
      .join('\n\n---\n\n');
  } catch (err: any) {
    logger.error('Knowledge search failed', { error: err.message });
    return `Search error: ${err.message}`;
  }
}

// ── SQL execution (read-only, validated) ───────────────────────

const SQL_BLOCKLIST = /\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|GRANT|REVOKE|EXECUTE|COPY|VACUUM|REINDEX)\b/i;

async function queryDatabase(sql: string): Promise<string> {
  const trimmed = sql.trim().replace(/;+$/, '');
  if (!trimmed.toUpperCase().startsWith('SELECT')) {
    return 'Error: Only SELECT queries are allowed.';
  }
  if (SQL_BLOCKLIST.test(trimmed)) {
    return 'Error: Query contains forbidden keywords.';
  }

  try {
    const client = await pool.connect();
    try {
      await client.query('SET statement_timeout = 5000');
      const hasLimit = /\bLIMIT\s+\d+/i.test(trimmed);
      const safeSql = hasLimit ? trimmed : `${trimmed} LIMIT 100`;
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

      return `${header}\n${'—'.repeat(header.length)}\n${rows.join('\n')}\n\n(${result.rows.length} rows${result.rows.length >= 100 ? ', limited to 100' : ''})`;
    } finally {
      client.release();
    }
  } catch (err: any) {
    logger.error('SQL query failed', { sql: trimmed.substring(0, 200), error: err.message });
    return `Query error: ${err.message}`;
  }
}

// ── Schema lookup ──────────────────────────────────────────────

async function getSchema(tables: string[]): Promise<string> {
  try {
    const result = await pool.query(
      `SELECT table_name, column_name, data_type, is_nullable
       FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = ANY($1)
       ORDER BY table_name, ordinal_position`,
      [tables]
    );

    if (result.rows.length === 0) {
      return `No columns found for tables: ${tables.join(', ')}. Check table names.`;
    }

    const grouped: Record<string, string[]> = {};
    for (const row of result.rows) {
      if (!grouped[row.table_name]) grouped[row.table_name] = [];
      grouped[row.table_name]!.push(
        `  ${row.column_name} ${row.data_type}${row.is_nullable === 'YES' ? ' (nullable)' : ''}`
      );
    }

    return Object.entries(grouped)
      .map(([table, cols]) => `${table}:\n${cols.join('\n')}`)
      .join('\n\n');
  } catch (err: any) {
    logger.error('Schema lookup failed', { error: err instanceof Error ? err.message : String(err) });
    return `Schema lookup error: ${err.message}`;
  }
}

// ── List available tables ──────────────────────────────────────

let tableListCache: string | null = null;

async function getTableList(): Promise<string> {
  if (tableListCache) return tableListCache;
  try {
    const result = await pool.query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_type IN ('BASE TABLE', 'VIEW')
       ORDER BY table_name`
    );
    tableListCache = result.rows.map((r: any) => r.table_name).join(', ');
    return tableListCache;
  } catch { return ''; }
}

// ── Tool definitions (OpenAI-compatible format) ────────────────

const TOOLS = [
  {
    type: 'function' as const,
    function: {
      name: 'search_knowledge',
      description: 'Search the FibreFlow knowledge base (user manual, docs, module guides) using semantic search. Use for questions about how to use features, what things mean, how the system works, or to understand workflows.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Natural language search query' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_schema',
      description: 'Get the column names and types for specific database tables. Use this before writing SQL to understand the table structure.',
      parameters: {
        type: 'object',
        properties: {
          tables: {
            type: 'array',
            items: { type: 'string' },
            description: 'List of table names to look up',
          },
        },
        required: ['tables'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'query_database',
      description: `Execute a read-only PostgreSQL SELECT query against the FibreFlow database. Only SELECT is allowed. Results limited to 100 rows. Use get_schema first if unsure about column names.

Common tables: oes_activations (home activations, has activation_date DATE and team), dr_photo_unified_reviews (QA photo reviews), maintenance_tickets, projects, staff, technicians, fleet_vehicles, purchase_orders (has odoo_po_id for Odoo-imported POs, po_number like P00003), purchase_order_items (has tax_rate, tax_amount, total_price), assets.

PostgreSQL date tips:
- Current date: CURRENT_DATE
- Yesterday: CURRENT_DATE - 1
- Last 7 days: WHERE col >= CURRENT_DATE - 7
- This week (Mon-Sun): WHERE col >= date_trunc('week', CURRENT_DATE)
- This month: WHERE col >= date_trunc('month', CURRENT_DATE)
- Date arithmetic uses integers: CURRENT_DATE - 30 (not INTERVAL for date columns)
- For timestamps use: NOW() - INTERVAL '7 days'`,
      parameters: {
        type: 'object',
        properties: {
          sql: { type: 'string', description: 'SQL SELECT query to execute' },
        },
        required: ['sql'],
      },
    },
  },
];

const TOOLS_NO_DATA = [TOOLS[0]]; // search_knowledge only

// ── Ollama API helper ──────────────────────────────────────────

async function callOllama(body: Record<string, any>) {
  const response = await fetch(`${OLLAMA_BASE}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Ollama API ${response.status}: ${errorText}`);
  }

  return response.json();
}

// ── Tool execution router ──────────────────────────────────────

async function executeTool(name: string, args: any): Promise<string> {
  switch (name) {
    case 'search_knowledge':
      return searchKnowledge(args.query, args.limit || 5);
    case 'get_schema':
      return getSchema(args.tables || []);
    case 'query_database':
      return queryDatabase(args.sql || '');
    default:
      return `Unknown tool: ${name}`;
  }
}

// ── System prompts ─────────────────────────────────────────────

const DOMAIN_GLOSSARY = `
Key FibreFlow terms and acronyms (use these definitions — never guess):
- BOQ: Bill of Quantities — a list of materials/items needed for a project, used in Procurement
- RFQ: Request for Quotation — sent to suppliers to get pricing for a BOQ
- PO: Purchase Order — issued to a supplier after approving a quote
- GRN: Goods Received Note — records physical receipt of stock from a supplier
- OES: Outside Equipment Survey — field survey data collected via QField
- DR: Drop Request — a request to install a fibre drop to a customer premises
- QA: Quality Assurance — photo review workflow for civil/activation work
- VLM: Vision Language Model — AI model used for automated photo analysis
- NOC: Network Operations Centre — monitors network faults and maintenance tickets
- OTIF: On Time In Full — supplier delivery performance metric
- KYC: Know Your Customer — customer onboarding document verification
- SOW: Schedule of Works — project work breakdown imported from spreadsheets
- PP: Planned Premises — premises planned for fibre coverage in a project
- OLT: Optical Line Terminal — network device that connects the fibre backbone
- PON: Passive Optical Network — the fibre distribution network
- RBAC: Role-Based Access Control — permission system controlling feature access
`;

const SYSTEM_PROMPT = `You are Velo, the FibreFlow assistant — a knowledgeable guide embedded in the FibreFlow application (app.fibreflow.app) for Velocity Fibre internal staff.

You have access to tools that let you:
1. **Search knowledge** — semantic search over the user manual, module docs, and guides
2. **Look up table schemas** — see column names/types before writing queries
3. **Query the database** — run read-only SQL to get live data

Guidelines:
- For "how to" questions → search_knowledge first, ALWAYS, before answering
- For data questions (counts, lists, metrics) → get_schema if needed, then query_database
- Always verify table/column names with get_schema before writing SQL if unsure
- Present data clearly with context ("As of right now, there are X...")
- Use markdown formatting for readability
- Be concise (2-4 paragraphs unless detailed steps are needed)
- Use specific menu paths like **Sidebar → Module → Tab** when guiding users
- If you can't find the answer, say so honestly
- You can ONLY read data — never suggest you can modify, create, or delete anything
${DOMAIN_GLOSSARY}`;

const SYSTEM_PROMPT_NO_DATA = `You are Velo, the FibreFlow assistant — a knowledgeable guide embedded in the FibreFlow application (app.fibreflow.app) for Velocity Fibre internal staff.

You have access to search_knowledge to find information from the user manual and module documentation.

Guidelines:
- Search the knowledge base ALWAYS before answering any question about features or how-to
- Use markdown formatting for readability
- Be concise (2-4 paragraphs unless detailed steps are needed)
- Use specific menu paths like **Sidebar → Module → Tab** when guiding users
- You are INFORMATIONAL ONLY — you cannot query live data or modify anything
- If users ask for live data or metrics, explain they need data access enabled for their role
- If you can't find the answer, say so honestly
${DOMAIN_GLOSSARY}`;

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

  // ── Rate Limiting ──
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

  const hasDataAccess = !!dataAccess;

  let systemPrompt = hasDataAccess ? SYSTEM_PROMPT : SYSTEM_PROMPT_NO_DATA;
  if (hasDataAccess) {
    const tables = await getTableList();
    if (tables) systemPrompt += `\n\nAvailable database tables: ${tables}`;
  }

  const messages: Array<any> = [{ role: 'system', content: systemPrompt }];

  // Add conversation history (last 6 messages)
  if (Array.isArray(history)) {
    for (const msg of history.slice(-6)) {
      if (msg.role === 'user' || msg.role === 'assistant') {
        messages.push({ role: msg.role, content: msg.content });
      }
    }
  }

  const userContext = `[${trackingName}${trackingRole ? ` — ${trackingRole}` : ''}] `;
  messages.push({ role: 'user', content: `${userContext}${message}` });

  try {
    logger.info('Chat request', {
      userId, userName: trackingName, userRole: trackingRole,
      topic: topic || 'general', dataAccess: hasDataAccess,
      messageLength: message.length, model: MODEL,
    });

    const tools = hasDataAccess ? TOOLS : TOOLS_NO_DATA;

    let data = await callOllama({
      model: MODEL, messages, temperature: 0.3, max_tokens: 2048,
      tools, tool_choice: 'auto',
    });

    let choice = data.choices?.[0];
    let rounds = 0;

    // Handle tool calls (max 5 rounds)
    while (choice?.finish_reason === 'tool_calls' && choice.message?.tool_calls && rounds < 5) {
      rounds++;
      messages.push(choice.message);

      for (const toolCall of choice.message.tool_calls) {
        const args = JSON.parse(toolCall.function.arguments || '{}');
        logger.info('Tool call', { tool: toolCall.function.name, args, round: rounds, userId });

        const result = await executeTool(toolCall.function.name, args);
        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: result,
        });
      }

      data = await callOllama({
        model: MODEL, messages, temperature: 0.3, max_tokens: 2048,
        tools, tool_choice: 'auto',
      });
      choice = data.choices?.[0];
    }

    let assistantResponse = choice?.message?.content;

    // If model ended on tool calls with no content, force a text response
    if (!assistantResponse && choice?.message?.tool_calls) {
      messages.push(choice.message);
      for (const toolCall of choice.message.tool_calls) {
        const args = JSON.parse(toolCall.function.arguments || '{}');
        const result = await executeTool(toolCall.function.name, args);
        messages.push({ role: 'tool', tool_call_id: toolCall.id, content: result });
      }
      data = await callOllama({ model: MODEL, messages, temperature: 0.3, max_tokens: 2048 });
      assistantResponse = data.choices?.[0]?.message?.content;
    }

    if (!assistantResponse) {
      logger.error('Empty response from Ollama', { data, userId });
      return apiResponse.error(res, ErrorCode.INTERNAL_ERROR, 'Failed to generate response.');
    }

    logger.info('Chat response', {
      userId, responseLength: assistantResponse.length,
      tokensUsed: data.usage, toolRounds: rounds, model: MODEL,
    });

    return apiResponse.success(res, { response: assistantResponse, model: MODEL });
  } catch (err: any) {
    logger.error('Chat API error', { error: err.message, stack: err.stack, userId });
    return apiResponse.error(res, ErrorCode.INTERNAL_ERROR, 'An unexpected error occurred. Please try again.');
  }
}

export default withAuth(handler);
