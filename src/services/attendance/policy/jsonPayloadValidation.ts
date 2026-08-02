export const MAX_JSON_PAYLOAD_BYTES = 1_048_576;

/**
 * Produces the exact JSON text sent to a JSONB column after enforcing the
 * repository-wide payload limit. Call before any transaction SQL so an
 * oversized value cannot partially mutate a day projection.
 */
export function serializeJsonPayload(value: unknown): string {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) {
    throw new Error('JSON payload must be serializable');
  }
  const bytes = Buffer.byteLength(serialized, 'utf8');
  if (bytes > MAX_JSON_PAYLOAD_BYTES) {
    throw new Error(`JSON payload exceeds ${MAX_JSON_PAYLOAD_BYTES} bytes`);
  }
  return serialized;
}
