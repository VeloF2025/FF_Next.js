import type { NextApiRequest, NextApiResponse } from 'next';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { neon } from '@neondatabase/serverless';
import { getWaCloudCreds } from '@/modules/communications/whatsapp/config/waProviderConfig';
import { normalizeMsisdn, extractMsisdnFromContact } from '@/modules/communications/whatsapp/utils/phone';
import { createLogger } from '@/lib/logger';
import rateLimiter, { RateLimits } from '@/lib/rateLimiter';

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
// Extraction alone does NOT link the message — see verifyDrSender below.
const DR_IN_TEXT = /(?<![A-Za-z])DR[\s-]?(\d{6,8})(?!\d)/i;

function extractDrNumber(text: string): string | null {
  const m = text.match(DR_IN_TEXT);
  return m ? `DR${m[1]}` : null;
}

/**
 * A DR named in inbound text is attacker-controlled: the Meta HMAC proves the
 * webhook came from Meta, not that the sender owns the DR they typed. Cloud
 * accepts messages from ANY WhatsApp number, so an unverified DR would let a
 * stranger inject messages into an arbitrary ticket's operator-facing feed.
 *
 * The DR is therefore only returned when the sender's number matches the contact
 * on a ticket carrying it. Every other outcome — unusable sender number, no such
 * ticket, contact without a phone, lookup failure — returns null so the message
 * still persists but stays unlinked, and warns with the wamid/sender/DR so ops
 * can triage the miss.
 */
async function verifyDrSender(
  sql: ReturnType<typeof db>,
  dr: string,
  fromPhone: string,
  wamid: string | null,
): Promise<string | null> {
  const unlinked = (reason: string, extra?: Record<string, unknown>) => {
    logger.warn(`cloud inbound DR left unlinked: ${reason}`, { wamid, fromPhone, dr, ...extra });
    return null;
  };

  const sender = normalizeMsisdn(fromPhone);
  if (!sender) return unlinked('sender number is not a usable MSISDN');

  let rows: Array<{ client_contact: string | null }>;
  try {
    // dr_number is indexed (idx_tickets_dr_number) and a DR maps to a handful of
    // tickets, so every candidate contact is fetched — capping the rows could
    // skip the one ticket that names this sender.
    rows = (await sql`
      SELECT client_contact
      FROM maintenance_tickets
      WHERE dr_number = ${dr} AND client_contact IS NOT NULL
    `) as Array<{ client_contact: string | null }>;
  } catch (e) {
    return unlinked('ticket lookup failed', { error: e instanceof Error ? e.message : String(e) });
  }

  // client_contact is free-form, so a phone is extracted from it before comparing.
  const matched = rows.some((r) => extractMsisdnFromContact(r.client_contact) === sender);
  if (!matched) return unlinked('sender is not a contact on any ticket for this DR', { tickets: rows.length });

  return dr;
}

/**
 * Every DR claim costs a maintenance_tickets lookup regardless of whether it
 * verifies, so a sender spamming guessed DR numbers can drive DB load and warn-log
 * noise even though there's no response-side oracle to actually learn anything
 * from (Cloud always acks 200 the same way). Capped per normalized sender —
 * once exceeded, the lookup is skipped entirely (fail closed: unlinked, same as
 * any other unverifiable case) and ops is warned so a sustained probe is visible.
 */
async function resolveDropNumber(
  sql: ReturnType<typeof db>,
  dr: string,
  fromPhone: string,
  wamid: string | null,
): Promise<string | null> {
  const key = `dr-probe:${normalizeMsisdn(fromPhone) ?? fromPhone}`;
  const rl = rateLimiter.check(key, RateLimits.DR_PROBE.limit, RateLimits.DR_PROBE.windowMs);
  if (!rl.success) {
    logger.warn('cloud inbound DR left unlinked: DR-probe rate limit exceeded', {
      wamid, fromPhone, dr, resetAt: rl.resetAt,
    });
    return null;
  }
  return verifyDrSender(sql, dr, fromPhone, wamid);
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

  const sql = db();
  const claimedDr = extractDrNumber(parsed.text);
  const dropNumber = claimedDr
    ? await resolveDropNumber(sql, claimedDr, parsed.fromPhone, parsed.wamid)
    : null;
  try {
    // ON CONFLICT keyed on the wamid (partial unique index, migration 459) makes
    // a re-delivered Meta webhook event idempotent — one row per wamid.
    // drop_number links the inbound to a ticket's feed only once the sender has
    // been verified as that ticket's contact.
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
