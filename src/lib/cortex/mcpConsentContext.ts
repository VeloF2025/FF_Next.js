export interface CortexMcpConsentContext {
  clientId: string;
  clientName: string | null;
  redirectUri: string;
  scopes: string[];
}

const MAX_CLIENT_ID_LENGTH = 256;
const MAX_CLIENT_NAME_LENGTH = 256;
const MAX_REDIRECT_URI_LENGTH = 2_048;
const MAX_SCOPE_COUNT = 32;
const MAX_SCOPE_LENGTH = 128;

export function isCortexMcpConsentContext(
  value: unknown,
): value is CortexMcpConsentContext {
  if (!value || typeof value !== 'object') return false;
  const context = value as Record<string, unknown>;
  return (
    typeof context.clientId === 'string'
    && Boolean(context.clientId.trim())
    && context.clientId.length <= MAX_CLIENT_ID_LENGTH
    && (context.clientName === null || typeof context.clientName === 'string')
    && (
      typeof context.clientName !== 'string'
      || context.clientName.length <= MAX_CLIENT_NAME_LENGTH
    )
    && typeof context.redirectUri === 'string'
    && Boolean(context.redirectUri.trim())
    && context.redirectUri.length <= MAX_REDIRECT_URI_LENGTH
    && Array.isArray(context.scopes)
    && context.scopes.length <= MAX_SCOPE_COUNT
    && context.scopes.every((scope) => (
      typeof scope === 'string' && scope.length <= MAX_SCOPE_LENGTH
    ))
  );
}

export function parseCortexMcpConsentContext(
  value: unknown,
): CortexMcpConsentContext | null {
  if (!value || typeof value !== 'object') return null;

  const raw = value as Record<string, unknown>;
  const mapped = {
    clientId: raw.client_id,
    clientName: raw.client_name,
    redirectUri: raw.redirect_uri,
    scopes: raw.scopes,
  };
  return isCortexMcpConsentContext(mapped) ? mapped : null;
}
