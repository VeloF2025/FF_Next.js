import { getWaProvider, getWaCloudCreds } from '../config/waProviderConfig';
import { sendViaCloud, type WaSendChannel, type WaSendResult } from './waCloudClient';
import { sendWhatsAppDM } from '@/modules/notifications/services/whatsappDelivery';

export type { WaSendChannel, WaSendResult } from './waCloudClient';

export async function sendWhatsAppText(opts: {
  toPhone: string; message: string; channel?: WaSendChannel; signal?: AbortSignal;
}): Promise<WaSendResult> {
  const channel: WaSendChannel = opts.channel ?? ((await getWaProvider()) === 'cloud' ? 'cloud' : 'waha');

  if (channel === 'cloud') {
    // getWaCloudCreds throws WaCloudNotConfiguredError when creds are incomplete;
    // surface that as a controlled result rather than an unhandled 500 upstream.
    let creds;
    try {
      creds = await getWaCloudCreds();
    } catch (e) {
      return { ok: false, channel: 'cloud', error: e instanceof Error ? e.message : 'Cloud not configured', outcome: 'AMBIGUOUS' };
    }
    return sendViaCloud({ toPhone: opts.toPhone, message: opts.message, creds, signal: opts.signal });
  }

  // WAHA 1:1 DM via @/modules/notifications/services/whatsappDelivery.
  // Real signature is sendWhatsAppDM(phone, message): Promise<void> — it throws
  // on HTTP failure and returns no provider message id. So a clean resolve means
  // success (no providerMessageId); a throw means the send failed.
  try {
    await sendWhatsAppDM(opts.toPhone, opts.message);
    return { ok: true, channel: 'waha' };
  } catch (e) {
    return { ok: false, channel: 'waha', error: e instanceof Error ? e.message : 'WAHA send failed', outcome: 'AMBIGUOUS' };
  }
}
