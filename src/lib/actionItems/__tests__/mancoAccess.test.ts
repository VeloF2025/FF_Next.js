import { afterEach, describe, expect, it, vi } from 'vitest';

import { actionForMethod, checkMancoAccess, MANCO_PERMISSION } from '../mancoAccess';

vi.mock('@/lib/permissions', () => ({
  userHasPermission: vi.fn(),
}));

const { userHasPermission } = await import('@/lib/permissions');
const mocked = vi.mocked(userHasPermission);

afterEach(() => vi.resetAllMocks());

describe('actionForMethod', () => {
  it('maps reads to view', () => {
    expect(actionForMethod('GET')).toBe('view');
    expect(actionForMethod('HEAD')).toBe('view');
    expect(actionForMethod('get')).toBe('view');
  });

  it('maps a create to create and an update to edit', () => {
    expect(actionForMethod('POST')).toBe('create');
    expect(actionForMethod('PATCH')).toBe('edit');
    expect(actionForMethod('PUT')).toBe('edit');
  });

  it('maps DELETE to delete', () => {
    expect(actionForMethod('DELETE')).toBe('delete');
  });

  it.each([undefined, '', 'TRACE', 'PROPFIND', 'nonsense'])(
    'falls back to the STRICTEST action for %j, not to view',
    (method) => {
      // A method added later must fail closed rather than inherit read access. `delete`
      // is held by 16 of 84 active users, so an unrecognised verb reaches almost nobody.
      expect(actionForMethod(method)).toBe('delete');
    },
  );
});

describe('checkMancoAccess', () => {
  it('allows when the permission system says yes', async () => {
    mocked.mockResolvedValue(true);
    expect(await checkMancoAccess('u1', 'GET')).toEqual({ ok: true });
  });

  it('asks about the ACTION the method implies, on the right key', async () => {
    mocked.mockResolvedValue(true);
    await checkMancoAccess('u1', 'DELETE');
    expect(mocked).toHaveBeenCalledWith('u1', MANCO_PERMISSION, 'delete');

    await checkMancoAccess('u1', 'PATCH');
    expect(mocked).toHaveBeenLastCalledWith('u1', MANCO_PERMISSION, 'edit');
  });

  it('refuses with 403 and names the action when the answer is no', async () => {
    mocked.mockResolvedValue(false);
    const result = await checkMancoAccess('u1', 'PATCH');
    expect(result).toEqual({
      ok: false,
      status: 403,
      message: 'You do not have edit access to action items.',
    });
  });

  it('fails CLOSED when the check itself throws', async () => {
    // An access check that could not run has not passed. Returning 500 rather than
    // letting the rejection escape also matters: withAuth does not await the handler, so
    // an unhandled rejection is a bare 500 with nothing logged.
    mocked.mockRejectedValue(new Error('connection terminated'));
    const result = await checkMancoAccess('u1', 'GET');
    expect(result.ok).toBe(false);
    expect(result).toMatchObject({ status: 500 });
  });

  it('does not leak the database error to the caller', async () => {
    mocked.mockRejectedValue(new Error('password authentication failed for user "x"'));
    const result = await checkMancoAccess('u1', 'GET');
    expect(JSON.stringify(result)).not.toContain('password');
  });

  it('uses the key the sidebar already gates the page on', () => {
    // Inventing a new key would 403 everyone: isPermissionBlocked denies when no role row
    // exists, so a non-existent key is inert for super-admins and fatal for everyone else.
    expect(MANCO_PERMISSION).toBe('dashboard.action-items');
  });
});
