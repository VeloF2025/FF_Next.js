export interface CortexMcpConsentContext {
  clientId: string;
  clientName: string | null;
  redirectUri: string;
  scopes: string[];
}

export function parseCortexMcpConsentContext(
  value: unknown,
): CortexMcpConsentContext | null {
  if (!value || typeof value !== 'object') return null;

  const raw = value as Record<string, unknown>;
  const clientId = raw.client_id;
  const clientName = raw.client_name;
  const redirectUri = raw.redirect_uri;
  const scopes = raw.scopes;
  if (
    typeof clientId !== 'string'
    || !clientId.trim()
    || (clientName !== null && typeof clientName !== 'string')
    || typeof redirectUri !== 'string'
    || !redirectUri.trim()
    || !Array.isArray(scopes)
    || !scopes.every((scope): scope is string => typeof scope === 'string')
  ) {
    return null;
  }

  return {
    clientId,
    clientName,
    redirectUri,
    scopes,
  };
}
