import { execFileSync } from 'node:child_process';

/**
 * Starts a throwaway Postgres container, retrying when Docker's random
 * host-port allocation collides.
 *
 * The DB harnesses publish on `127.0.0.1::5432` so Docker picks a free host
 * port — deliberately, because pinning 55432 collided with an unrelated
 * project's container on velo. That fixed one race and left another: the port
 * Docker picks is only guaranteed free at the moment it is chosen, and under
 * the ROOTLESS daemon the CI runner uses, binding it is a second, later step
 * performed by RootlessKit. Between the two, anything on the box can take it.
 *
 * Observed on the runner 2026-08-22, twice in six hours, on PRs whose own code
 * touched none of this:
 *
 *   failed to set up container networking: driver failed programming external
 *   connectivity on endpoint ff-db-tests-1435187: error while calling
 *   RootlessKit PortManager.AddPort(): listen tcp4 127.0.0.1:33682:
 *   bind: address already in use
 *
 * `docker run` exits 125 and the whole suite dies in global setup before a
 * single test runs, so the PR shows a red gate that has nothing to do with it.
 *
 * A retry is the fix rather than a smarter port search: the collision is a
 * race, not a shortage, so re-rolling gets a different port and wins. Picking
 * a port ourselves and passing it explicitly would REINTRODUCE the race — we
 * would bind-check, release, and hand Docker a port that is once again only
 * probably free.
 *
 * The previous callers passed `stdio: 'ignore'`, which is why the CI log
 * carried an exit code and no reason. stderr is captured and attached to the
 * final error here.
 */
/**
 * `runDocker` is injected so the unit test can drive this function without a
 * Docker daemon. Mocking `node:child_process` was tried first and the mock did
 * not take — the test started REAL postgres containers on the dev machine.
 */
export type RunDocker = (args: readonly string[]) => string;

const defaultRunDocker: RunDocker = (args) =>
  execFileSync('docker', args as string[], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

export function startTestContainer(
  label: string,
  runArgs: readonly string[],
  cleanupFailedAttempt: () => void,
  attempts = 4,
  runDocker: RunDocker = defaultRunDocker
): string {
  let lastStderr = '';

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      // `docker run -d` prints the id with a trailing newline. Trimmed here
      // rather than in the runner so every injection behaves the same.
      return runDocker(runArgs).trim();
    } catch (error) {
      // execFileSync attaches the child's captured stderr to the thrown error.
      lastStderr = String(
        (error as { stderr?: Buffer | string })?.stderr ?? ''
      ).trim();

      // A container that failed to start is still registered — holding its
      // name, and not matched by a `status=exited` sweep because it never ran.
      // `--rm` does not cover it. The caller knows how to address it (by name,
      // or by run label where it publishes no name), so it does the removal.
      cleanupFailedAttempt();

      const isPortCollision =
        /address already in use|port is already allocated|AddPort/i.test(lastStderr);
      if (!isPortCollision || attempt === attempts) {
        throw new Error(
          `docker run failed for ${label} on attempt ${attempt}/${attempts}: ` +
            `${lastStderr || String(error)}`
        );
      }
    }
  }

  // Unreachable: the final attempt either returns or throws above.
  throw new Error(`docker run failed for ${label}: ${lastStderr}`);
}
