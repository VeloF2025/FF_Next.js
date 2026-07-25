import { neon } from '@neondatabase/serverless';

// Single source of truth. Re-exported from the types module rather than
// redeclared, so the server and the admin UI can never drift apart on what a
// provider is. The import direction matters: wa-admin.types has no runtime
// imports, so this stays type-only and never drags `neon` into a client bundle.
export type { WaProvider } from '../types/wa-admin.types';
import type { WaProvider } from '../types/wa-admin.types';

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
