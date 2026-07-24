import type { NextApiRequest, NextApiResponse } from 'next';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { neon } from '@neondatabase/serverless';
import { getWaCloudCreds } from '@/modules/communications/whatsapp/config/waProviderConfig';
import { createLogger } from '@/lib/logger';

export const config = { api: { bodyParser: false } };

const logger = createLogger('api:wa:cloud-webhook');

function db() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  return neon(url);
}

async function readRawBody(req: NextApiRequest): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  return Buffer.concat(chunks).toString('utf8');
}

function verifyMetaSignature(rawBody: string, header: string | undefined, appSecret: string): boolean {
  if (!header || !header.startsWith('sha256=')) return false;
  const presented = header.slice('sha256='.length);
  if (!/^[a-f0-9]+$/i.test(presented)) return false;
  const expected = createHmac('sha256', appSecret).update(rawBody).digest('hex');
  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(presented, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

type ParsedInbound = { fromPhone: string; text: string; wamid: string | null };

function parseInbound(payload: unknown): ParsedInbound | null {
  const p = payload as {
    entry?: Array<{ changes?: Array<{ value?: { messages?: Array<{ from?: string; id?: string; text?: { body?: string } }> } }> }>;
  };
  const m = p?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
  if (!m || typeof m.from !== 'string') return null;
  const text = typeof m.text?.body === 'string' ? m.text.body : null;
  if (!text) return null;
  return { fromPhone: m.from, text, wamid: typeof m.id === 'string' ? m.id : null };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'GET') {
    const { verifyToken } = await getWaCloudCreds().catch(() => ({ verifyToken: '' }));
    if (req.query['hub.mode'] === 'subscribe' && verifyToken && req.query['hub.verify_token'] === verifyToken) {
      return res.status(200).send(String(req.query['hub.challenge'] ?? ''));
    }
    return res.status(403).json({ error: 'Forbidden' });
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const rawBody = await readRawBody(req);
  let creds;
  try {
    creds = await getWaCloudCreds();
  } catch {
    return res.status(500).json({ error: 'Cloud not configured' });
  }
  const sig = req.headers['x-hub-signature-256'];
  if (!verifyMetaSignature(rawBody, Array.isArray(sig) ? sig[0] : sig, creds.appSecret)) {
    return res.status(401).json({ error: 'Bad signature' });
  }

  let payload: unknown;
  try { payload = JSON.parse(rawBody); } catch { return res.status(400).json({ error: 'Invalid JSON' }); }

  // Status callbacks and non-message events → ack, no-op in Phase 1.
  const parsed = parseInbound(payload);
  if (!parsed) return res.status(200).json({ ok: true, persisted: false });

  const sql = db();
  try {
    await sql`
      INSERT INTO wa_message_logs (direction, service, message_type, group_jid, recipient_jid, message_content, status, created_at)
      VALUES ('inbound', 'cloud', 'text', NULL, ${parsed.fromPhone}, ${parsed.text}, 'delivered', NOW())
    `;
  } catch (e) {
    logger.error('cloud inbound persist failed', { error: e instanceof Error ? e.message : String(e) });
    // Ack anyway so Meta stops retrying a message we may have already stored.
  }

  return res.status(200).json({ ok: true, persisted: true });
}
