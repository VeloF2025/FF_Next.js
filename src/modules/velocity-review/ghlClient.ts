const GHL_BASE_URL = 'https://services.leadconnectorhq.com';
const GHL_API_VERSION = '2021-07-28';
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_ERROR_TEXT_LENGTH = 160;

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
  constructor(private readonly config: VelocityReviewGhlConfig) {}

  async upsertContact(input: VelocityReviewContactInput): Promise<HighLevelContact> {
    const response = await this.request('/contacts/upsert', 'POST', {
      locationId: this.config.locationId,
      phone: input.phoneE164,
      firstName: input.firstName,
      lastName: input.lastName,
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
