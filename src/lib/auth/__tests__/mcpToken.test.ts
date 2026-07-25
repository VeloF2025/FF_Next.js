import { beforeEach, describe, expect, it, vi } from 'vitest';

// vi.mock factories are hoisted above every top-level statement, so the spies they
// return must be created inside vi.hoisted — a plain `const fn = vi.fn()` above would
// still be in the temporal dead zone when the factory runs.
const { createSession, setSessionTokenHash, signToken } = vi.hoisted(() => ({
  createSession: vi.fn(),
  setSessionTokenHash: vi.fn(),
  signToken: vi.fn(),
}));

vi.mock('../session', () => ({ createSession, setSessionTokenHash }));
vi.mock('../jwt', () => ({ signToken }));

import { McpLifetimeCapError, MCP_LIFETIME_DAYS, mintFfMcpToken } from '../mcpToken';
import type { AuthUser } from '../types';

const asUser = (email: string): AuthUser =>
  ({
    id: 'u1',
    userId: 'u1',
    email,
    firstName: 'A',
    lastName: 'B',
    name: 'A B',
    role: 'viewer',
    permissions: [],
    isActive: true,
  }) as AuthUser;

describe('mintFfMcpToken', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.FF_OWNER_EMAILS = 'owner@x.co';
    createSession.mockResolvedValue({ id: 'sess-1', expiresAt: new Date('2026-10-23T00:00:00Z') });
    signToken.mockResolvedValue('signed.jwt.token');
  });

  it('creates an mcp session with the requested lifetime, signs, then binds the hash', async () => {
    const result = await mintFfMcpToken(asUser('lew@x.co'), '90d', { label: 'Claude desktop' });

    expect(createSession).toHaveBeenCalledWith('u1', '', undefined, undefined, {
      kind: 'mcp',
      expiryDays: 90,
      label: 'Claude desktop',
    });
    expect(signToken).toHaveBeenCalledWith(expect.objectContaining({ id: 'u1' }), 'sess-1', '90d');
    expect(setSessionTokenHash).toHaveBeenCalledWith('sess-1', 'signed.jwt.token');
    expect(result.token).toBe('signed.jwt.token');
    expect(result.sessionId).toBe('sess-1');
  });

  it('orders the calls create -> sign -> bind', async () => {
    const order: string[] = [];
    createSession.mockImplementation(async () => {
      order.push('create');
      return { id: 'sess-1', expiresAt: new Date() };
    });
    signToken.mockImplementation(async () => {
      order.push('sign');
      return 'jwt';
    });
    setSessionTokenHash.mockImplementation(async () => {
      order.push('bind');
    });

    await mintFfMcpToken(asUser('lew@x.co'), '30d');
    expect(order).toEqual(['create', 'sign', 'bind']);
  });

  it('caps the owner at 90 days and creates nothing when rejected', async () => {
    await expect(mintFfMcpToken(asUser('owner@x.co'), '1y')).rejects.toBeInstanceOf(
      McpLifetimeCapError
    );
    expect(createSession).not.toHaveBeenCalled();
  });

  it('allows the owner 90d', async () => {
    await expect(mintFfMcpToken(asUser('owner@x.co'), '90d')).resolves.toBeDefined();
  });

  it('allows a non-owner 1y', async () => {
    await expect(mintFfMcpToken(asUser('lew@x.co'), '1y')).resolves.toBeDefined();
    expect(createSession).toHaveBeenCalledWith(
      'u1',
      '',
      undefined,
      undefined,
      expect.objectContaining({ expiryDays: MCP_LIFETIME_DAYS['1y'] })
    );
  });
});
