// @vitest-environment node
//
// jose's signing primitives require the Node/WebCrypto build; the project-default
// jsdom environment selects jose's browser build, which throws "payload must be an
// instance of Uint8Array" on SignJWT.sign. This is pure server-side crypto (no DOM),
// so the file runs under the node environment — matching the Next.js runtime that
// actually executes bridgeBearer. Scoped to this file; no global config change.
/**
 * Tests for the Cortex Bridge per-user JWT minting helper.
 *
 * TDD — written before the implementation. `bridgeBearer` returns the credential
 * FibreFlow sends to Cortex as `Authorization: Bearer <...>`:
 *   - BRIDGE_JWT_SECRET set  → a short-lived HS256 JWT {email, instance_id, exp}
 *     (the verified per-user identity Cortex narrows on).
 *   - BRIDGE_JWT_SECRET unset → falls back to CORTEX_API_KEY (today's behaviour →
 *     ships dark; per-user narrowing stays dormant until the secret is shared).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { decodeProtectedHeader, jwtVerify } from 'jose';
import { bridgeBearer } from '@/lib/cortex/bridgeAuth';

const SECRET = 'test-bridge-secret-value-0123456789';
const REVIEWER = 'bob@velocityfibre.co.za';

let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = {
    BRIDGE_JWT_SECRET: process.env.BRIDGE_JWT_SECRET,
    BRIDGE_JWT_KID: process.env.BRIDGE_JWT_KID,
    CORTEX_API_KEY: process.env.CORTEX_API_KEY,
    CORTEX_INSTANCE_ID: process.env.CORTEX_INSTANCE_ID,
    CORTEX_OIDC_FORWARD: process.env.CORTEX_OIDC_FORWARD,
  };
  delete process.env.BRIDGE_JWT_SECRET;
  delete process.env.BRIDGE_JWT_KID;
  delete process.env.CORTEX_API_KEY;
  delete process.env.CORTEX_INSTANCE_ID;
  delete process.env.CORTEX_OIDC_FORWARD;
});

afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe('bridgeBearer — dark fallback (no BRIDGE_JWT_SECRET)', () => {
  it('returns the API key verbatim when the secret is unset', async () => {
    process.env.CORTEX_API_KEY = 'ck_live_apikey';
    const bearer = await bridgeBearer(REVIEWER);
    expect(bearer).toBe('ck_live_apikey');
  });

  it('returns empty string when neither secret nor api key is set', async () => {
    const bearer = await bridgeBearer(REVIEWER);
    expect(bearer).toBe('');
  });
});

describe('bridgeBearer — per-user JWT (BRIDGE_JWT_SECRET set)', () => {
  it('mints a verifiable HS256 JWT carrying the reviewer email + instance_id', async () => {
    process.env.BRIDGE_JWT_SECRET = SECRET;
    process.env.CORTEX_API_KEY = 'ck_live_apikey';
    const bearer = await bridgeBearer(REVIEWER);

    // Not the API key — a freshly minted token instead.
    expect(bearer).not.toBe('ck_live_apikey');
    expect(decodeProtectedHeader(bearer).alg).toBe('HS256');

    const { payload } = await jwtVerify(bearer, new TextEncoder().encode(SECRET));
    expect(payload.email).toBe(REVIEWER);
    expect(payload.instance_id).toBe('velocity-fibre'); // default tenant
    expect(typeof payload.exp).toBe('number');
    expect(typeof payload.iat).toBe('number');
    expect(payload.exp! - payload.iat!).toBeLessThanOrEqual(600); // short-lived
    expect(payload.exp! - payload.iat!).toBeGreaterThan(0);
  });

  it('honours CORTEX_INSTANCE_ID override', async () => {
    process.env.BRIDGE_JWT_SECRET = SECRET;
    process.env.CORTEX_INSTANCE_ID = 'blitz-fibre';
    const bearer = await bridgeBearer(REVIEWER);
    const { payload } = await jwtVerify(bearer, new TextEncoder().encode(SECRET));
    expect(payload.instance_id).toBe('blitz-fibre');
  });

  it('a token minted for one reviewer carries that exact email', async () => {
    process.env.BRIDGE_JWT_SECRET = SECRET;
    const bearer = await bridgeBearer('carol@velocityfibre.co.za');
    const { payload } = await jwtVerify(bearer, new TextEncoder().encode(SECRET));
    expect(payload.email).toBe('carol@velocityfibre.co.za');
    expect(payload.email).not.toBe(REVIEWER);
  });

  it('a token minted with the secret does NOT verify under a different secret', async () => {
    process.env.BRIDGE_JWT_SECRET = SECRET;
    const bearer = await bridgeBearer(REVIEWER);
    await expect(
      jwtVerify(bearer, new TextEncoder().encode('a-different-secret')),
    ).rejects.toThrow();
  });
});

describe('bridgeBearer kid header (Cortex Phase 3 WP8 key rotation)', () => {
  it('stamps BRIDGE_JWT_KID into the protected header when set', async () => {
    process.env.BRIDGE_JWT_SECRET = SECRET;
    process.env.BRIDGE_JWT_KID = '20260611';
    const token = await bridgeBearer(REVIEWER);
    expect(decodeProtectedHeader(token)).toMatchObject({ alg: 'HS256', kid: '20260611' });
    const { payload } = await jwtVerify(token, new TextEncoder().encode(SECRET));
    expect(payload.email).toBe(REVIEWER);
  });

  it('omits kid when BRIDGE_JWT_KID is unset (legacy kid-less signing)', async () => {
    process.env.BRIDGE_JWT_SECRET = SECRET;
    const token = await bridgeBearer(REVIEWER);
    expect(decodeProtectedHeader(token).kid).toBeUndefined();
  });
});

describe('bridgeBearer — Entra ID-token forward (Phase 6 CORTEX_OIDC_FORWARD)', () => {
  const forward = { entraIdToken: 'eyJhbGciOiJSUzI1NiI.entra.idtoken' };

  it('forwards the Entra ID token verbatim when the flag is ON and a token is present', async () => {
    process.env.CORTEX_OIDC_FORWARD = 'true';
    process.env.BRIDGE_JWT_SECRET = SECRET; // present, but Entra takes precedence
    const bearer = await bridgeBearer(REVIEWER, forward);
    expect(bearer).toBe(forward.entraIdToken);
  });

  it('does NOT forward when the flag is OFF — falls back to the HS256 mint', async () => {
    delete process.env.CORTEX_OIDC_FORWARD;
    process.env.BRIDGE_JWT_SECRET = SECRET;
    const bearer = await bridgeBearer(REVIEWER, forward);
    expect(bearer).not.toBe(forward.entraIdToken);
    expect(decodeProtectedHeader(bearer).alg).toBe('HS256'); // minted HS256, not forwarded
  });

  it('flag ON but NO Entra token → falls back to the HS256 mint (no crash)', async () => {
    process.env.CORTEX_OIDC_FORWARD = 'true';
    process.env.BRIDGE_JWT_SECRET = SECRET;
    const bearer = await bridgeBearer(REVIEWER);
    const { payload } = await jwtVerify(bearer, new TextEncoder().encode(SECRET));
    expect(payload.email).toBe(REVIEWER);
  });

  it('flag ON, Entra token present, NO secret → still forwards Entra (not the api key)', async () => {
    process.env.CORTEX_OIDC_FORWARD = 'true';
    process.env.CORTEX_API_KEY = 'ck_live_apikey';
    const bearer = await bridgeBearer(REVIEWER, forward);
    expect(bearer).toBe(forward.entraIdToken);
    expect(bearer).not.toBe('ck_live_apikey');
  });

  it('empty/whitespace Entra token is ignored → HS256 fallback (never an empty bearer)', async () => {
    process.env.CORTEX_OIDC_FORWARD = 'true';
    process.env.BRIDGE_JWT_SECRET = SECRET;
    const bearer = await bridgeBearer(REVIEWER, { entraIdToken: '   ' });
    expect(decodeProtectedHeader(bearer).alg).toBe('HS256');
  });
});
