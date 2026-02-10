/**
 * Chat API - FibreFlow Help Assistant
 * 
 * POST /api/chat/send
 * Body: { message, userName?, userRole?, userId?, topic?, history?, dataAccess? }
 * 
 * Topic-scoped context with GPT-4o-mini for fast responses.
 * If dataAccess=true, enables function calling to query live FibreFlow data.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import fs from 'fs';
import path from 'path';
import pool from '@/lib/db';

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const MODEL = 'gpt-4o-mini';

// ── Topic sections from the manual ─────────────────────────────────

const SECTION_RANGES: Record<string, { start: string; end: string; label: string }> = {
  'getting-started': { start: '## 1. Getting Started', end: '## 2. Main', label: 'Getting Started' },
  'dashboard':       { start: '## 2. Main', end: '## 3. Project Management', label: 'Dashboard, Meetings & Action Items' },
  'projects':        { start: '## 3. Project Management', end: '## 4. Activate', label: 'Project Management' },
  'activate':        { start: '## 4. Activate', end: '## 5. Field Operations', label: 'Activate & QA' },
  'field-ops':       { start: '## 5. Field Operations', end: '## 6. Maintenance', label: 'Field Operations' },
  'maintenance':     { start: '## 6. Maintenance', end: '## 7. Procurement', label: 'Maintenance' },
  'procurement':     { start: '## 7. Procurement', end: '## 8. Assets', label: 'Procurement' },
  'assets':          { start: '## 8. Assets', end: '## 9. Fleet Management', label: 'Assets' },
  'fleet':           { start: '## 9. Fleet Management', end: '## 10. Human Resources', label: 'Fleet Management' },
  'hr':              { start: '## 10. Human Resources', end: '## 11. Analytics', label: 'Human Resources' },
  'analytics':       { start: '## 11. Analytics', end: '## 12. Communications', label: 'Analytics' },
  'communications':  { start: '## 12. Communications', end: '## 13. System Administration', label: 'Communications' },
  'system':          { start: '## 13. System Administration', end: '## 14. Appendices', label: 'System Administration' },
  'general':         { start: '## 14. Appendices', end: '___END___', label: 'General & Glossary' },
};

let manualCache: string | null = null;
const sectionCache = new Map<string, string>();

function loadManual(): string {
  if (manualCache) return manualCache;
  try {
    manualCache = fs.readFileSync(
      path.join(process.cwd(), 'docs', 'user-manuals', 'source', 'fibreflow-complete.md'),
      'utf-8'
    );
    return manualCache;
  } catch { return ''; }
}

function getSection(topic: string): string {
  if (sectionCache.has(topic)) return sectionCache.get(topic)!;
  
  const manual = loadManual();
  if (!manual) return '';
  
  const range = SECTION_RANGES[topic];
  if (!range) return '';
  
  const startIdx = manual.indexOf(range.start);
  if (startIdx === -1) return '';
  
  let endIdx: number;
  if (range.end === '___END___') {
    endIdx = manual.length;
  } else {
    endIdx = manual.indexOf(range.end, startIdx + 1);
    if (endIdx === -1) endIdx = manual.length;
  }
  
  let section = manual.substring(startIdx, endIdx);
  section = section.replace(/!\[.*?\]\(.*?\)\n\*.*?\*\n?/g, '');
  
  sectionCache.set(topic, section);
  return section;
}

function getGeneralContext(): string {
  return `FibreFlow is a web application (app.fibreflow.app) for managing fibre optic network deployment.

Sidebar modules: Dashboard, Project Management, Activate (QA), Field Operations, Maintenance, Procurement, Assets, Fleet, Human Resources, Analytics, Communications, System Admin.

User roles: Super Admin (full access), Admin, Manager, Technician (field worker), Viewer (read-only), Contractor (portal only).

Common tasks: Create projects, review QA photos (5-phase wizard), manage maintenance tickets (Kanban), procurement (BOQ→RFQ→PO), fleet check-ins, staff management.

If the user asks about a specific module, suggest they select that topic for detailed help.`;
}

// ── Data lookup queries (pre-defined, read-only) ────────────────

const DATA_QUERIES: Record<string, { name: string; description: string; sql: string; format: 'table' | 'count' }> = {
  maintenance_summary:    { name: 'Maintenance Summary',    description: 'Ticket counts by status', sql: `SELECT status, COUNT(*) as count FROM maintenance_tickets GROUP BY status ORDER BY count DESC`, format: 'table' },
  maintenance_open:       { name: 'Open Tickets',           description: 'Count of open/active tickets', sql: `SELECT COUNT(*) as count FROM maintenance_tickets WHERE status IN ('new', 'open', 'assigned', 'in_progress')`, format: 'count' },
  maintenance_overdue:    { name: 'Overdue Tickets',        description: 'Tickets past SLA deadline', sql: `SELECT COUNT(*) as count FROM maintenance_tickets WHERE status NOT IN ('closed', 'resolved') AND sla_deadline < NOW()`, format: 'count' },
  maintenance_this_week:  { name: 'Tickets This Week',      description: 'Tickets created in last 7 days', sql: `SELECT status, COUNT(*) as count FROM maintenance_tickets WHERE created_at > NOW() - INTERVAL '7 days' GROUP BY status ORDER BY count DESC`, format: 'table' },
  qa_summary:             { name: 'QA Summary',             description: 'QA decision counts (PASS/FAIL/REWORK)', sql: `SELECT qa_decision, COUNT(*) as count FROM dr_photo_unified_reviews WHERE qa_decision IS NOT NULL GROUP BY qa_decision ORDER BY count DESC`, format: 'table' },
  qa_pending:             { name: 'QA Pending',             description: 'DRs pending QA review', sql: `SELECT COUNT(*) as count FROM dr_photo_unified_reviews WHERE qa_decision IS NULL`, format: 'count' },
  qa_this_week:           { name: 'QA This Week',           description: 'QA decisions in last 7 days', sql: `SELECT qa_decision, COUNT(*) as count FROM dr_photo_unified_reviews WHERE qa_decision IS NOT NULL AND qa_decision_at > NOW() - INTERVAL '7 days' GROUP BY qa_decision ORDER BY count DESC`, format: 'table' },
  qa_by_project:          { name: 'QA by Project',          description: 'QA pass/fail by project', sql: `SELECT p.name as project, qa_decision, COUNT(*) as count FROM dr_photo_unified_reviews dr JOIN projects p ON dr.project_id = p.id WHERE qa_decision IS NOT NULL GROUP BY p.name, qa_decision ORDER BY p.name, count DESC`, format: 'table' },
  projects_summary:       { name: 'Projects Summary',       description: 'Project counts by status', sql: `SELECT LOWER(status) as status, COUNT(*) as count FROM projects GROUP BY LOWER(status) ORDER BY count DESC`, format: 'table' },
  projects_active:        { name: 'Active Projects',        description: 'List of active projects', sql: `SELECT name, status, created_at FROM projects WHERE LOWER(status) = 'active' ORDER BY created_at DESC LIMIT 20`, format: 'table' },
  staff_count:            { name: 'Staff Count',            description: 'Total staff members', sql: `SELECT COUNT(*) as count FROM staff`, format: 'count' },
  staff_by_department:    { name: 'Staff by Department',    description: 'Staff per department', sql: `SELECT COALESCE(d.name, 'Unassigned') as department, COUNT(*) as count FROM staff s LEFT JOIN departments d ON s.department_id = d.id GROUP BY d.name ORDER BY count DESC`, format: 'table' },
  fleet_summary:          { name: 'Fleet Summary',          description: 'Vehicles by status', sql: `SELECT status, COUNT(*) as count FROM fleet_vehicles GROUP BY status ORDER BY count DESC`, format: 'table' },
  po_summary:             { name: 'PO Summary',             description: 'Purchase orders by status', sql: `SELECT status, COUNT(*) as count FROM purchase_orders GROUP BY status ORDER BY count DESC`, format: 'table' },
  po_pending:             { name: 'POs Pending Approval',   description: 'POs awaiting approval', sql: `SELECT COUNT(*) as count FROM purchase_orders WHERE status = 'pending_approval'`, format: 'count' },
  assets_summary:         { name: 'Assets Summary',         description: 'Assets by status', sql: `SELECT status, COUNT(*) as count FROM assets GROUP BY status ORDER BY count DESC`, format: 'table' },
  technician_performance: { name: 'Technician Performance', description: 'Top technicians by QA (30 days)', sql: `SELECT t.name as technician, COUNT(*) FILTER (WHERE dr.qa_decision = 'PASS') as passed, COUNT(*) FILTER (WHERE dr.qa_decision = 'FAIL') as failed, COUNT(*) as total FROM dr_photo_unified_reviews dr JOIN technicians t ON dr.technician_id = t.id WHERE dr.qa_decision IS NOT NULL AND dr.qa_decision_at > NOW() - INTERVAL '30 days' GROUP BY t.name ORDER BY total DESC LIMIT 15`, format: 'table' },
};

const TOOL_DEFINITION = {
  type: 'function' as const,
  function: {
    name: 'query_fibreflow_data',
    description: 'Query live FibreFlow data. Use when the user asks about counts, stats, or current data (e.g. "how many open tickets", "show me QA stats").',
    parameters: {
      type: 'object',
      properties: {
        query_id: {
          type: 'string',
          enum: Object.keys(DATA_QUERIES),
          description: `Available queries: ${Object.entries(DATA_QUERIES).map(([k, v]) => `${k} (${v.description})`).join(', ')}`,
        },
      },
      required: ['query_id'],
    },
  },
};

async function executeQuery(queryId: string): Promise<string> {
  const q = DATA_QUERIES[queryId];
  if (!q) return `Unknown query: ${queryId}`;
  try {
    const result = await pool.query(q.sql);
    if (q.format === 'count') {
      return `${q.name}: ${result.rows[0]?.count ?? 0}`;
    }
    if (result.rows.length === 0) return `${q.name}: No data found.`;
    const cols = Object.keys(result.rows[0]);
    const lines = result.rows.map(row => cols.map(c => `${c}: ${row[c] ?? 'N/A'}`).join(' | '));
    return `${q.name}:\n${lines.join('\n')}`;
  } catch (err: any) {
    console.error('Query error:', queryId, err.message);
    return `Error running query: ${err.message}`;
  }
}

// ── System prompts ──────────────────────────────────────────────

const SYSTEM_PROMPT = `You are the FibreFlow Help Assistant — a friendly, knowledgeable guide embedded in the FibreFlow application.

Rules:
- Help users navigate and use FibreFlow features
- Give step-by-step instructions with specific menu paths like: **Sidebar → Module → Tab**
- Be concise (2-4 paragraphs max unless detailed steps needed)
- Use markdown formatting
- You are INFORMATIONAL ONLY — you cannot click buttons or modify data
- If asked about something outside your current topic context, suggest the user switch topics
- If unsure, say so honestly`;

const DATA_PROMPT_SUFFIX = `\n\nYou also have access to live FibreFlow data via the query_fibreflow_data function. When users ask about counts, statistics, or current data, use this tool to get real numbers. Present data clearly with formatting.`;

// ── Handler ─────────────────────────────────────────────────────

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!OPENAI_API_KEY) return res.status(500).json({ error: 'AI service not configured' });

  const { message, userName, userRole, topic, history, dataAccess } = req.body;
  if (!message) return res.status(400).json({ error: 'message is required' });

  // Build context based on topic
  const topicContext = topic && SECTION_RANGES[topic]
    ? `\n\nREFERENCE — ${SECTION_RANGES[topic].label}:\n${getSection(topic)}`
    : `\n\nGENERAL OVERVIEW:\n${getGeneralContext()}`;

  const systemContent = SYSTEM_PROMPT + topicContext + (dataAccess ? DATA_PROMPT_SUFFIX : '');

  const messages: Array<any> = [
    { role: 'system', content: systemContent },
  ];

  // Add conversation history (last 6 messages)
  if (Array.isArray(history)) {
    for (const msg of history.slice(-6)) {
      if (msg.role === 'user' || msg.role === 'assistant') {
        messages.push({ role: msg.role, content: msg.content });
      }
    }
  }

  const userContext = userName ? `[${userName}${userRole ? ` — ${userRole}` : ''}] ` : '';
  messages.push({ role: 'user', content: `${userContext}${message}` });

  try {
    // Build request with optional tools
    const body: any = { model: MODEL, messages, temperature: 0.3, max_tokens: 1024 };
    if (dataAccess) {
      body.tools = [TOOL_DEFINITION];
      body.tool_choice = 'auto';
    }

    // Tool loop (up to 3 rounds)
    let finalContent = '';
    for (let round = 0; round < 3; round++) {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${OPENAI_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        console.error('OpenAI error:', response.status, await response.text());
        return res.status(502).json({ error: 'AI service error' });
      }

      const data = await response.json();
      const choice = data.choices?.[0];

      if (choice?.finish_reason === 'tool_calls' && choice.message?.tool_calls) {
        // Add assistant message with tool calls
        messages.push(choice.message);

        // Execute each tool call
        for (const tc of choice.message.tool_calls) {
          if (tc.function?.name === 'query_fibreflow_data') {
            const args = JSON.parse(tc.function.arguments || '{}');
            const result = await executeQuery(args.query_id);
            messages.push({
              role: 'tool',
              tool_call_id: tc.id,
              content: result,
            });
          }
        }

        // Update body for next round
        body.messages = messages;
        continue;
      }

      // Final text response
      finalContent = choice?.message?.content || 'Sorry, I could not generate a response.';
      break;
    }

    return res.status(200).json({ response: finalContent, model: MODEL });
  } catch (err: any) {
    console.error('Chat API error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
