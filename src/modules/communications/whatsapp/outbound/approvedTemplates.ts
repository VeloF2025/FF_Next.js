// The approved templates for business-initiated sends, and the copy each one sends.
//
// A template here is a DEFINITION, not just a permitted key. The body below is the
// message that goes out; the caller supplies neither the text nor the variables. An
// earlier version of this module held only an allowlist of key names while the route
// sent caller-supplied free text alongside a valid key — which proved a key had been
// named, not that approved content was sent. Meta approves *copy*, so a check that
// does not constrain the copy enforces nothing.
//
// Two independent gates, and a template needs both:
//
//   1. Defined here. Definitions are code, so changing what a subscriber receives goes
//      through review.
//   2. Listed in WA_APPROVED_TEMPLATE_KEYS. That records which of these Meta has
//      actually approved, which is a fact about Meta's console and not about our repo,
//      so it stays in configuration. Empty by default.
//
// Either alone is a block. Being defined here does not mean Meta approved it, and an
// env entry cannot conjure copy that does not exist.
//
// The bodies and variable sources below are transcribed from
// docs/whatsapp-cloud-golive-templates-and-consent.md section 3, which is what will be
// submitted to Meta. They must stay identical to that document: Meta rejects a send
// whose body does not match the approved template, so drift here surfaces as a runtime
// rejection, not as a diff.

const ENV_VAR = 'WA_APPROVED_TEMPLATE_KEYS';

/**
 * The ticket-derived values a template can interpolate. Every one is read from the
 * database server-side — nothing here can be supplied by the caller.
 */
export interface TemplateVariables {
  clientName: string | null;
  fno: string | null;
  address: string | null;
  drNumber: string | null;
  loggedAt: string | null;
  dueAt: string | null;
  resolvedAt: string | null;
}

export type TemplateVariableName = keyof TemplateVariables;

export interface ApprovedTemplate {
  key: string;
  /** Body copy with {{1}}..{{n}} placeholders, exactly as submitted to Meta. */
  body: string;
  /** Which variable fills {{1}}, {{2}}, ... in order. */
  variables: readonly TemplateVariableName[];
}

const TEMPLATES: readonly ApprovedTemplate[] = [
  {
    key: 'fault_logged_ack',
    body:
      'Hello {{1}}, this is Velocity Fibre. We have been appointed by {{2}} to attend to ' +
      'the fault reported at {{3}}.\n\n' +
      'Reference: {{4}}\n' +
      'Logged: {{5}}\n\n' +
      'We will update you here as the job progresses. Reply to this message if any of the ' +
      'details above are incorrect.',
    variables: ['clientName', 'fno', 'address', 'drNumber', 'loggedAt'],
  },
  {
    key: 'technician_scheduled',
    body:
      'Hello {{1}}, a Velocity Fibre technician is scheduled to attend {{2}} on {{3}}.\n\n' +
      'Reference: {{4}}\n\n' +
      'Someone aged 18 or older must be present to provide access. Reply here to confirm, ' +
      'or to arrange a different time.',
    variables: ['clientName', 'address', 'dueAt', 'drNumber'],
  },
  {
    key: 'fault_resolved',
    body:
      'Hello {{1}}, the fault at {{2}} has been resolved and the service tested.\n\n' +
      'Reference: {{3}}\n' +
      'Completed: {{4}}\n\n' +
      'If your service is still not working, reply here within 48 hours and we will ' +
      'reopen the job.',
    variables: ['clientName', 'address', 'drNumber', 'resolvedAt'],
  },
];

const TEMPLATES_BY_KEY: ReadonlyMap<string, ApprovedTemplate> = new Map(
  TEMPLATES.map((t) => [t.key, t]),
);

/**
 * Keys Meta has approved, read from the environment on every call so a config change
 * takes effect without a restart and tests can stub it. Comma-separated; blanks dropped.
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
 * The template for a key, or null when it is not sendable.
 *
 * Null covers three distinct cases deliberately collapsed into one: the key is absent
 * or blank, it names no definition, or it names a definition Meta has not approved.
 * None of them is permission to send, and the caller has nothing different to do about
 * any of them.
 */
export function getSendableTemplate(key: string | null | undefined): ApprovedTemplate | null {
  const trimmed = key?.trim();
  if (!trimmed) return null;
  if (!getApprovedTemplateKeys().has(trimmed)) return null;
  return TEMPLATES_BY_KEY.get(trimmed) ?? null;
}

export interface RenderedTemplate {
  key: string;
  message: string;
}

export type TemplateRenderResult =
  | { rendered: RenderedTemplate }
  | { rendered: null; missing: readonly TemplateVariableName[] };

/**
 * Fill a template's placeholders from ticket-derived values.
 *
 * A variable that is absent, null or blank is reported as missing and NOTHING is
 * rendered. There is deliberately no placeholder default and no partial render: a
 * message reading "the fault at  has been resolved" is worse than no message, and #2276
 * requires a blank variable to block rather than degrade.
 */
export function renderTemplate(
  template: ApprovedTemplate,
  variables: TemplateVariables,
): TemplateRenderResult {
  const missing = template.variables.filter((name) => {
    const value = variables[name];
    return typeof value !== 'string' || value.trim().length === 0;
  });
  if (missing.length > 0) return { rendered: null, missing };

  // Indexed rather than sequentially replaced so a value that itself contains
  // "{{2}}" — an address entered oddly, say — cannot be reinterpreted as a
  // placeholder by a later pass.
  const message = template.body.replace(/\{\{(\d+)\}\}/g, (whole, index: string) => {
    const name = template.variables[Number(index) - 1];
    if (!name) return whole;
    return (variables[name] as string).trim();
  });

  return { rendered: { key: template.key, message } };
}

/** Every placeholder in the body must have a variable, and vice versa. */
export function describeTemplateArityProblems(): string[] {
  const problems: string[] = [];
  for (const t of TEMPLATES) {
    const indexes = [...t.body.matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1]));
    const highest = indexes.length > 0 ? Math.max(...indexes) : 0;
    if (highest !== t.variables.length) {
      problems.push(
        `${t.key}: body references {{${highest}}} but declares ${t.variables.length} variables`,
      );
    }
    for (let i = 1; i <= t.variables.length; i += 1) {
      if (!indexes.includes(i)) problems.push(`${t.key}: no {{${i}}} placeholder in the body`);
    }
  }
  return problems;
}
