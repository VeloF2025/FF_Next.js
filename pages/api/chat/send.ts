/**
 * Chat API - FibreFlow Help Assistant
 * 
 * POST /api/chat/send
 * Body: { message, userName?, userRole?, topic?, history? }
 * 
 * Topic-scoped context with GPT-4o-mini for fast responses.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import fs from 'fs';
import path from 'path';
import { withOptionalAuth } from '@/lib/auth/middleware';
import { createLogger } from '@/lib/logger';

const logger = createLogger('api:chat:send');

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
  
  // Strip image markdown (screenshots) to save tokens
  let section = manual.substring(startIdx, endIdx);
  section = section.replace(/!\[.*?\]\(.*?\)\n\*.*?\*\n?/g, '');
  
  sectionCache.set(topic, section);
  return section;
}

function getGeneralContext(): string {
  // Lightweight overview for when no topic is selected
  return `FibreFlow is a web application (app.fibreflow.app) for managing fibre optic network deployment.

Sidebar modules: Dashboard, Project Management, Activate (QA), Field Operations, Maintenance, Procurement, Assets, Fleet, Human Resources, Analytics, Communications, System Admin.

User roles: Super Admin (full access), Admin, Manager, Technician (field worker), Viewer (read-only), Contractor (portal only).

Common tasks: Create projects, review QA photos (5-phase wizard), manage maintenance tickets (Kanban), procurement (BOQ→RFQ→PO), fleet check-ins, staff management.

If the user asks about a specific module, suggest they select that topic for detailed help.`;
}

const SYSTEM_PROMPT = `You are the FibreFlow Help Assistant — a friendly, knowledgeable guide embedded in the FibreFlow application.

Rules:
- Help users navigate and use FibreFlow features
- Give step-by-step instructions with specific menu paths like: **Sidebar → Module → Tab**
- Be concise (2-4 paragraphs max unless detailed steps needed)
- Use markdown formatting
- You are INFORMATIONAL ONLY — you cannot click buttons, run queries, or modify data
- If asked about something outside your current topic context, suggest the user switch topics
- If unsure, say so honestly`;

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!OPENAI_API_KEY) return res.status(500).json({ error: 'AI service not configured' });

  const { message, userName, userRole, topic, history } = req.body;
  if (!message) return res.status(400).json({ error: 'message is required' });

  // Track user info from auth middleware or request body
  const authenticatedUser = (req as any).user;
  const trackingName = authenticatedUser?.name || userName || 'Anonymous';
  const trackingRole = authenticatedUser?.role || userRole || 'Guest';

  // Build context based on topic
  const topicContext = topic && SECTION_RANGES[topic]
    ? `\n\nREFERENCE — ${SECTION_RANGES[topic].label}:\n${getSection(topic)}`
    : `\n\nGENERAL OVERVIEW:\n${getGeneralContext()}`;

  const messages: Array<{ role: string; content: string }> = [
    { role: 'system', content: SYSTEM_PROMPT + topicContext },
  ];

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
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model: MODEL, messages, temperature: 0.3, max_tokens: 1024 }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error('OpenAI API error', { status: response.status, error: errorText });
      return res.status(502).json({ error: 'AI service error' });
    }

    const data = await response.json();
    return res.status(200).json({
      response: data.choices?.[0]?.message?.content || 'Sorry, I could not generate a response.',
      model: MODEL,
    });
  } catch (err: any) {
    logger.error('Chat API error', { error: err.message, stack: err.stack });
    return res.status(500).json({ error: 'Internal server error' });
  }
}

export default withOptionalAuth(handler);
