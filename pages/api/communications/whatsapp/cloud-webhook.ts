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

// Delivery-receipt statuses Meta sends for our outbound messages, ranked by
// progression so a later UPDATE can only advance the row (never regress it when
// Meta redelivers out of order). Values stay within the wa_message_logs.status
// CHECK constraint (which also allows the internal 'pending', never emitted here).
const STATUS_RANK: Record<string, number> = { sent: 1, delivered: 2, read: 3, failed: 3 };
const CLOUD_STATUSES = new Set(Object.keys(STATUS_RANK));

type ParsedStatus = { wamid: string; status: string };

function parseStatuses(payload: unknown): ParsedStatus[] {
  const p = payload as {
    entry?: Array<{ changes?: Array<{ value?: { statuses?: Array<{ id?: string; status?: string }> } }> }>;
  };
  // Meta can batch multiple entries/changes per POST — iterate all of them so no
  // delivery receipt is silently dropped.
  const out: ParsedStatus[] = [];
  for (const entry of p?.entry ?? []) {
    for (const change of entry?.changes ?? []) {
      for (const s of change?.value?.statuses ?? []) {
        if (typeof s?.id === 'string' && typeof s?.status === 'string' && CLOUD_STATUSES.has(s.status)) {
          out.push({ wamid: s.id, status: s.status });
        }
      }
    }
  }
  return out;
}

// A DR/drop reference embedded in free-form text: "DR" + 6–8 digits, optional
// space/dash separator. Normalized to the canonical `DR<digits>` form stored in
// maintenance_tickets.dr_number / wa_message_logs.drop_number so a Cloud inbound
// surfaces in that ticket's conversation feed (feed route scopes by drop_number).
// Word-bounded: the leading (?<![A-Za-z]) rejects "…dr123456" inside another word
// (e.g. "ADDR123456"); the trailing (?!\d) rejects over-long digit runs.
// NOTE: the sender is NOT verified against the DR — an inbound is trusted the same
// way group-bridge messages are (Phase 1.5). Sender↔DR verification is Phase 2.
const DR_IN_TEXT = /(?<![A-Za-z])DR[\s-]?(\d{6,8})(?!\d)/i;

function extractDrNumber(text: string): string | null {
  const m = text.match(DR_IN_TEXT);
  return m ? `DR${m[1]}` : null;
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

  // Delivery-receipt callbacks (sent/delivered/read/failed) → update the matching
  // outbound row by wamid. A single UPDATE per status; a failed UPDATE is logged
  // but still acked so Meta stops retrying.
  const statuses = parseStatuses(payload);
  if (statuses.length > 0) {
    const sql = db();
    let updated = 0;
    for (const s of statuses) {
      try {
        // Only advance: the incoming status must outrank the row's current status,
        // so an out-of-order redelivery (e.g. a late 'sent' after 'read') cannot
        // regress the displayed delivery state.
        await sql`
          UPDATE wa_message_logs
          SET status = ${s.status}
          WHERE provider_message_id = ${s.wamid}
            AND ${STATUS_RANK[s.status]} > CASE status
              WHEN 'sent' THEN 1
              WHEN 'delivered' THEN 2
              WHEN 'read' THEN 3
              WHEN 'failed' THEN 3
              ELSE 0
            END
        `;
        updated += 1;
      } catch (e) {
        logger.error('cloud status update failed', { wamid: s.wamid, status: s.status, error: e instanceof Error ? e.message : String(e) });
      }
    }
    return res.status(200).json({ ok: true, statuses: updated });
  }

  const parsed = parseInbound(payload);
  if (!parsed) return res.status(200).json({ ok: true, persisted: false });

  const dropNumber = extractDrNumber(parsed.text);
  const sql = db();
  try {
    // ON CONFLICT keyed on the wamid (partial unique index, migration 459) makes
    // a re-delivered Meta webhook event idempotent — one row per wamid.
    // drop_number links the inbound to a ticket's feed when the text names a DR.
    await sql`
      INSERT INTO wa_message_logs (direction, service, message_type, group_jid, recipient_jid, message_content, status, drop_number, provider_message_id, created_at)
      VALUES ('inbound', 'cloud', 'text', NULL, ${parsed.fromPhone}, ${parsed.text}, 'delivered', ${dropNumber}, ${parsed.wamid}, NOW())
      ON CONFLICT (provider_message_id) WHERE provider_message_id IS NOT NULL DO NOTHING
    `;
  } catch (e) {
    logger.error('cloud inbound persist failed', { error: e instanceof Error ? e.message : String(e) });
    // Ack with 200 so Meta stops retrying, but report the row was NOT persisted.
    return res.status(200).json({ ok: true, persisted: false });
  }

  return res.status(200).json({ ok: true, persisted: true });
}
