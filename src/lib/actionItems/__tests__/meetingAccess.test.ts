/**
 * Tests for the action-item visibility predicate.
 *
 * These deliberately do NOT assert only on substrings. A previous review defeated exactly
 * that style: changing `join(' AND ')` to `join(' OR ')` left every expected substring in
 * place while returning all 5,227 rows to a 716-row caller, and twelve tests stayed green.
 * The structural assertions below fail on that mutation.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

import {
  actionItemVisibility,
  resolveActionItemAccess,
  type ActionItemAccess,
} from '../meetingAccess';

const USER = {
  id: '11111111-1111-4111-8111-111111111111',
  email: 'Johan@VelocityFibre.co.za',
} as Parameters<typeof resolveActionItemAccess>[0];

function accessFor(overrides: Partial<ActionItemAccess> = {}): ActionItemAccess {
  return { isOwner: false, email: 'johan@velocityfibre.co.za', userId: USER!.id, ...overrides };
}

beforeEach(() => {
  vi.stubEnv('FF_OWNER_EMAILS', 'hein@velocityfibre.co.za');
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe('resolveActionItemAccess', () => {
  it('lower-cases the email so a mixed-case login still matches participants', () => {
    const resolved = resolveActionItemAccess(USER);
    expect('access' in resolved && resolved.access.email).toBe('johan@velocityfibre.co.za');
  });

  it('refuses a non-owner with no email rather than returning an empty list', () => {
    // Silently scoping to '' would render as "you have no action items", which is a
    // different and more misleading answer than "we cannot scope you".
    const resolved = resolveActionItemAccess({ ...USER!, email: '  ' });
    expect('error' in resolved).toBe(true);
  });

  it('recognises the owner from the allowlist', () => {
    const resolved = resolveActionItemAccess({ ...USER!, email: 'hein@velocityfibre.co.za' });
    expect('access' in resolved && resolved.access.isOwner).toBe(true);
  });

  it('does not treat an arbitrary super_admin-looking email as owner', () => {
    const resolved = resolveActionItemAccess({ ...USER!, email: 'admin@velocityfibre.co.za' });
    expect('access' in resolved && resolved.access.isOwner).toBe(false);
  });
});

describe('actionItemVisibility', () => {
  it('returns the literal TRUE for the owner, never an empty string', () => {
    // An empty string would force every call site to concatenate conditionally, and the
    // call site that forgets is the one that ships an ungated WHERE.
    const params: unknown[] = [];
    expect(actionItemVisibility(accessFor({ isOwner: true }), params)).toBe('TRUE');
    expect(params).toHaveLength(0);
  });

  it('binds the email rather than interpolating it', () => {
    const params: unknown[] = [];
    const clause = actionItemVisibility(accessFor(), params);
    expect(clause).not.toContain('johan@velocityfibre.co.za');
    expect(params).toContain('johan@velocityfibre.co.za');
  });

  it('numbers placeholders from the existing length so it composes with earlier params', () => {
    const params: unknown[] = ['already-here'];
    const clause = actionItemVisibility(accessFor(), params);
    expect(clause).toContain('$2');
    expect(clause).not.toContain('$1');
    expect(params[0]).toBe('already-here');
  });

  it('is a single parenthesised group so an enclosing AND cannot split it', () => {
    // Without the wrapper, `WHERE <a OR b OR c> AND status = 'x'` binds AND to the last
    // arm only — the filter would appear to work while the gate leaked two arms wide.
    const clause = actionItemVisibility(accessFor(), []);
    expect(clause.startsWith('(')).toBe(true);
    expect(clause.endsWith(')')).toBe(true);
  });

  it('covers exactly the three ways a row is yours, plus user-id assignment', () => {
    const clause = actionItemVisibility(accessFor(), []);
    expect(clause).toContain('meeting_id IS NULL');
    expect(clause).toContain('LOWER(ai.assignee_email)');
    expect(clause).toContain('jsonb_array_elements');
    expect(clause).toContain('assigned_to_user_id');
  });

  it('is OR-composed between its arms and contains no bare AND at the top level', () => {
    // The structural counterpart to the AND-composition test on the reporting query. Here
    // the arms are alternatives, so flipping OR to AND would silently return almost
    // nothing rather than too much — a quiet failure that looks like "no work assigned".
    const clause = actionItemVisibility(accessFor(), []);
    const depth = (s: string, i: number) =>
      s.slice(0, i).split('(').length - s.slice(0, i).split(')').length;
    const topLevelAnd = [...clause.matchAll(/\bAND\b/g)].filter((m) => depth(clause, m.index!) === 1);
    const topLevelOr = [...clause.matchAll(/\bOR\b/g)].filter((m) => depth(clause, m.index!) === 1);
    expect(topLevelOr.length).toBeGreaterThanOrEqual(3);
    expect(topLevelAnd).toHaveLength(0);
  });

  it('omits the user-id arm entirely when there is no user id', () => {
    // '' ::uuid throws; the arm must disappear rather than bind an empty string.
    const params: unknown[] = [];
    const clause = actionItemVisibility(accessFor({ userId: '' }), params);
    expect(clause).not.toContain('assigned_to_user_id');
    expect(params).toHaveLength(1);
  });

  it('guards the participant list against NULL so a meeting without one is unmatchable', () => {
    const clause = actionItemVisibility(accessFor(), []);
    expect(clause).toContain("COALESCE(m_acc.participants, '[]'::jsonb)");
  });

  it('uses an alias that cannot collide with a meetings join in the enclosing query', () => {
    // Both list routes already `LEFT JOIN meetings m`. A sub-select aliased `m` would
    // resolve to the outer row and match every item.
    const clause = actionItemVisibility(accessFor(), []);
    expect(clause).toContain('meetings m_acc');
    expect(clause).not.toMatch(/FROM meetings m\b(?!_acc)/);
  });

  it('applies to whatever alias the caller uses', () => {
    const clause = actionItemVisibility(accessFor(), [], 'a');
    expect(clause).toContain('a.meeting_id IS NULL');
    expect(clause).not.toContain('ai.meeting_id');
  });
});
