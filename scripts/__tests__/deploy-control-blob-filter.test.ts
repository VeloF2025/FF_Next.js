/**
 * The deploy control fetch must not download the whole tree, and must still
 * work when it cannot filter.
 *
 * scripts/deploy-local.sh builds a throwaway bare repo purely to read one file
 * from origin/master — scripts/deploy-local-main.sh, about 31 KB — then deletes
 * the repo. Fetching every blob in master's tree to get it moves several
 * hundred MB of a 1.57 GiB repository per deploy.
 *
 * On 2026-08-19 that stopped deploys entirely: three consecutive runs died
 * mid-transfer ("early EOF", "curl 92 HTTP/2 stream CANCEL", "curl 18 transfer
 * closed") after 40, 7 and 24 minutes. Forcing HTTP/1.1 changed the error and
 * nothing else. The same fetch with --filter=blob:none finished in 12 seconds.
 *
 * The filter is not universally safe, which is why the script falls back rather
 * than relying on it. Git refuses to register a remote whose name begins with
 * '/' as a promisor, so a path-style origin advertising filter support fails the
 * fetch outright with "missing blob object". A remote that does not advertise
 * the capability is fine either way — it silently sends everything.
 *
 * These tests run the real script against a real remote of exactly that awkward
 * shape, because that is the case the fallback exists for and the one a
 * URL-based test could never reach.
 *
 * KNOWN GAP: the second fallback — a filtered fetch that SUCCEEDS followed by a
 * failing `show`, and the SHA re-check guarding it — is not covered here. Every
 * remote shape a test can build resolves through the first fallback instead: a
 * path remote fails the fetch outright, and a remote ignoring the filter already
 * holds the blob locally. Driving it would need a promisor-capable HTTP remote
 * that serves the pack but not the lazy blob.
 *
 * A `git` shim on PATH does NOT work and must not be attempted: deploy-local.sh
 * resets PATH to a fixed list at line 17 as a hardening measure, so the shim is
 * never invoked and the test passes while exercising nothing.
 */

import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const tempRoots: string[] = [];

function git(cwd: string, ...args: string[]): void {
  execFileSync('git', args, { cwd, stdio: 'ignore' });
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

/**
 * A source checkout whose origin is a path-style bare repo, with a large blob in
 * the tree that the deploy never reads.
 *
 * @param allowFilter whether the remote advertises filter support. True is the
 *   shape that breaks a filtered fetch; false is the shape that ignores it.
 */
function buildFixture(allowFilter: boolean): { source: string; home: string } {
  const root = mkdtempSync(join(tmpdir(), 'ff-blob-filter-'));
  tempRoots.push(root);
  const source = join(root, 'source');
  const remote = join(root, 'origin.git');
  mkdirSync(join(source, 'scripts'), { recursive: true });

  copyFileSync(
    join(process.cwd(), 'scripts', 'deploy-local.sh'),
    join(source, 'scripts', 'deploy-local.sh')
  );
  writeFileSync(join(source, 'scripts', 'deploy-local-main.sh'), '#!/bin/bash\necho ORCH "$1"\n');
  // Stands in for the hundreds of MB the real fetch was pulling and discarding.
  writeFileSync(join(source, 'bulk.bin'), 'x'.repeat(2_000_000));

  git(source, 'init', '-q', '-b', 'master', '.');
  git(source, 'config', 'user.email', 'test@example.invalid');
  git(source, 'config', 'user.name', 'Blob Filter Test');
  git(source, 'add', '-A');
  git(source, 'commit', '-qm', 'fixture');
  git(root, 'init', '-q', '--bare', remote);
  if (allowFilter) git(remote, 'config', 'uploadpack.allowFilter', 'true');
  git(source, 'remote', 'add', 'origin', remote);
  git(source, 'push', '-q', '-u', 'origin', 'master');

  return { source, home: root };
}

/** Runs the real deploy-local.sh, returning its stdout and the git commands it ran. */
function runDeploy(fixture: { source: string; home: string }): {
  stdout: string;
  trace: string;
} {
  const tracePath = join(fixture.home, 'git-trace.log');
  const stdout = execFileSync('bash', ['scripts/deploy-local.sh', 'dev'], {
    cwd: fixture.source,
    encoding: 'utf8',
    env: {
      ...process.env,
      HOME: fixture.home,
      XDG_CACHE_HOME: join(fixture.home, 'cache'),
      GIT_TRACE: tracePath,
    },
  });
  let trace = '';
  try {
    trace = readFileSync(tracePath, 'utf8');
  } catch {
    trace = '';
  }
  return { stdout, trace };
}

describe('deploy control fetch', () => {
  it('asks for the cheap fetch first', () => {
    const { trace } = runDeploy(buildFixture(false));

    // Without this the deploy is back to moving the whole tree, which is what
    // made 2026-08-19's three attempts unrunnable.
    expect(trace).toContain('--filter=blob:none');
  });

  it('still deploys when the origin cannot be a promisor', () => {
    // A path-style origin advertising filter support: the filtered fetch fails
    // here, and before the fallback existed the script exited with "cannot
    // refresh deploy control" instead of deploying.
    const { stdout } = runDeploy(buildFixture(true));

    expect(stdout).toContain('ORCH dev');
  });

  it('still deploys when the origin ignores the filter', () => {
    // The remote silently sends every object; the blob is local either way.
    const { stdout } = runDeploy(buildFixture(false));

    expect(stdout).toContain('ORCH dev');
  });

  it('retries unfiltered rather than giving up', () => {
    const { trace } = runDeploy(buildFixture(true));

    // Both fetches must appear: the cheap attempt, then the full one. A script
    // that only ever ran the fallback would pass the deploy assertions above
    // while having lost the entire point of the change.
    const fetches = trace.split('\n').filter((line) => line.includes('fetch --quiet --depth=1'));
    expect(fetches.some((line) => line.includes('--filter=blob:none'))).toBe(true);
    expect(fetches.some((line) => !line.includes('--filter=blob:none'))).toBe(true);
  });
});
