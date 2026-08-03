const GHL_BASE_URL = 'https://services.leadconnectorhq.com';
const GHL_API_VERSION = '2021-07-28';
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_ERROR_TEXT_LENGTH = 160;

// Measured against the live Velocity location on 2026-08-03:
//   x-ratelimit-max: 25   x-ratelimit-interval-milliseconds: 10000
//   x-ratelimit-limit-daily: 10000
// i.e. 25 requests / 10s (2.5/sec), not the far higher ceiling the 4-way export
// concurrency was written against. Start below the observed burst ceiling and leave
// headroom for anything else using the same token; observeLimits() re-reads the real
// numbers from every response, so this is only the value used before the first reply.
const DEFAULT_RATE_LIMIT_MAX = 20;
const DEFAULT_RATE_LIMIT_WINDOW_MS = 10_000;
// A 429 means the request was rejected, never executed, so replaying it cannot
// duplicate a mutation. Retry in place rather than failing the export out to a later
// run — a deferred export holds its phone's in-flight slot and blocks other DRs.
const MAX_RATE_LIMIT_RETRIES = 4;
const RATE_LIMIT_FALLBACK_WAIT_MS = 2_000;

const defaultSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function positiveInt(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Number(value.trim());
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

/**
 * Sliding-window limiter shared by every request from one client instance.
 *
 * Acquisition is serialised through a promise chain so that concurrent exports queue
 * for tokens instead of all observing "window has space" at the same instant.
 */
export class GhlRateLimiter {
  private hits: number[] = [];
  private chain: Promise<void> = Promise.resolve();

  constructor(
    private max: number = DEFAULT_RATE_LIMIT_MAX,
    private windowMs: number = DEFAULT_RATE_LIMIT_WINDOW_MS,
    private readonly now: () => number = () => Date.now(),
    private readonly sleep: (ms: number) => Promise<void> = defaultSleep,
  ) {}

  /** Re-read the authoritative ceiling from a live response. */
  observeLimits(headers: Pick<Headers, 'get'>): void {
    const max = positiveInt(headers.get('x-ratelimit-max'));
    const windowMs = positiveInt(headers.get('x-ratelimit-interval-milliseconds'));
    // Stay a token under the advertised ceiling: the window is server-side and its
    // boundary does not line up with ours, so spending the last token invites a 429.
    if (max !== null) this.max = Math.max(1, max - 1);
    if (windowMs !== null) this.windowMs = windowMs;
  }

  async acquire(): Promise<void> {
    const next = this.chain.then(() => this.reserve());
    this.chain = next.then(() => undefined, () => undefined);
    return next;
  }

  private async reserve(): Promise<void> {
    for (;;) {
      const at = this.now();
      this.hits = this.hits.filter((hit) => at - hit < this.windowMs);
      if (this.hits.length < this.max) {
        this.hits.push(at);
        return;
      }
      const oldest = this.hits[0] ?? at;
      await this.sleep(Math.max(1, this.windowMs - (at - oldest) + 1));
    }
  }

  /** Drop recorded hits so a post-429 backoff is not double-counted. */
  reset(): void {
    this.hits = [];
  }
}

type Environment = Record<string, string | undefined>;
type RequestKind = 'read' | 'upsert' | 'tag-add' | 'tag-remove';

export interface VelocityReviewGhlConfig {
  privateIntegrationToken: string;
  locationId: string;
  fieldDrNumberId: string;
  fieldEventDateId: string;
  fieldSourcesId: string;
  fieldExportKeyId: string;
  phoneHmacSecret: string;
  summaryTo: string;
}

export interface VelocityReviewContactInput {
  phoneE164: string;
  firstName: string;
  lastName: string | null;
  drNumber: string;
  eventDate: string;
  sources: readonly string[];
  exportKey: string;
}

export interface HighLevelContact {
  id: string;
  phone: string | null;
  firstName?: string | null;
  lastName?: string | null;
  tags: string[];
  customFields: Record<string, string>;
  whatsappDndBlocked: boolean;
}

export class HighLevelRequestError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly retryable: boolean,
    readonly ambiguousMutation: boolean,
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = 'HighLevelRequestError';
  }
}

const REQUIRED_ENVIRONMENT = [
  'VELOCITY_GHL_PRIVATE_INTEGRATION_TOKEN',
  'VELOCITY_GHL_LOCATION_ID',
  'VELOCITY_GHL_FIELD_DR_NUMBER_ID',
  'VELOCITY_GHL_FIELD_EVENT_DATE_ID',
  'VELOCITY_GHL_FIELD_SOURCES_ID',
  'VELOCITY_GHL_FIELD_EXPORT_KEY_ID',
  'VELOCITY_REVIEW_PHONE_HMAC_SECRET',
  'VELOCITY_REVIEW_SUMMARY_TO',
] as const;

export function loadVelocityReviewGhlConfig(env: Environment): VelocityReviewGhlConfig {
  const values = Object.fromEntries(
    REQUIRED_ENVIRONMENT.map((key) => [key, env[key]?.trim() ?? '']),
  ) as Record<typeof REQUIRED_ENVIRONMENT[number], string>;
  const missing = REQUIRED_ENVIRONMENT.filter((key) => !values[key]);
  if (missing.length > 0) {
    throw new Error(`Velocity review GHL configuration missing: ${missing.join(', ')}`);
  }
  return {
    privateIntegrationToken: values.VELOCITY_GHL_PRIVATE_INTEGRATION_TOKEN,
    locationId: values.VELOCITY_GHL_LOCATION_ID,
    fieldDrNumberId: values.VELOCITY_GHL_FIELD_DR_NUMBER_ID,
    fieldEventDateId: values.VELOCITY_GHL_FIELD_EVENT_DATE_ID,
    fieldSourcesId: values.VELOCITY_GHL_FIELD_SOURCES_ID,
    fieldExportKeyId: values.VELOCITY_GHL_FIELD_EXPORT_KEY_ID,
    phoneHmacSecret: values.VELOCITY_REVIEW_PHONE_HMAC_SECRET,
    summaryTo: values.VELOCITY_REVIEW_SUMMARY_TO,
  };
}

function retryAfterSeconds(response: Response): number | undefined {
  const value = response.headers.get('Retry-After')?.trim();
  return value && /^(0|[1-9]\d*)$/.test(value) ? Number(value) : undefined;
}

function isWhatsappDndBlocked(contact: Record<string, unknown>): boolean {
  if (contact.dnd === true) return true;
  const dndSettings = contact.dndSettings;
  if (!dndSettings || typeof dndSettings !== 'object') return false;
  const whatsapp = (dndSettings as Record<string, unknown>).WhatsApp;
  if (!whatsapp || typeof whatsapp !== 'object') return false;
  const status = (whatsapp as Record<string, unknown>).status;
  return status === 'active' || status === 'permanent';
}

// Narrow: only an object carrying an explicit null/absent `contact` counts as "no
// duplicate". Anything else (a malformed body, a contact without an id) still reaches
// contactFrom and throws, so genuine protocol errors are not silently swallowed here.
function isAbsentDuplicate(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  if (!('contact' in value)) return false;
  return (value as Record<string, unknown>).contact == null;
}

function contactFrom(value: unknown): HighLevelContact {
  const contact = value && typeof value === 'object' && 'contact' in value
    ? (value as Record<string, unknown>).contact
    : value;
  if (!contact || typeof contact !== 'object' || typeof (contact as Record<string, unknown>).id !== 'string') {
    throw new HighLevelRequestError('HighLevel returned an invalid contact response', null, false, false);
  }
  const record = contact as Record<string, unknown>;
  const customFields = Array.isArray(record.customFields)
    ? Object.fromEntries(record.customFields.flatMap((field) => {
      if (!field || typeof field !== 'object') return [];
      const item = field as Record<string, unknown>;
      return typeof item.id === 'string' && typeof item.value === 'string' ? [[item.id, item.value]] : [];
    }))
    : {};
  return {
    id: record.id as string,
    phone: typeof record.phone === 'string' ? record.phone : null,
    firstName: typeof record.firstName === 'string' ? record.firstName : null,
    lastName: typeof record.lastName === 'string' ? record.lastName : null,
    tags: Array.isArray(record.tags) ? record.tags.filter((tag): tag is string => typeof tag === 'string') : [],
    customFields,
    whatsappDndBlocked: isWhatsappDndBlocked(record),
  };
}

function safeErrorText(raw: string, token: string): string {
  let text = raw.slice(0, MAX_ERROR_TEXT_LENGTH);
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const message = parsed.message ?? parsed.error;
    text = Array.isArray(message) ? message.join(', ') : String(message ?? text);
  } catch {
    // A non-JSON error body is bounded below and never required for correctness.
  }
  return text.slice(0, MAX_ERROR_TEXT_LENGTH)
    .replaceAll(token, '[redacted]')
    .replace(/\+?\d[\d\s().-]{7,}\d/g, '[redacted]');
}

export class HighLevelClient {
  constructor(
    private readonly config: VelocityReviewGhlConfig,
    // One limiter per client instance. defaultDependencies() builds a single client per
    // run, so all MAX_CONCURRENT_EXPORTS workers share this window.
    private readonly limiter: GhlRateLimiter = new GhlRateLimiter(),
    private readonly sleep: (ms: number) => Promise<void> = defaultSleep,
  ) {}

  async upsertContact(input: VelocityReviewContactInput): Promise<HighLevelContact> {
    const existing = await this.findContactByPhone(input.phoneE164);
    const nameFields = {
      ...(!existing?.firstName?.trim() ? { firstName: input.firstName } : {}),
      ...(!existing?.lastName?.trim() && input.lastName?.trim()
        ? { lastName: input.lastName.trim() }
        : {}),
    };
    const response = await this.request('/contacts/upsert', 'POST', {
      locationId: this.config.locationId,
      phone: input.phoneE164,
      ...nameFields,
      source: 'Velocity Fibre review export',
      createNewIfDuplicateAllowed: false,
      customFields: [
        { id: this.config.fieldDrNumberId, fieldValue: input.drNumber },
        { id: this.config.fieldEventDateId, fieldValue: input.eventDate },
        { id: this.config.fieldSourcesId, fieldValue: input.sources.join(',') },
        { id: this.config.fieldExportKeyId, fieldValue: input.exportKey },
      ],
    }, 'upsert');
    return contactFrom(response);
  }

  private async findContactByPhone(phoneE164: string): Promise<HighLevelContact | null> {
    const params = new URLSearchParams({ locationId: this.config.locationId, number: phoneE164 });
    try {
      const response = await this.request(
        `/contacts/search/duplicate?${params.toString()}`,
        'GET',
        undefined,
        'read',
      );
      // "No duplicate" is HTTP 200 with an explicit {"contact": null} body, NOT a 404.
      // Passing that to contactFrom() throws a non-retryable error, which failRequest
      // turns into permanent_failure — and the permanent UNIQUE (dr_number, phone_e164)
      // then bars the pair from ever being exported again. Because this fires for every
      // contact that does not already exist in GHL, it barred every genuinely new
      // customer on first contact. Verified live 2026-08-03: GET /contacts/search/duplicate
      // for an unknown number returns 200 {"contact":null}.
      if (isAbsentDuplicate(response)) return null;
      return contactFrom(response);
    } catch (error) {
      if (error instanceof HighLevelRequestError && error.status === 404) return null;
      throw error;
    }
  }

  async getContact(contactId: string): Promise<HighLevelContact> {
    return contactFrom(await this.request(`/contacts/${encodeURIComponent(contactId)}`, 'GET', undefined, 'read'));
  }

  async addTags(contactId: string, tags: readonly string[]): Promise<void> {
    await this.request(`/contacts/${encodeURIComponent(contactId)}/tags`, 'POST', { tags }, 'tag-add');
  }

  async removeTags(contactId: string, tags: readonly string[]): Promise<void> {
    await this.request(`/contacts/${encodeURIComponent(contactId)}/tags`, 'DELETE', { tags }, 'tag-remove');
  }

  private async request(path: string, method: 'GET' | 'POST' | 'DELETE', body: unknown, kind: RequestKind): Promise<unknown> {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await this.sendOnce(path, method, body, kind);
      } catch (error) {
        // Only a 429 is replayed here. It is the one status the API guarantees was
        // rejected without being executed, so replaying cannot duplicate a tag write.
        const rateLimited = error instanceof HighLevelRequestError && error.status === 429;
        if (!rateLimited || attempt >= MAX_RATE_LIMIT_RETRIES) throw error;
        const waitMs = (error as HighLevelRequestError).retryAfterSeconds !== undefined
          ? (error as HighLevelRequestError).retryAfterSeconds! * 1_000
          : RATE_LIMIT_FALLBACK_WAIT_MS * (attempt + 1);
        this.limiter.reset();
        await this.sleep(waitMs);
      }
    }
  }

  private async sendOnce(path: string, method: 'GET' | 'POST' | 'DELETE', body: unknown, kind: RequestKind): Promise<unknown> {
    await this.limiter.acquire();
    let response: Response;
    try {
      response = await fetch(`${GHL_BASE_URL}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.config.privateIntegrationToken}`,
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Version: GHL_API_VERSION,
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      const ambiguousMutation = kind === 'tag-add' || kind === 'tag-remove';
      const ambiguity = kind === 'tag-remove' ? 'HighLevel tag removal was not acknowledged'
        : 'HighLevel tag addition was not acknowledged';
      throw new HighLevelRequestError(
        ambiguousMutation ? ambiguity : 'HighLevel request failed before a response',
        null,
        !ambiguousMutation,
        ambiguousMutation,
      );
    }
    this.limiter.observeLimits(response.headers);
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      const retryable = response.status === 429 || response.status >= 500;
      const detail = safeErrorText(text, this.config.privateIntegrationToken);
      throw new HighLevelRequestError(
        `HighLevel request failed (status ${response.status})${detail ? `: ${detail}` : ''}`,
        response.status,
        retryable,
        false,
        response.status === 429 ? retryAfterSeconds(response) : undefined,
      );
    }
    if (response.status === 204) return undefined;
    return response.json().catch(() => {
      // Some successful tag responses have no JSON body; callers do not consume it.
      return {};
    });
  }
}
