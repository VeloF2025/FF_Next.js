import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  GhlRateLimiter,
  HighLevelClient,
  HighLevelRequestError,
  loadVelocityReviewGhlConfig,
  type VelocityReviewGhlConfig,
} from '../ghlClient';

const noSleep = async (): Promise<void> => undefined;

const token = 'test-private-token';
const phone = '+27821234567';
const config: VelocityReviewGhlConfig = {
  privateIntegrationToken: token,
  locationId: 'location-id',
  fieldDrNumberId: 'field-dr',
  fieldEventDateId: 'field-event-date',
  fieldSourcesId: 'field-sources',
  fieldExportKeyId: 'field-export-key',
  phoneHmacSecret: 'test-hmac-secret',
  summaryTo: 'ops@example.test',
};

function response(body: unknown, status = 200, headers?: HeadersInit): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

function fetchOptions(index = 0): RequestInit {
  return vi.mocked(global.fetch).mock.calls[index]?.[1] as RequestInit;
}

describe('HighLevelClient', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('upserts only approved contact fields through the configured Contacts API', async () => {
    vi.mocked(global.fetch)
      .mockResolvedValueOnce(response({}, 404))
      .mockResolvedValueOnce(response({ contact: { id: 'contact-1' } }));
    const client = new HighLevelClient(config);

    await expect(client.upsertContact({
      phoneE164: phone,
      firstName: 'Ada',
      lastName: 'Lovelace',
      drNumber: 'DR-100',
      eventDate: '2026-07-31',
      sources: ['dr_submitted', 'oes_activated'],
      exportKey: 'export-key-1',
    })).resolves.toMatchObject({ id: 'contact-1' });

    expect(global.fetch).toHaveBeenNthCalledWith(
      2,
      'https://services.leadconnectorhq.com/contacts/upsert',
      expect.objectContaining({ method: 'POST', signal: expect.any(AbortSignal) }),
    );
    expect(fetchOptions(1).headers).toMatchObject({
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Version: '2021-07-28',
    });
    const body = JSON.parse(String(fetchOptions(1).body)) as Record<string, unknown>;
    expect(body).toMatchObject({
      locationId: 'location-id',
      phone,
      firstName: 'Ada',
      lastName: 'Lovelace',
      source: 'Velocity Fibre review export',
      createNewIfDuplicateAllowed: false,
      customFields: [
        { id: 'field-dr', fieldValue: 'DR-100' },
        { id: 'field-event-date', fieldValue: '2026-07-31' },
        { id: 'field-sources', fieldValue: 'dr_submitted,oes_activated' },
        { id: 'field-export-key', fieldValue: 'export-key-1' },
      ],
    });
    expect(body).not.toHaveProperty('tags');
    expect(body).not.toHaveProperty('dnd');
    expect(body).not.toHaveProperty('dndSettings');
  });

  it('preserves populated authoritative GHL names during upsert', async () => {
    vi.mocked(global.fetch)
      .mockResolvedValueOnce(response({ contact: {
        id: 'contact-1', firstName: 'Authoritative', lastName: 'Customer',
        tags: ['existing-tag'], dnd: true,
      } }))
      .mockResolvedValueOnce(response({ contact: { id: 'contact-1' } }));

    await new HighLevelClient(config).upsertContact({
      phoneE164: phone, firstName: 'Source', lastName: null, drNumber: 'DR-100',
      eventDate: '2026-07-31', sources: ['dr_submitted'], exportKey: 'export-key-1',
    });

    const body = JSON.parse(String(fetchOptions(1).body)) as Record<string, unknown>;
    expect(body).not.toHaveProperty('firstName');
    expect(body).not.toHaveProperty('lastName');
    expect(body).not.toHaveProperty('tags');
    expect(body).not.toHaveProperty('dnd');
    expect(body).not.toHaveProperty('dndSettings');
  });

  it('fills only missing GHL name fields from source data', async () => {
    vi.mocked(global.fetch)
      .mockResolvedValueOnce(response({ contact: {
        id: 'contact-1', firstName: ' ', lastName: 'Existing', tags: [], dnd: false,
      } }))
      .mockResolvedValueOnce(response({ contact: { id: 'contact-1' } }));

    await new HighLevelClient(config).upsertContact({
      phoneE164: phone, firstName: 'Source', lastName: 'Surname', drNumber: 'DR-100',
      eventDate: '2026-07-31', sources: ['dr_submitted'], exportKey: 'export-key-1',
    });

    expect(JSON.parse(String(fetchOptions(1).body))).toMatchObject({
      firstName: 'Source',
    });
    expect(JSON.parse(String(fetchOptions(1).body))).not.toHaveProperty('lastName');
  });

  it('reads contact DND safely and uses dedicated tag endpoints', async () => {
    vi.mocked(global.fetch)
      .mockResolvedValueOnce(response({ contact: {
        id: 'contact-1',
        phone,
        tags: ['velocity-review-enrolled'],
        dnd: false,
        dndSettings: { WhatsApp: { status: 'active' } },
        customFields: [{ id: 'field-export-key', value: 'export-key-1' }],
      } }))
      .mockResolvedValueOnce(response({}, 201))
      .mockResolvedValueOnce(response({}));
    const client = new HighLevelClient(config);

    await expect(client.getContact('contact-1')).resolves.toMatchObject({
      id: 'contact-1',
      whatsappDndBlocked: true,
      tags: ['velocity-review-enrolled'],
      customFields: { 'field-export-key': 'export-key-1' },
    });
    await client.addTags('contact-1', ['velocity-review-ready']);
    await client.removeTags('contact-1', ['velocity-review-enrolled']);

    expect(global.fetch).toHaveBeenNthCalledWith(
      1,
      'https://services.leadconnectorhq.com/contacts/contact-1',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(global.fetch).toHaveBeenNthCalledWith(
      2,
      'https://services.leadconnectorhq.com/contacts/contact-1/tags',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ tags: ['velocity-review-ready'] }) }),
    );
    expect(global.fetch).toHaveBeenNthCalledWith(
      3,
      'https://services.leadconnectorhq.com/contacts/contact-1/tags',
      expect.objectContaining({ method: 'DELETE', body: JSON.stringify({ tags: ['velocity-review-enrolled'] }) }),
    );
  });

  it.each([
    [429, true],
    [500, true],
    [400, false],
    [401, false],
    [422, false],
  ])('classifies HTTP %i correctly', async (status, retryable) => {
    vi.mocked(global.fetch).mockResolvedValue(response({ message: 'request rejected' }, status,
      status === 429 ? { 'Retry-After': '120' } : undefined));
    // A 429 is now replayed in place before it surfaces, so the backoff sleep must be
    // stubbed or this test waits out the real Retry-After.
    const client = new HighLevelClient(config, new GhlRateLimiter(50, 10_000, () => 0, noSleep), noSleep);

    const error = await client.getContact('contact-1').catch((caught: unknown) => caught);

    expect(error).toMatchObject<Partial<HighLevelRequestError>>({
      name: 'HighLevelRequestError', status, retryable, ambiguousMutation: false,
    });
    if (status === 429) {
      expect((error as HighLevelRequestError).retryAfterSeconds).toBe(120);
      // Initial attempt + MAX_RATE_LIMIT_RETRIES replays, then the error surfaces.
      expect(global.fetch).toHaveBeenCalledTimes(5);
    } else {
      expect(global.fetch).toHaveBeenCalledTimes(1);
    }
  });

  it('marks an unacknowledged tag addition as ambiguous without leaking secrets', async () => {
    vi.mocked(global.fetch).mockRejectedValue(new Error(`timeout for ${phone} using ${token}`));
    const client = new HighLevelClient(config);

    const error = await client.addTags('contact-1', ['velocity-review-ready'])
      .catch((caught: unknown) => caught);

    expect(error).toMatchObject<Partial<HighLevelRequestError>>({
      name: 'HighLevelRequestError', status: null, retryable: false, ambiguousMutation: true,
    });
    expect((error as Error).message).not.toContain(phone);
    expect((error as Error).message).not.toContain(token);
  });

  it('marks an unacknowledged acknowledgement-tag removal as ambiguous', async () => {
    vi.mocked(global.fetch).mockRejectedValue(new Error('timeout'));
    const error = await new HighLevelClient(config).removeTags(
      'contact-1', ['velocity-review-enrolled'],
    ).catch((caught: unknown) => caught);

    expect(error).toMatchObject<Partial<HighLevelRequestError>>({
      status: null, retryable: false, ambiguousMutation: true,
    });
    expect((error as Error).message).toContain('removal');
  });

  it('redacts phones and tokens returned by the API', async () => {
    vi.mocked(global.fetch).mockResolvedValue(response({
      message: `bad phone ${phone}; token ${token}`,
    }, 400));
    const client = new HighLevelClient(config);

    const error = await client.upsertContact({
      phoneE164: phone,
      firstName: 'Ada',
      lastName: null,
      drNumber: 'DR-100',
      eventDate: '2026-07-31',
      sources: ['dr_submitted'],
      exportKey: 'export-key-1',
    }).catch((caught: unknown) => caught);

    expect((error as Error).message).not.toContain(phone);
    expect((error as Error).message).not.toContain(token);
  });

  // Regression: the 2026-08-03 live run put 225 exports into permanent_failure. The
  // duplicate search answers "no duplicate" with HTTP 200 {"contact":null}, not 404, so
  // contactFrom() threw a non-retryable error for every contact that did not already
  // exist in GHL — i.e. every genuinely new customer — and the permanent
  // UNIQUE (dr_number, phone_e164) then barred the pair for good.
  it('treats a 200 {"contact":null} duplicate search as "no existing contact"', async () => {
    vi.mocked(global.fetch)
      .mockResolvedValueOnce(response({ contact: null }))
      .mockResolvedValueOnce(response({ contact: { id: 'contact-new' } }));
    const client = new HighLevelClient(config, new GhlRateLimiter(50, 10_000, () => 0, noSleep), noSleep);

    await expect(client.upsertContact({
      phoneE164: phone,
      firstName: 'Ada',
      lastName: null,
      drNumber: 'DR-200',
      eventDate: '2026-08-01',
      sources: ['dr_submitted'],
      exportKey: 'export-key-new',
    })).resolves.toMatchObject({ id: 'contact-new' });

    // The upsert must still have been attempted — the null search is not a failure.
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('still rejects a malformed contact body that is not an absent duplicate', async () => {
    vi.mocked(global.fetch).mockResolvedValue(response({ contact: { noId: true } }));
    const client = new HighLevelClient(config, new GhlRateLimiter(50, 10_000, () => 0, noSleep), noSleep);

    await expect(client.getContact('contact-1')).rejects.toThrow(/invalid contact response/);
  });
});

describe('loadVelocityReviewGhlConfig', () => {
  it('trims every required value', () => {
    const env = Object.fromEntries(Object.entries({
      VELOCITY_GHL_PRIVATE_INTEGRATION_TOKEN: token,
      VELOCITY_GHL_LOCATION_ID: 'location-id',
      VELOCITY_GHL_FIELD_DR_NUMBER_ID: 'field-dr',
      VELOCITY_GHL_FIELD_EVENT_DATE_ID: 'field-event-date',
      VELOCITY_GHL_FIELD_SOURCES_ID: 'field-sources',
      VELOCITY_GHL_FIELD_EXPORT_KEY_ID: 'field-export-key',
      VELOCITY_REVIEW_PHONE_HMAC_SECRET: 'test-hmac-secret',
      VELOCITY_REVIEW_SUMMARY_TO: 'ops@example.test',
    }).map(([key, value]) => [key, ` ${value} `]));

    expect(loadVelocityReviewGhlConfig(env)).toEqual(config);
  });

  it('lists only missing variable names without values', () => {
    const error = (() => {
      try {
        loadVelocityReviewGhlConfig({
          VELOCITY_GHL_PRIVATE_INTEGRATION_TOKEN: token,
          VELOCITY_GHL_LOCATION_ID: ' ',
        });
      } catch (caught) {
        return caught as Error;
      }
      throw new Error('expected a configuration error');
    })();

    expect(error.message).toContain('VELOCITY_GHL_LOCATION_ID');
    expect(error.message).toContain('VELOCITY_GHL_FIELD_DR_NUMBER_ID');
    expect(error.message).not.toContain(token);
  });
});

describe('GhlRateLimiter', () => {
  it('holds requests to the window ceiling instead of letting them burst', async () => {
    let now = 0;
    const slept: number[] = [];
    const limiter = new GhlRateLimiter(3, 10_000, () => now, async (ms) => {
      slept.push(ms);
      now += ms;
    });

    for (let i = 0; i < 4; i += 1) await limiter.acquire();

    // The first three fit the window; the fourth must wait for the window to roll.
    expect(slept).toEqual([10_001]);
  });

  it('adopts the ceiling advertised by the live response headers', async () => {
    let now = 0;
    const slept: number[] = [];
    const limiter = new GhlRateLimiter(50, 60_000, () => now, async (ms) => {
      slept.push(ms);
      now += ms;
    });

    // Measured live on the Velocity location: max 25 per 10s. One token of headroom is
    // kept back, so the limiter should admit 24 before pausing.
    limiter.observeLimits({ get: (name: string) => (
      name === 'x-ratelimit-max' ? '25'
        : name === 'x-ratelimit-interval-milliseconds' ? '10000'
          : null) } as Pick<Headers, 'get'>);

    for (let i = 0; i < 24; i += 1) await limiter.acquire();
    expect(slept).toEqual([]);

    await limiter.acquire();
    expect(slept).toEqual([10_001]);
  });
});
