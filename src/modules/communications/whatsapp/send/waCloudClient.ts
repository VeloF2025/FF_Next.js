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
