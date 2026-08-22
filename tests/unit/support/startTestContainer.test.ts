/**
 * The DB harnesses publish on `127.0.0.1::5432` so Docker picks a free host
 * port. Under the rootless daemon on the CI runner, the port Docker chooses is
 * bound later by RootlessKit, and anything on the box can take it in between:
 *
 *   RootlessKit PortManager.AddPort(): listen tcp4 127.0.0.1:33682:
 *   bind: address already in use
 *
 * `docker run` then exits 125 and the suite dies in global setup before a
 * single test runs — twice on the runner on 2026-08-22, on PRs that touched
 * none of this. These tests drive the real retry helper and assert it re-rolls
 * on a collision, gives up on anything else, and surfaces the reason.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { startTestContainer } from '../../support/startTestContainer';

/**
 * Injected rather than mocked. `vi.mock('node:child_process')` was tried and
 * did NOT take — the suite ran real `docker run` and started actual postgres
 * containers on the machine. Injection cannot do that.
 */
const execFileSyncMock = vi.fn();

const PORT_COLLISION =
  'docker: Error response from daemon: failed to set up container networking: ' +
  'driver failed programming external connectivity on endpoint ff-db-tests-1: ' +
  'error while calling RootlessKit PortManager.AddPort(): ' +
  'listen tcp4 127.0.0.1:33682: bind: address already in use';

function dockerError(stderr: string): Error & { stderr: string } {
  return Object.assign(new Error('Command failed: docker run'), { stderr });
}

const RUN_ARGS = ['run', '--rm', '-d', '--name', 'ff-db-tests-1', 'postgres:15-alpine'];

beforeEach(() => execFileSyncMock.mockReset());
afterEach(() => vi.restoreAllMocks());

describe('startTestContainer', () => {
  it('re-rolls the port and succeeds when the first attempt collides', () => {
    execFileSyncMock
      .mockImplementationOnce(() => { throw dockerError(PORT_COLLISION); })
      .mockImplementationOnce(() => 'container-id-2\n');

    const cleanup = vi.fn();
    const id = startTestContainer('ff-db-tests-1', RUN_ARGS, cleanup, 4, execFileSyncMock);

    expect(id).toBe('container-id-2');
    expect(execFileSyncMock).toHaveBeenCalledTimes(2);
    // The failed container still holds its name; without removing it the retry
    // fails on the name rather than the port.
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it('survives repeated collisions up to the attempt limit', () => {
    execFileSyncMock
      .mockImplementationOnce(() => { throw dockerError(PORT_COLLISION); })
      .mockImplementationOnce(() => { throw dockerError(PORT_COLLISION); })
      .mockImplementationOnce(() => { throw dockerError(PORT_COLLISION); })
      .mockImplementationOnce(() => 'container-id-4\n');

    expect(startTestContainer('ff-db-tests-1', RUN_ARGS, vi.fn(), 4, execFileSyncMock)).toBe('container-id-4');
    expect(execFileSyncMock).toHaveBeenCalledTimes(4);
  });

  it('gives up after the last attempt and reports the docker stderr', () => {
    execFileSyncMock.mockImplementation(() => { throw dockerError(PORT_COLLISION); });

    expect(() => startTestContainer('ff-db-tests-1', RUN_ARGS, vi.fn(), 3, execFileSyncMock))
      .toThrow(/attempt 3\/3[\s\S]*address already in use/);
    expect(execFileSyncMock).toHaveBeenCalledTimes(3);
  });

  it('does NOT retry a failure that is not a port collision', () => {
    // Retrying a missing image or a dead daemon just multiplies the wait.
    execFileSyncMock.mockImplementation(() => {
      throw dockerError('docker: Error response from daemon: pull access denied for postgres:99');
    });

    expect(() => startTestContainer('ff-db-tests-1', RUN_ARGS, vi.fn(), 4, execFileSyncMock))
      .toThrow(/pull access denied/);
    expect(execFileSyncMock).toHaveBeenCalledTimes(1);
  });

  it('returns the container id on a first-attempt success without cleaning up', () => {
    execFileSyncMock.mockImplementationOnce(() => 'container-id-1\n');

    const cleanup = vi.fn();
    expect(startTestContainer('ff-db-tests-1', RUN_ARGS, cleanup, 4, execFileSyncMock)).toBe('container-id-1');
    expect(cleanup).not.toHaveBeenCalled();
    expect(execFileSyncMock).toHaveBeenCalledTimes(1);
  });
});
