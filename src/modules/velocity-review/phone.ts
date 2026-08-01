import { createHmac } from 'node:crypto';
import { extractMsisdnFromContact } from '@/modules/communications/whatsapp/utils/phone';

const SA_MOBILE_MSISDN = /^27[6-8][0-9]{8}$/;

export function normalizeSaMobileMsisdn(raw: string | null | undefined): string | null {
  const msisdn = extractMsisdnFromContact(raw)
    ?? (raw ? extractMsisdnFromContact(`0${raw}`) : null);
  return msisdn && SA_MOBILE_MSISDN.test(msisdn) ? msisdn : null;
}

export function toE164(msisdn: string): string {
  if (!SA_MOBILE_MSISDN.test(msisdn)) throw new Error('invalid SA mobile MSISDN');
  return `+${msisdn}`;
}

export function fingerprintMsisdn(msisdn: string, secret: string): string {
  if (!secret) throw new Error('VELOCITY_REVIEW_PHONE_HMAC_SECRET is required');
  return createHmac('sha256', secret).update(msisdn).digest('hex');
}
