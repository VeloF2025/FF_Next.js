// Which template keys are cleared for a business-initiated send.
//
// There is no approved-template registry in this database to check against.
// wa_message_templates (migration 094) predates WhatsApp Cloud: it stores local
// message bodies for the bridge era and carries only `enabled` / `is_default` /
// `category`. It has no Meta template name, no language, and no approval status,
// so an `enabled` row there says an operator wrote some text — not that Meta
// approved a template. Treating it as the registry would let anyone turn a row
// on and satisfy a compliance check that Meta would then reject at send time.
// waCloudClient cannot send a template message either; it posts type:'text'
// only. So the approved set is maintained explicitly here instead.
//
// The default is empty, which blocks every business-initiated send. That is the
// correct state today: no template has been submitted to Meta, and per #2276 a
// send that cannot name an approved template must refuse rather than fall back
// to free-form. Populating WA_APPROVED_TEMPLATE_KEYS is the deliberate act that
// turns sending on, and it belongs to the same Hein-gated go-live step as the
// cloud_* credentials.

const ENV_VAR = 'WA_APPROVED_TEMPLATE_KEYS';

/**
 * The approved keys, read from the environment on every call so that a config
 * change does not need a process restart to take effect, and so tests can stub
 * it. Comma-separated; blank entries are dropped.
 */
export function getApprovedTemplateKeys(): ReadonlySet<string> {
  const raw = process.env[ENV_VAR] ?? '';
  return new Set(
    raw
      .split(',')
      .map((key) => key.trim())
      .filter((key) => key.length > 0),
  );
}

/**
 * Whether a key names an approved template. A missing, blank or unlisted key is
 * not approved — absence is a block, never a pass.
 */
export function isApprovedTemplateKey(key: string | null | undefined): boolean {
  const trimmed = key?.trim();
  if (!trimmed) return false;
  return getApprovedTemplateKeys().has(trimmed);
}
