/**
 * Whether the Cortex consent flow also hands Cortex an FF API credential — written
 * BEFORE the implementation.
 *
 * Cortex already authenticates its users THROUGH FibreFlow: /cortex/mcp/authorize runs
 * behind withAuth, and the consent endpoint mints a bridge token asserting that identity
 * to Cortex. What Cortex has never held is a credential to call FibreFlow BACK, so its
 * tools cannot read FF data as the person driving them.
 *
 * This grant closes that, and it is deliberately narrow:
 *
 *   - The lifetime is CLAMPED. Cortex offers 'never'; an FF credential that never
 *     expires must not exist, so 'never' maps to the longest BOUNDED FF lifetime.
 *     Revocation and `is_active` are the real controls, but an unbounded token removes
 *     the last backstop if both are somehow missed.
 *   - It is OFF unless explicitly enabled. This widens what a user is consenting to
 *     from "Cortex reads my meetings" to "Cortex reads anything in FibreFlow I can",
 *     so it ships dark and is turned on deliberately.
 *   - The consent screen must SAY so. An authorisation the user did not understand is
 *     not an authorisation, and this is the whole reason the grant is separable.
 */

import { describe, expect, it } from 'vitest';

import {
  ffGrantLifetime,
  ffApiGrantEnabled,
  ffGrantConsentScope,
} from '../ffApiGrant';

describe('ffGrantLifetime', () => {
  it('passes through the bounded lifetimes unchanged', () => {
    expect(ffGrantLifetime('30d')).toBe('30d');
    expect(ffGrantLifetime('90d')).toBe('90d');
    expect(ffGrantLifetime('1y')).toBe('1y');
  });

  it('CLAMPS never to the longest bounded lifetime', () => {
    // mintFfMcpToken has no unbounded option, and it should not gain one. Casting
    // 'never' through would either throw at mint time or, worse, be quietly added to
    // MCP_LIFETIME_DAYS later as a null.
    expect(ffGrantLifetime('never')).toBe('1y');
  });

  it('never returns a value mintFfMcpToken cannot accept', () => {
    // The mirror: pins the OUTPUT set rather than each mapping, so a new Cortex
    // lifetime cannot introduce a value the minter rejects at runtime.
    for (const lifetime of ['30d', '90d', '1y', 'never'] as const) {
      expect(['30d', '90d', '1y']).toContain(ffGrantLifetime(lifetime));
    }
  });
});

describe('ffApiGrantEnabled', () => {
  it('is OFF when the flag is absent', () => {
    expect(ffApiGrantEnabled({})).toBe(false);
  });

  it('is OFF for anything that is not exactly true', () => {
    // Fails closed on the values people actually typo. A grant this wide must not
    // switch on because someone wrote `1` or `yes`.
    // Note 'TRUE ' is absent deliberately — surrounding whitespace is tolerated and
    // asserted ON below. Listing it here too was a contradiction in the first draft.
    for (const value of ['', '1', 'yes', 'false', '0', 'no', 'truthy', undefined]) {
      expect(ffApiGrantEnabled({ CORTEX_FF_API_ENABLED: value })).toBe(false);
    }
  });

  it('is ON for exactly true, case-insensitively, ignoring surrounding space', () => {
    // The mirror: without this, a function returning false always would pass every
    // assertion above.
    expect(ffApiGrantEnabled({ CORTEX_FF_API_ENABLED: 'true' })).toBe(true);
    expect(ffApiGrantEnabled({ CORTEX_FF_API_ENABLED: 'TRUE' })).toBe(true);
    expect(ffApiGrantEnabled({ CORTEX_FF_API_ENABLED: '  true  ' })).toBe(true);
  });
});

describe('ffGrantConsentScope', () => {
  it('names the wider grant in the user-facing scope list', () => {
    const scope = ffGrantConsentScope();
    expect(scope).toMatch(/fibreflow/i);
    // It must convey BREADTH — "read your meetings" would understate it.
    expect(scope).toMatch(/read/i);
  });

  it('says the access is read-only and bounded by the user own permissions', () => {
    const scope = ffGrantConsentScope().toLowerCase();
    expect(scope).toContain('read-only');
    // The single most important fact for the user: it is not an escalation.
    expect(scope).toMatch(/you (can|already)/);
  });
});
