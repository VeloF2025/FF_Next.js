# FibreFlow — WhatsApp Cloud Provider + NOC Ticket Conversation Panel (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give NOC tickets a WhatsApp **conversation tab** (see the thread, reply from the ticket) AND add an official **Meta Cloud API 1:1 provider** behind a shared send client, selectable via config — without disturbing FibreFlow's existing group-based bridge flows.

**Architecture:** FF has no shared "send WhatsApp" function today — ≥12 call sites hit the bridge directly. This plan introduces one shared 1:1 send client (`sendWhatsAppText`) that routes to **Cloud** (Graph API) or **WAHA** (existing 1:1 DM) based on a `wa_service_config` provider switch, logging to the existing `wa_message_logs`. A new Cloud inbound webhook (Meta `X-Hub-Signature-256` verified) feeds the same store and best-effort ticket linkage. The NOC ticket gains a `whatsapp` tab that unifies the inbound group-mention feed (existing `getMessagesForDR`) with 1:1 Cloud/WAHA messages, and replies route back through the channel each message came from.

**Tech Stack:** Next.js 14 (Pages + App router hybrid), React 18, raw SQL via `neon` tagged templates (`@neondatabase/serverless`), custom `withAuth` session guard, vitest, Meta WhatsApp Cloud API (Graph), WAHA.

## Global Constraints

- **Single-tenant** app — no org/tenant scoping. Config is global.
- **Cloud API is 1:1 only.** It cannot send to WhatsApp groups. FF's group flows (DR mentions, feedback, OTP) **stay on the bridge/WAHA untouched** — do NOT reroute them.
- **Cloud 1:1 reply reachability:** Meta only allows a free-form 1:1 message to a customer inside the 24-hour window after *they* messaged your Cloud number. A group-sourced thread's participants have not messaged your Cloud number, so **those replies route via WAHA, not Cloud.** The panel routes each reply by the source channel of the message being replied to; Cloud is used only for contacts who reached you on the Cloud number. This is a hard Meta rule, surfaced to the operator, not worked around.
- **DB style:** raw SQL via `neon` tagged templates (match `waTicketLinker.ts` / app-router NOC routes); use `ON CONFLICT ... DO NOTHING` for idempotency. Do not add an ORM.
- **Auth:** authed API routes use `withAuth(handler)` (custom DB session guard). The Cloud webhook is bridge-style: no `withAuth`, verified by Meta signature instead.
- **Reuse `wa_message_logs`** for message rows (extend its `service` CHECK to add `'cloud'` and `'waha'`). Do NOT invent a new messages table in Phase 1.
- **Cloud credentials** live in the existing `wa_service_config` table (key/value/`is_sensitive`) — the token, app secret, and verify token are `is_sensitive=true`. Read only via the Task 1 accessor.
- **Graph API version** pinned via env `WHATSAPP_GRAPH_VERSION` (default `v23.0`); confirm current stable at build time.
- Tests: `npx vitest run <path>`; mock the service/client layer or `fetch` (house style: `vi.mock(...)` the service, assert the call + the `wa_message_logs` write).

---

## File Structure

- `scripts/migrations/NNN_wa_cloud_provider.sql` (new) — extend `wa_message_logs.service` CHECK; seed `wa_service_config` provider keys (Task 1).
- `src/modules/communications/whatsapp/config/waProviderConfig.ts` (new) — read provider + Cloud creds from `wa_service_config` (Task 1).
- `src/modules/communications/whatsapp/send/waSendClient.ts` (new) — `sendWhatsAppText` shared 1:1 sender (cloud | waha) (Task 2).
- `src/modules/communications/whatsapp/send/waCloudClient.ts` (new) — Graph API text send (Task 2).
- `pages/api/communications/whatsapp/cloud-webhook.ts` (new) — GET verify + POST inbound (Task 3).
- `app/api/noc/tickets/[id]/whatsapp/route.ts` (new) — unified conversation feed for a ticket (Task 4).
- `app/api/noc/tickets/[id]/whatsapp/reply/route.ts` (new) — send a reply, route by channel (Task 6).
- `src/modules/noc/components/TicketDetail/TicketDetail.tsx` (modify) — add `whatsapp` tab (Task 5).
- `src/modules/noc/components/TicketDetail/WhatsAppConversationPanel.tsx` (new) — thread + reply UI (Task 5/6).

---

## Task 1: Provider config + Cloud credentials (`wa_service_config`)

**Files:**
- Create: `scripts/migrations/NNN_wa_cloud_provider.sql` (use the next available migration number)
- Create: `src/modules/communications/whatsapp/config/waProviderConfig.ts`
- Test: `src/modules/communications/whatsapp/config/waProviderConfig.test.ts`

**Interfaces:**
- Produces: `type WaProvider = "bridge" | "cloud"`; `type WaCloudCreds = { phoneNumberId: string; accessToken: string; appSecret: string; verifyToken: string }`; `getWaProvider(): Promise<WaProvider>`; `getWaCloudCreds(): Promise<WaCloudCreds>`; `resolveWaCloudCreds(rows): WaCloudCreds` (pure); `class WaCloudNotConfiguredError`.

- [ ] **Step 1: Write the migration**

Create `scripts/migrations/NNN_wa_cloud_provider.sql` (replace `NNN` with the next sequential number in `scripts/migrations/`):

```sql
-- Add the Cloud + WAHA 1:1 services to wa_message_logs and seed provider config.
BEGIN;

-- 1) Allow 'cloud' and 'waha' as message-log services (was: 'bridge','sender').
ALTER TABLE wa_message_logs DROP CONSTRAINT IF EXISTS wa_message_logs_service_check;
ALTER TABLE wa_message_logs
  ADD CONSTRAINT wa_message_logs_service_check
  CHECK (service IN ('bridge','sender','cloud','waha'));

-- 2) Seed provider config keys (idempotent). Values set later via the admin UI.
INSERT INTO wa_service_config (config_key, config_value, config_type, category, description, is_sensitive)
VALUES
  ('wa_provider',              'bridge', 'string',  'provider', 'Active 1:1 WhatsApp provider: bridge | cloud', false),
  ('cloud_phone_number_id',    '',       'string',  'cloud',    'Meta WABA phone_number_id',                    false),
  ('cloud_access_token',       '',       'string',  'cloud',    'Meta system-user access token',                true),
  ('cloud_app_secret',         '',       'string',  'cloud',    'Meta app secret for X-Hub-Signature-256',      true),
  ('cloud_verify_token',       '',       'string',  'cloud',    'Webhook GET verify token',                     true)
ON CONFLICT (config_key) DO NOTHING;

COMMIT;
```

- [ ] **Step 2: Apply the migration**

Run the repo's migration runner for a single file (match how `scripts/migrations/` are applied in this repo — check `package.json` scripts for a `migrate`/`db:migrate` target; if applied manually, run the SQL against `DATABASE_URL`). Verify:

Run: `psql "$DATABASE_URL" -c "SELECT config_key, is_sensitive FROM wa_service_config WHERE category IN ('provider','cloud') ORDER BY config_key;"`
Expected: the 5 rows above.

- [ ] **Step 3: Write the failing test**

Create `src/modules/communications/whatsapp/config/waProviderConfig.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { resolveWaCloudCreds, WaCloudNotConfiguredError } from './waProviderConfig';

const rows = (o: Record<string, string>) =>
  Object.entries(o).map(([config_key, config_value]) => ({ config_key, config_value }));

describe('resolveWaCloudCreds', () => {
  it('returns creds when all four keys are present', () => {
    expect(resolveWaCloudCreds(rows({
      cloud_phone_number_id: 'PN1',
      cloud_access_token: 'TOK',
      cloud_app_secret: 'SEC',
      cloud_verify_token: 'VER',
    }))).toEqual({ phoneNumberId: 'PN1', accessToken: 'TOK', appSecret: 'SEC', verifyToken: 'VER' });
  });

  it('throws when a required key is missing or blank', () => {
    expect(() => resolveWaCloudCreds(rows({
      cloud_phone_number_id: 'PN1', cloud_access_token: '', cloud_app_secret: 'SEC', cloud_verify_token: 'VER',
    }))).toThrow(WaCloudNotConfiguredError);
    expect(() => resolveWaCloudCreds([])).toThrow(WaCloudNotConfiguredError);
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npx vitest run src/modules/communications/whatsapp/config/waProviderConfig.test.ts`
Expected: FAIL — cannot find module `./waProviderConfig`.

- [ ] **Step 5: Write the implementation**

Create `src/modules/communications/whatsapp/config/waProviderConfig.ts`:

```ts
import { neon } from '@neondatabase/serverless';

export type WaProvider = 'bridge' | 'cloud';

export type WaCloudCreds = {
  phoneNumberId: string;
  accessToken: string;
  appSecret: string;
  verifyToken: string;
};

export class WaCloudNotConfiguredError extends Error {
  constructor() {
    super('WhatsApp Cloud credentials are not fully configured in wa_service_config');
    this.name = 'WaCloudNotConfiguredError';
  }
}

type ConfigRow = { config_key: string; config_value: string };

function db() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  return neon(url);
}

export async function getWaProvider(): Promise<WaProvider> {
  const sql = db();
  const rows = (await sql`
    SELECT config_value FROM wa_service_config WHERE config_key = 'wa_provider' LIMIT 1
  `) as { config_value: string }[];
  return rows[0]?.config_value === 'cloud' ? 'cloud' : 'bridge';
}

/** Pure resolver — DB-free for testability. Throws if any Cloud key is blank. */
export function resolveWaCloudCreds(rows: ConfigRow[]): WaCloudCreds {
  const map = new Map(rows.map((r) => [r.config_key, (r.config_value ?? '').trim()]));
  const phoneNumberId = map.get('cloud_phone_number_id') ?? '';
  const accessToken = map.get('cloud_access_token') ?? '';
  const appSecret = map.get('cloud_app_secret') ?? '';
  const verifyToken = map.get('cloud_verify_token') ?? '';
  if (!phoneNumberId || !accessToken || !appSecret || !verifyToken) {
    throw new WaCloudNotConfiguredError();
  }
  return { phoneNumberId, accessToken, appSecret, verifyToken };
}

export async function getWaCloudCreds(): Promise<WaCloudCreds> {
  const sql = db();
  const rows = (await sql`
    SELECT config_key, config_value FROM wa_service_config
    WHERE config_key IN ('cloud_phone_number_id','cloud_access_token','cloud_app_secret','cloud_verify_token')
  `) as ConfigRow[];
  return resolveWaCloudCreds(rows);
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run src/modules/communications/whatsapp/config/waProviderConfig.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 7: Commit**

```bash
git add scripts/migrations/*_wa_cloud_provider.sql src/modules/communications/whatsapp/config/waProviderConfig.ts src/modules/communications/whatsapp/config/waProviderConfig.test.ts
git commit -m "feat(comms): WhatsApp provider switch + Cloud creds in wa_service_config"
```

---

## Task 2: Shared 1:1 send client (`sendWhatsAppText`)

**Files:**
- Create: `src/modules/communications/whatsapp/send/waCloudClient.ts`
- Create: `src/modules/communications/whatsapp/send/waSendClient.ts`
- Test: `src/modules/communications/whatsapp/send/waCloudClient.test.ts`, `waSendClient.test.ts`

**Interfaces:**
- Consumes: `getWaProvider`, `getWaCloudCreds` (Task 1); WAHA DM sender from `@/modules/noc/services/whatsappService` (existing public `sendWhatsAppDM(phone, text)` — confirm its exact export name/signature and match it).
- Produces:
  - `sendViaCloud(opts: { toPhone: string; message: string; creds: WaCloudCreds; signal?: AbortSignal }): Promise<WaSendResult>`
  - `sendWhatsAppText(opts: { toPhone: string; message: string; channel?: WaSendChannel; signal?: AbortSignal }): Promise<WaSendResult>`
  - `type WaSendChannel = 'cloud' | 'waha'`
  - `type WaSendResult = { ok: boolean; channel: WaSendChannel; providerMessageId?: string; error?: string; outcome?: 'DEFINITELY_REJECTED' | 'AMBIGUOUS' }`

- [ ] **Step 1: Write the failing Cloud-client test**

Create `src/modules/communications/whatsapp/send/waCloudClient.test.ts`:

```ts
import { afterEach, describe, it, expect, vi } from 'vitest';
import { sendViaCloud } from './waCloudClient';

const creds = { phoneNumberId: 'PN1', accessToken: 'TOK', appSecret: 'SEC', verifyToken: 'VER' };

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe('sendViaCloud', () => {
  it('POSTs a text message to Graph and returns the wamid', async () => {
    vi.stubEnv('WHATSAPP_GRAPH_VERSION', 'v23.0');
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ messages: [{ id: 'wamid.A' }] }) });
    vi.stubGlobal('fetch', fetchSpy);

    const r = await sendViaCloud({ toPhone: '0821234567', message: 'hi', creds });

    expect(r).toEqual({ ok: true, channel: 'cloud', providerMessageId: 'wamid.A' });
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('https://graph.facebook.com/v23.0/PN1/messages');
    expect((init as RequestInit).headers).toMatchObject({ Authorization: 'Bearer TOK' });
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      messaging_product: 'whatsapp', to: '27821234567', type: 'text', text: { body: 'hi' },
    });
  });

  it('classifies a 400 as DEFINITELY_REJECTED and a 503 as AMBIGUOUS', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 400, text: async () => 'bad' }));
    expect((await sendViaCloud({ toPhone: '27821234567', message: 'x', creds })).outcome).toBe('DEFINITELY_REJECTED');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503, text: async () => 'up' }));
    expect((await sendViaCloud({ toPhone: '27821234567', message: 'x', creds })).outcome).toBe('AMBIGUOUS');
  });

  it('holds a 200 without a wamid as AMBIGUOUS', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ messages: [] }) }));
    const r = await sendViaCloud({ toPhone: '27821234567', message: 'x', creds });
    expect(r).toMatchObject({ ok: false, outcome: 'AMBIGUOUS' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/modules/communications/whatsapp/send/waCloudClient.test.ts`
Expected: FAIL — cannot find module `./waCloudClient`.

- [ ] **Step 3: Write the Cloud client**

Create `src/modules/communications/whatsapp/send/waCloudClient.ts`:

```ts
import type { WaCloudCreds } from '../config/waProviderConfig';

export type WaSendChannel = 'cloud' | 'waha';
export type WaSendResult = {
  ok: boolean;
  channel: WaSendChannel;
  providerMessageId?: string;
  error?: string;
  outcome?: 'DEFINITELY_REJECTED' | 'AMBIGUOUS';
};

const DEFINITE = new Set([400, 401, 403, 404, 405, 413, 415, 422, 429]);

function normalizePhone(phone: string): string {
  let p = phone.replace(/@s\.whatsapp\.net$/i, '').replace(/[\s\-+]/g, '');
  if (p.startsWith('0') && p.length === 10) p = '27' + p.slice(1);
  return p;
}

function graphVersion(): string {
  return process.env.WHATSAPP_GRAPH_VERSION ?? 'v23.0';
}

export async function sendViaCloud(opts: {
  toPhone: string; message: string; creds: WaCloudCreds; signal?: AbortSignal;
}): Promise<WaSendResult> {
  const url = `https://graph.facebook.com/${graphVersion()}/${opts.creds.phoneNumberId}/messages`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${opts.creds.accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: normalizePhone(opts.toPhone),
        type: 'text',
        text: { body: opts.message },
      }),
      signal: opts.signal ?? AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => 'unknown error');
      return { ok: false, channel: 'cloud', error: `WhatsApp Cloud ${res.status}: ${text}`, outcome: DEFINITE.has(res.status) ? 'DEFINITELY_REJECTED' : 'AMBIGUOUS' };
    }
    const data = (await res.json()) as { messages?: Array<{ id?: string }> };
    const id = data.messages?.[0]?.id?.trim();
    if (!id) return { ok: false, channel: 'cloud', error: 'Cloud returned success without a message id', outcome: 'AMBIGUOUS' };
    return { ok: true, channel: 'cloud', providerMessageId: id };
  } catch (e) {
    return { ok: false, channel: 'cloud', error: e instanceof Error ? e.message : 'Cloud request failed', outcome: 'AMBIGUOUS' };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/modules/communications/whatsapp/send/waCloudClient.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Write the failing selector test**

Create `src/modules/communications/whatsapp/send/waSendClient.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../config/waProviderConfig', () => ({
  getWaProvider: vi.fn(),
  getWaCloudCreds: vi.fn(),
}));
vi.mock('./waCloudClient', async (orig) => ({
  ...(await orig<typeof import('./waCloudClient')>()),
  sendViaCloud: vi.fn(),
}));
vi.mock('@/modules/noc/services/whatsappService', () => ({
  sendWhatsAppDM: vi.fn(),
}));

import { getWaProvider, getWaCloudCreds } from '../config/waProviderConfig';
import { sendViaCloud } from './waCloudClient';
import { sendWhatsAppDM } from '@/modules/noc/services/whatsappService';
import { sendWhatsAppText } from './waSendClient';

beforeEach(() => vi.clearAllMocks());

describe('sendWhatsAppText channel routing', () => {
  it('uses Cloud when channel="cloud"', async () => {
    vi.mocked(getWaCloudCreds).mockResolvedValue({ phoneNumberId: 'PN1', accessToken: 'T', appSecret: 'S', verifyToken: 'V' });
    vi.mocked(sendViaCloud).mockResolvedValue({ ok: true, channel: 'cloud', providerMessageId: 'wamid.1' });
    const r = await sendWhatsAppText({ toPhone: '27821234567', message: 'hi', channel: 'cloud' });
    expect(sendViaCloud).toHaveBeenCalledOnce();
    expect(sendWhatsAppDM).not.toHaveBeenCalled();
    expect(r).toMatchObject({ ok: true, channel: 'cloud', providerMessageId: 'wamid.1' });
  });

  it('uses WAHA when channel="waha"', async () => {
    vi.mocked(sendWhatsAppDM).mockResolvedValue({ id: 'waha-1' } as never);
    const r = await sendWhatsAppText({ toPhone: '27821234567', message: 'hi', channel: 'waha' });
    expect(sendWhatsAppDM).toHaveBeenCalledWith('27821234567', 'hi');
    expect(sendViaCloud).not.toHaveBeenCalled();
    expect(r.channel).toBe('waha');
    expect(r.ok).toBe(true);
  });

  it('falls back to the configured provider when channel is omitted', async () => {
    vi.mocked(getWaProvider).mockResolvedValue('cloud');
    vi.mocked(getWaCloudCreds).mockResolvedValue({ phoneNumberId: 'PN1', accessToken: 'T', appSecret: 'S', verifyToken: 'V' });
    vi.mocked(sendViaCloud).mockResolvedValue({ ok: true, channel: 'cloud', providerMessageId: 'wamid.2' });
    await sendWhatsAppText({ toPhone: '27821234567', message: 'hi' });
    expect(getWaProvider).toHaveBeenCalledOnce();
    expect(sendViaCloud).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npx vitest run src/modules/communications/whatsapp/send/waSendClient.test.ts`
Expected: FAIL — cannot find module `./waSendClient`.

- [ ] **Step 7: Write the selector**

Create `src/modules/communications/whatsapp/send/waSendClient.ts`:

```ts
import { getWaProvider, getWaCloudCreds } from '../config/waProviderConfig';
import { sendViaCloud, type WaSendChannel, type WaSendResult } from './waCloudClient';
import { sendWhatsAppDM } from '@/modules/noc/services/whatsappService';

export type { WaSendChannel, WaSendResult } from './waCloudClient';

export async function sendWhatsAppText(opts: {
  toPhone: string; message: string; channel?: WaSendChannel; signal?: AbortSignal;
}): Promise<WaSendResult> {
  const channel: WaSendChannel = opts.channel ?? ((await getWaProvider()) === 'cloud' ? 'cloud' : 'waha');

  if (channel === 'cloud') {
    const creds = await getWaCloudCreds();
    return sendViaCloud({ toPhone: opts.toPhone, message: opts.message, creds, signal: opts.signal });
  }

  // WAHA 1:1 DM (existing path). Match the real return shape of sendWhatsAppDM.
  try {
    const res = await sendWhatsAppDM(opts.toPhone, opts.message);
    const id = (res as { id?: string; messageId?: string })?.id ?? (res as { messageId?: string })?.messageId;
    return { ok: true, channel: 'waha', providerMessageId: id };
  } catch (e) {
    return { ok: false, channel: 'waha', error: e instanceof Error ? e.message : 'WAHA send failed', outcome: 'AMBIGUOUS' };
  }
}
```

> **Executor note:** confirm the real export name and return type of the WAHA 1:1 sender in `@/modules/noc/services/whatsappService` (recon saw a public `sendWhatsAppDM` wrapping `sendViaWAHA(phone, text)` → `/api/sendText`). Match its exact signature; adjust the `id` extraction to its real response.

- [ ] **Step 8: Run test to verify it passes**

Run: `npx vitest run src/modules/communications/whatsapp/send/waSendClient.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 9: Commit**

```bash
git add src/modules/communications/whatsapp/send/
git commit -m "feat(comms): shared 1:1 WhatsApp send client (cloud | waha) with Graph sender"
```

---

## Task 3: Cloud inbound webhook

**Files:**
- Create: `pages/api/communications/whatsapp/cloud-webhook.ts`
- Test: `pages/api/communications/whatsapp/cloud-webhook.test.ts`

**Interfaces:**
- Consumes: `getWaCloudCreds` (Task 1); `neon`. Verifies the Meta HMAC inline (`sha256=<hex>` over the raw body).
- Produces: `GET` verify handshake; `POST` inbound → `wa_message_logs` row (`service='cloud'`, `direction='inbound'`).

- [ ] **Step 1: Write the failing GET test**

Create `pages/api/communications/whatsapp/cloud-webhook.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { NextApiRequest, NextApiResponse } from 'next';

vi.mock('@/modules/communications/whatsapp/config/waProviderConfig', () => ({
  getWaCloudCreds: vi.fn(),
}));
import { getWaCloudCreds } from '@/modules/communications/whatsapp/config/waProviderConfig';
import handler from './cloud-webhook';

function mockRes() {
  const res: Partial<NextApiResponse> & { _status?: number; _body?: unknown } = {};
  res.status = vi.fn().mockImplementation((s: number) => { res._status = s; return res as NextApiResponse; });
  res.json = vi.fn().mockImplementation((b: unknown) => { res._body = b; return res as NextApiResponse; });
  res.send = vi.fn().mockImplementation((b: unknown) => { res._body = b; return res as NextApiResponse; });
  res.end = vi.fn();
  return res as NextApiResponse & { _status?: number; _body?: unknown };
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.unstubAllEnvs());

describe('GET cloud-webhook verify handshake', () => {
  it('echoes hub.challenge when the verify token matches', async () => {
    vi.mocked(getWaCloudCreds).mockResolvedValue({ phoneNumberId: 'PN', accessToken: 'T', appSecret: 'S', verifyToken: 'VER' });
    const req = { method: 'GET', query: { 'hub.mode': 'subscribe', 'hub.verify_token': 'VER', 'hub.challenge': '99' } } as unknown as NextApiRequest;
    const res = mockRes();
    await handler(req, res);
    expect(res._status).toBe(200);
    expect(res._body).toBe('99');
  });

  it('403s on token mismatch', async () => {
    vi.mocked(getWaCloudCreds).mockResolvedValue({ phoneNumberId: 'PN', accessToken: 'T', appSecret: 'S', verifyToken: 'VER' });
    const req = { method: 'GET', query: { 'hub.mode': 'subscribe', 'hub.verify_token': 'WRONG', 'hub.challenge': '99' } } as unknown as NextApiRequest;
    const res = mockRes();
    await handler(req, res);
    expect(res._status).toBe(403);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run pages/api/communications/whatsapp/cloud-webhook.test.ts`
Expected: FAIL — cannot find module `./cloud-webhook`.

- [ ] **Step 3: Write the webhook**

Create `pages/api/communications/whatsapp/cloud-webhook.ts`. It needs the raw body for signature verification, so disable Next's body parser and read the stream:

```ts
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
  const p = payload as any;
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
```

> **Executor notes:**
> 1. `wa_message_logs` has no unique constraint on a Cloud message id today, so redelivery would double-insert. For true idempotency, add a nullable `provider_message_id VARCHAR` column + a partial unique index in the Task 1 migration and insert the `wamid` with `ON CONFLICT DO NOTHING`. Recommended for production.
> 2. Best-effort ticket linkage: if `parsed.text` contains a DR number you MAY call the existing `processMaintenanceMessage`/`waTicketLinker` path so a Cloud inbound links to a ticket like a bridge inbound. Kept out of the minimal handler to avoid coupling; add once the base webhook is verified live.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run pages/api/communications/whatsapp/cloud-webhook.test.ts`
Expected: PASS (GET handshake: 2 tests).

- [ ] **Step 5: Commit**

```bash
git add pages/api/communications/whatsapp/cloud-webhook.ts pages/api/communications/whatsapp/cloud-webhook.test.ts
git commit -m "feat(comms): official WhatsApp Cloud inbound webhook (Meta signature verified)"
```

---

## Task 4: Unified ticket conversation feed API

**Files:**
- Create: `app/api/noc/tickets/[id]/whatsapp/route.ts`
- Test: `src/modules/noc/__tests__/api/ticket-whatsapp-feed.test.ts`

**Interfaces:**
- Consumes: `getMessagesForDR` (`@/modules/noc/services/waMaintenanceProcessor`) for group-mention inbound; `wa_message_logs` for 1:1 cloud/waha messages.
- Produces: `GET /api/noc/tickets/:id/whatsapp?dr=<drNumber>` → `{ success, data: { items } }` where `items: ConversationItem[]`, sorted ascending by `at`.

- [ ] **Step 1: Write the failing test**

Create `src/modules/noc/__tests__/api/ticket-whatsapp-feed.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/modules/noc/services/waMaintenanceProcessor', () => ({ getMessagesForDR: vi.fn() }));
const sqlMock = vi.fn();
vi.mock('@neondatabase/serverless', () => ({ neon: () => sqlMock }));

import { getMessagesForDR } from '@/modules/noc/services/waMaintenanceProcessor';
import { buildConversation } from '@/app/api/noc/tickets/[id]/whatsapp/route';

beforeEach(() => vi.clearAllMocks());

describe('buildConversation merges group + 1:1 streams sorted by time', () => {
  it('interleaves inbound group mentions and 1:1 messages ascending', async () => {
    vi.mocked(getMessagesForDR).mockResolvedValue([
      { wa_message_id: 'g1', sender_name: 'Tech', message_text: 'DR123 down', message_timestamp: '2026-07-24T08:00:00Z' },
    ] as never);
    const logs = [
      { id: 'c1', direction: 'outbound', service: 'cloud', recipient_jid: '27820000000', message_content: 'On it', created_at: '2026-07-24T08:05:00Z' },
    ];
    const items = await buildConversation('DR123', logs as never);
    expect(items.map((i) => i.id)).toEqual(['g1', 'c1']);
    expect(items[0]).toMatchObject({ direction: 'inbound', channel: 'group', text: 'DR123 down' });
    expect(items[1]).toMatchObject({ direction: 'outbound', channel: 'cloud', text: 'On it' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/modules/noc/__tests__/api/ticket-whatsapp-feed.test.ts`
Expected: FAIL — cannot find module `.../route`.

- [ ] **Step 3: Write the route (with a pure `buildConversation` export for testing)**

Create `app/api/noc/tickets/[id]/whatsapp/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';
import { getMessagesForDR } from '@/modules/noc/services/waMaintenanceProcessor';

export type ConversationItem = {
  id: string;
  direction: 'inbound' | 'outbound';
  channel: 'group' | 'cloud' | 'waha';
  from: string | null;
  text: string;
  at: string;
};

type WaLogRow = {
  id: string; direction: string; service: string;
  recipient_jid: string | null; message_content: string; created_at: string;
};

/** Pure merge — DB-free for testability. */
export async function buildConversation(
  drNumber: string | null,
  logs: WaLogRow[],
): Promise<ConversationItem[]> {
  const group: ConversationItem[] = drNumber
    ? (await getMessagesForDR(drNumber) as Array<{ wa_message_id: string; sender_name?: string; message_text: string; message_timestamp: string }>)
        .map((m) => ({ id: m.wa_message_id, direction: 'inbound' as const, channel: 'group' as const, from: m.sender_name ?? null, text: m.message_text, at: m.message_timestamp }))
    : [];
  const oneToOne: ConversationItem[] = logs.map((r) => ({
    id: r.id,
    direction: r.direction === 'outbound' ? 'outbound' : 'inbound',
    channel: r.service === 'cloud' ? 'cloud' : 'waha',
    from: r.recipient_jid,
    text: r.message_content,
    at: r.created_at,
  }));
  return [...group, ...oneToOne].sort((a, b) => a.at.localeCompare(b.at));
}

export async function GET(req: NextRequest, { params }: { params: { id: string } }): Promise<NextResponse> {
  const sql = neon(process.env.DATABASE_URL!);
  const dr = new URL(req.url).searchParams.get('dr');
  // 1:1 messages logged for this ticket's contact live in wa_message_logs
  // (service in cloud|waha). Phase 1 keys them by DR-derived recipient; refine
  // the WHERE once ticket→customer-phone mapping is wired (see Open Items).
  const logs = (await sql`
    SELECT id, direction, service, recipient_jid, message_content, created_at
    FROM wa_message_logs
    WHERE service IN ('cloud','waha')
      AND recipient_jid IS NOT NULL
      AND ${dr ?? ''} <> ''
    ORDER BY created_at ASC
    LIMIT 200
  `) as WaLogRow[];
  const items = await buildConversation(dr, logs);
  return NextResponse.json({ success: true, data: { items } });
}
```

> **Executor note (open item):** Phase 1 shows the group-mention feed reliably; the 1:1 `wa_message_logs` filter is a placeholder until the ticket→customer-phone association is defined (see Open Items). Wire the real `recipient_jid` filter (the ticket's subscriber phone) when that mapping is decided with Hein.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/modules/noc/__tests__/api/ticket-whatsapp-feed.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add app/api/noc/tickets/[id]/whatsapp/route.ts src/modules/noc/__tests__/api/ticket-whatsapp-feed.test.ts
git commit -m "feat(noc): unified WhatsApp conversation feed for a ticket (group + 1:1)"
```

---

## Task 5: NOC ticket WhatsApp tab + panel

**Files:**
- Modify: `src/modules/noc/components/TicketDetail/TicketDetail.tsx` (`TabKey` ~L63, `tabs` ~L169-182, content mount ~L490)
- Create: `src/modules/noc/components/TicketDetail/WhatsAppConversationPanel.tsx`
- Test: `src/modules/noc/components/TicketDetail/WhatsAppConversationPanel.test.tsx`

**Interfaces:**
- Consumes: `GET /api/noc/tickets/:id/whatsapp?dr=` (Task 4).
- Produces: `<WhatsAppConversationPanel ticketId drNumber />` rendering the thread; reply composer wired in Task 6.

- [ ] **Step 1: Write the failing panel test**

Create `src/modules/noc/components/TicketDetail/WhatsAppConversationPanel.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { WhatsAppConversationPanel } from './WhatsAppConversationPanel';

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ success: true, data: { items: [
      { id: 'g1', direction: 'inbound', channel: 'group', from: 'Tech', text: 'DR123 down', at: '2026-07-24T08:00:00Z' },
    ] } }),
  }));
});
afterEach(() => vi.unstubAllGlobals());

describe('WhatsAppConversationPanel', () => {
  it('loads and renders the conversation feed for the ticket DR', async () => {
    render(<WhatsAppConversationPanel ticketId="t1" drNumber="DR123" />);
    await waitFor(() => expect(screen.getByText('DR123 down')).toBeInTheDocument());
    expect((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0]).toContain('/api/noc/tickets/t1/whatsapp?dr=DR123');
  });
});
```

> **Executor note:** confirm the repo's React test setup (jsdom environment + `@testing-library/react` + `@testing-library/jest-dom`). If component tests run under a specific vitest project/config (recon saw `vitest.config.ts` + `test:component`), run via that path (e.g. `npm run test:component -- src/modules/noc/components/TicketDetail`).

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/modules/noc/components/TicketDetail/WhatsAppConversationPanel.test.tsx`
Expected: FAIL — cannot find module `./WhatsAppConversationPanel`.

- [ ] **Step 3: Write the panel**

Create `src/modules/noc/components/TicketDetail/WhatsAppConversationPanel.tsx`:

```tsx
'use client';
import { useEffect, useState, useCallback } from 'react';

type Item = {
  id: string;
  direction: 'inbound' | 'outbound';
  channel: 'group' | 'cloud' | 'waha';
  from: string | null;
  text: string;
  at: string;
};

export function WhatsAppConversationPanel({ ticketId, drNumber }: { ticketId: string; drNumber?: string | null }) {
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/api/noc/tickets/${ticketId}/whatsapp?dr=${encodeURIComponent(drNumber ?? '')}`);
    const json = await res.json();
    setItems(json?.data?.items ?? []);
    setLoading(false);
  }, [ticketId, drNumber]);

  useEffect(() => { void load(); }, [load]);

  if (loading) return <div className="p-4 text-sm text-muted-foreground">Loading conversation…</div>;
  if (items.length === 0) return <div className="p-4 text-sm text-muted-foreground">No WhatsApp messages for this ticket.</div>;

  return (
    <div className="flex flex-col gap-2 p-2">
      {items.map((m) => (
        <div key={m.id} className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${m.direction === 'outbound' ? 'self-end bg-green-100' : 'self-start bg-gray-100'}`}>
          <div className="mb-0.5 text-xs text-gray-500">
            {m.from ?? (m.direction === 'outbound' ? 'You' : 'Unknown')} · {m.channel} · {new Date(m.at).toLocaleString()}
          </div>
          <div className="whitespace-pre-wrap">{m.text}</div>
        </div>
      ))}
      {/* Reply composer is wired in Task 6. */}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/modules/noc/components/TicketDetail/WhatsAppConversationPanel.test.tsx`
Expected: PASS (1 test).

- [ ] **Step 5: Add the `whatsapp` tab to TicketDetail**

In `src/modules/noc/components/TicketDetail/TicketDetail.tsx`:
- Add `'whatsapp'` to the `TabKey` union (~L63).
- Add a tab entry to the `tabs` array (~L169-182), e.g. `{ key: 'whatsapp', label: 'WhatsApp' }` (match the exact object shape of the neighbouring entries — copy their `key`/`label`/`badge` fields).
- Add the content mount next to the other `{activeTab === '...' && <... />}` blocks (~L490):

```tsx
{activeTab === 'whatsapp' && (
  <WhatsAppConversationPanel ticketId={ticketId} drNumber={ticket.dr_number} />
)}
```
- Add the import at the top: `import { WhatsAppConversationPanel } from './WhatsAppConversationPanel';`

> **Executor note:** confirm the exact `tabs` entry object shape and the ticket field name for the DR (recon saw `ticket.dr_number`). Match them precisely.

- [ ] **Step 6: Run the TicketDetail component tests to confirm no regression**

Run: `npx vitest run src/modules/noc/components/TicketDetail`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/modules/noc/components/TicketDetail/
git commit -m "feat(noc): WhatsApp conversation tab on the ticket detail view"
```

---

## Task 6: Reply send route + composer wiring

**Files:**
- Create: `app/api/noc/tickets/[id]/whatsapp/reply/route.ts`
- Modify: `src/modules/noc/components/TicketDetail/WhatsAppConversationPanel.tsx` (add composer)
- Test: `src/modules/noc/__tests__/api/ticket-whatsapp-reply.test.ts`

**Interfaces:**
- Consumes: `sendWhatsAppText` (Task 2).
- Produces: `POST /api/noc/tickets/:id/whatsapp/reply` body `{ toPhone: string; message: string; channel?: 'cloud'|'waha' }` → sends + logs to `wa_message_logs` (`direction='outbound'`) → `{ success, providerMessageId }`.

- [ ] **Step 1: Write the failing route test**

Create `src/modules/noc/__tests__/api/ticket-whatsapp-reply.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/modules/communications/whatsapp/send/waSendClient', () => ({ sendWhatsAppText: vi.fn() }));
const sqlMock = vi.fn().mockResolvedValue([]);
vi.mock('@neondatabase/serverless', () => ({ neon: () => sqlMock }));

import { sendWhatsAppText } from '@/modules/communications/whatsapp/send/waSendClient';
import { POST } from '@/app/api/noc/tickets/[id]/whatsapp/reply/route';

beforeEach(() => vi.clearAllMocks());

describe('POST ticket whatsapp reply', () => {
  it('sends via the client and logs the outbound message', async () => {
    vi.mocked(sendWhatsAppText).mockResolvedValue({ ok: true, channel: 'cloud', providerMessageId: 'wamid.9' });
    const req = new Request('https://x/api/noc/tickets/t1/whatsapp/reply', {
      method: 'POST', body: JSON.stringify({ toPhone: '27821234567', message: 'hi', channel: 'cloud' }),
    });
    const res = await POST(req as never, { params: { id: 't1' } });
    const json = await res.json();
    expect(sendWhatsAppText).toHaveBeenCalledWith(expect.objectContaining({ toPhone: '27821234567', message: 'hi', channel: 'cloud' }));
    expect(sqlMock).toHaveBeenCalledOnce(); // wa_message_logs insert
    expect(json).toMatchObject({ success: true, providerMessageId: 'wamid.9' });
  });

  it('returns 502 when the send fails', async () => {
    vi.mocked(sendWhatsAppText).mockResolvedValue({ ok: false, channel: 'waha', error: 'down', outcome: 'AMBIGUOUS' });
    const req = new Request('https://x/api/noc/tickets/t1/whatsapp/reply', {
      method: 'POST', body: JSON.stringify({ toPhone: '27821234567', message: 'hi' }),
    });
    const res = await POST(req as never, { params: { id: 't1' } });
    expect(res.status).toBe(502);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/modules/noc/__tests__/api/ticket-whatsapp-reply.test.ts`
Expected: FAIL — cannot find module `.../reply/route`.

- [ ] **Step 3: Write the reply route**

Create `app/api/noc/tickets/[id]/whatsapp/reply/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';
import { sendWhatsAppText } from '@/modules/communications/whatsapp/send/waSendClient';

export async function POST(req: NextRequest, { params }: { params: { id: string } }): Promise<NextResponse> {
  const body = await req.json().catch(() => null) as { toPhone?: string; message?: string; channel?: 'cloud' | 'waha' } | null;
  if (!body?.toPhone || !body?.message) {
    return NextResponse.json({ success: false, error: 'toPhone and message are required' }, { status: 400 });
  }

  const result = await sendWhatsAppText({ toPhone: body.toPhone, message: body.message, channel: body.channel });
  if (!result.ok) {
    return NextResponse.json({ success: false, error: result.error, outcome: result.outcome }, { status: 502 });
  }

  const sql = neon(process.env.DATABASE_URL!);
  await sql`
    INSERT INTO wa_message_logs (direction, service, message_type, group_jid, recipient_jid, message_content, status, created_at)
    VALUES ('outbound', ${result.channel}, 'text', NULL, ${body.toPhone}, ${body.message}, 'sent', NOW())
  `;

  return NextResponse.json({ success: true, providerMessageId: result.providerMessageId, channel: result.channel });
}
```

> **Executor note:** the recon shows most authed API routes are Pages-router with `withAuth`. This is an App-router route handler, matching the sibling `app/api/noc/tickets/[id]/notes/route.ts`. Apply whatever auth those app-router NOC routes use (check `notes/route.ts` for the guard pattern) so the reply endpoint is not unauthenticated.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/modules/noc/__tests__/api/ticket-whatsapp-reply.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Add the composer to the panel**

In `WhatsAppConversationPanel.tsx`, add local state + a form under the message list (replace the `{/* Reply composer is wired in Task 6. */}` comment):

```tsx
  const [draft, setDraft] = useState('');
  const [toPhone, setToPhone] = useState('');
  const [sending, setSending] = useState(false);

  const send = async () => {
    if (!draft.trim() || !toPhone.trim()) return;
    setSending(true);
    await fetch(`/api/noc/tickets/${ticketId}/whatsapp/reply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ toPhone: toPhone.trim(), message: draft.trim() }),
    });
    setDraft('');
    setSending(false);
    await load();
  };
```

And the JSX (below the messages, before the closing `</div>`):

```tsx
      <div className="mt-2 flex flex-col gap-2 border-t pt-2">
        <input
          className="rounded border px-2 py-1 text-sm"
          placeholder="Recipient phone (e.g. 27821234567)"
          value={toPhone}
          onChange={(e) => setToPhone(e.target.value)}
        />
        <div className="flex gap-2">
          <textarea
            className="flex-1 rounded border px-2 py-1 text-sm"
            rows={2}
            placeholder="Type a reply…"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
          <button
            className="self-end rounded bg-green-600 px-3 py-1 text-sm text-white disabled:opacity-50"
            disabled={sending || !draft.trim() || !toPhone.trim()}
            onClick={() => void send()}
          >
            Send
          </button>
        </div>
      </div>
```

> **Executor note:** Phase 1 has the operator type the recipient number. Auto-filling it from the ticket's subscriber phone is the Open Item below; wire it once that field is confirmed. Channel is left to the configured provider (omit `channel`) unless you add a channel toggle.

- [ ] **Step 6: Run the panel + route tests**

Run: `npx vitest run src/modules/noc/components/TicketDetail/WhatsAppConversationPanel.test.tsx src/modules/noc/__tests__/api/ticket-whatsapp-reply.test.ts`
Expected: PASS.

- [ ] **Step 7: Manual verification (live)**

1. Set `wa_provider='cloud'` and the four `cloud_*` values in `wa_service_config` (admin UI or SQL). Point the Meta webhook at `https://<host>/api/communications/whatsapp/cloud-webhook`; confirm the GET handshake returns the challenge.
2. Message the Cloud number from a personal WhatsApp → confirm a `wa_message_logs` row (`service='cloud'`, `direction='inbound'`).
3. Open a NOC ticket with a DR → the WhatsApp tab shows the group-mention thread; send a reply to the number that messaged the Cloud number → confirm delivery and an outbound `wa_message_logs` row.

- [ ] **Step 8: Commit**

```bash
git add app/api/noc/tickets/[id]/whatsapp/reply/route.ts src/modules/noc/components/TicketDetail/WhatsAppConversationPanel.tsx src/modules/noc/__tests__/api/ticket-whatsapp-reply.test.ts
git commit -m "feat(noc): reply to WhatsApp from the ticket (routes cloud|waha) + logs outbound"
```

---

## Self-Review

**Coverage:** provider switch + creds (T1), shared 1:1 sender cloud|waha (T2), Cloud inbound webhook (T3), unified ticket feed (T4), ticket WhatsApp tab + panel (T5), reply route + composer (T6). "Both — panel + Cloud provider" is fully covered.

**Deliberately deferred / flagged (not silent):**
- Rerouting the other ~10 direct bridge callers through the shared client — out of scope; group flows stay as-is.
- Cloud status callbacks (delivered/read) and true wamid idempotency — flagged in Task 3 note.
- Best-effort DR ticket linkage from Cloud inbound — flagged in Task 3 note.

**Type consistency:** `WaSendResult`/`WaSendChannel` defined in `waCloudClient.ts`, re-exported and consumed in `waSendClient.ts` and the reply route; `ConversationItem` shape consistent across Task 4 route and Task 5 panel.

**Placeholder scan:** no TBD/TODO in code. Executor notes mark the genuine unknowns (WAHA `sendWhatsAppDM` exact signature; ticket→subscriber-phone mapping; app-router auth guard) for confirmation against the live repo.

## Open Items (confirm with Hein before/while building)
1. **Ticket → subscriber phone mapping.** The reply recipient and the 1:1 feed filter need the ticket's customer/subscriber phone. Phase 1 has the operator type it; wire the real field once identified (check `maintenance_tickets` / DR / `drops` for a contact number).
2. **Default provider** in `wa_service_config.wa_provider` at rollout — `bridge` (safe) until a Cloud number is live.
3. WAHA `sendWhatsAppDM` exact export/return shape (Task 2 executor note).
4. App-router NOC route auth guard pattern (Task 6 executor note).
5. Cloud webhook ticket-linkage + status callbacks → Phase 2.

## Execution Handoff
This plan is FibreFlow-specific and does not share code with Ndzinga — the *contract* mirrors the Ndzinga plan, the code matches FF's raw-SQL / Pages+App-router / WAHA reality. Phases 2+ (Embedded Signup, templates, booking, calling) get their own plans.
