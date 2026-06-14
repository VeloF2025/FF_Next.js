// @vitest-environment node
//
// jose's signing primitives require the Node/WebCrypto build (see bridgeAuth.test.ts).
/**
 * Tests for mintMcpToken — the self-serve, long-lived (30-day) Cortex MCP bearer
 * token. It must mirror scripts/mint_user_token.py's claim shape EXACTLY (the bridge
 * verifies it) plus the token_use="mcp" revocation marker.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { decodeProtectedHeader, jwtVerify } from 'jose';
import { mintMcpToken } from '@/lib/cortex/bridgeAuth';

const SECRET = 'test-bridge-secret-value-0123456789';
const USER = 'bob@velocityfibre.co.za';

let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = {
    BRIDGE_JWT_SECRET: process.env.BRIDGE_JWT_SECRET,
    BRIDGE_JWT_KID: process.env.BRIDGE_JWT_KID,
    CORTEX_INSTANCE_ID: process.env.CORTEX_INSTANCE_ID,
  };
  delete process.env.BRIDGE_JWT_SECRET;
  delete process.env.BRIDGE_JWT_KID;
  delete process.env.CORTEX_INSTANCE_ID;
});

afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe('mintMcpToken — claim shape (mirrors scripts/mint_user_token.py)', () => {
  it('mints a verifiable HS256 token with sub, email, instance_id and token_use="mcp"', async () => {
    process.env.BRIDGE_JWT_SECRET = SECRET;
    const { token } = await mintMcpToken(USER);

    expect(decodeProtectedHeader(token).alg).toBe('HS256');
    const { payload } = await jwtVerify(token, new TextEncoder().encode(SECRET));
    expect(payload.sub).toBe(USER);
    expect(payload.email).toBe(USER);
    expect(payload.instance_id).toBe('velocity-fibre'); // default tenant
    expect(payload.token_use).toBe('mcp'); // the revocation marker the bridge keys on
    expect(typeof payload.iat).toBe('number');
    expect(typeof payload.exp).toBe('number');
  });

  it('is long-lived: exp is ~30 days after iat', async () => {
    process.env.BRIDGE_JWT_SECRET = SECRET;
    const { token } = await mintMcpToken(USER);
    const { payload } = await jwtVerify(token, new TextEncoder().encode(SECRET));
    const THIRTY_DAYS = 30 * 24 * 60 * 60;
    expect(payload.exp! - payload.iat!).toBe(THIRTY_DAYS);
  });

  it('returns expiresAt as the ISO form of the token\'s own exp', async () => {
    process.env.BRIDGE_JWT_SECRET = SECRET;
    const { token, expiresAt } = await mintMcpToken(USER);
    const { payload } = await jwtVerify(token, new TextEncoder().encode(SECRET));
    expect(expiresAt).toBe(new Date(payload.exp! * 1000).toISOString());
  });

  it('honours CORTEX_INSTANCE_ID override', async () => {
    process.env.BRIDGE_JWT_SECRET = SECRET;
    process.env.CORTEX_INSTANCE_ID = 'blitz-fibre';
    const { token } = await mintMcpToken(USER);
    const { payload } = await jwtVerify(token, new TextEncoder().encode(SECRET));
    expect(payload.instance_id).toBe('blitz-fibre');
  });

  it('stamps BRIDGE_JWT_KID into the protected header when set', async () => {
    process.env.BRIDGE_JWT_SECRET = SECRET;
    process.env.BRIDGE_JWT_KID = '20260611';
    const { token } = await mintMcpToken(USER);
    expect(decodeProtectedHeader(token)).toMatchObject({ alg: 'HS256', kid: '20260611' });
  });
});

describe('mintMcpToken — identity binding', () => {
  it('carries exactly the email it was minted for (never another user)', async () => {
    process.env.BRIDGE_JWT_SECRET = SECRET;
    const { token } = await mintMcpToken('carol@velocityfibre.co.za');
    const { payload } = await jwtVerify(token, new TextEncoder().encode(SECRET));
    expect(payload.email).toBe('carol@velocityfibre.co.za');
    expect(payload.email).not.toBe(USER);
  });

  it('a token does NOT verify under a different secret', async () => {
    process.env.BRIDGE_JWT_SECRET = SECRET;
    const { token } = await mintMcpToken(USER);
    await expect(
      jwtVerify(token, new TextEncoder().encode('a-different-secret')),
    ).rejects.toThrow();
  });
});

describe('mintMcpToken — fail loud (no silent downgrade)', () => {
  it('throws when BRIDGE_JWT_SECRET is unset (never returns an empty/api-key bearer)', async () => {
    await expect(mintMcpToken(USER)).rejects.toThrow(/BRIDGE_JWT_SECRET is not set/);
  });
});
