/**
 * The deploy script's MCP-connector restart step.
 *
 * This step exists because a deploy rewrites apps/ff_mcp under a live process that has
 * already imported the old modules, and nothing else in the deploy notices. Its own
 * correctness was previously established only by hand, which is the same class of problem
 * it was written to solve — so it is exercised here against fake `systemctl`, `find`,
 * `curl` and `sudo` binaries on PATH.
 *
 * The block is EXTRACTED from the shipped script rather than reimplemented. A copy would
 * pass while the real script rotted.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, chmodSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SCRIPT = join(process.cwd(), 'scripts/deploy-local-main.sh');
const START = '# --- Step 9b: Restart the MCP connector if it is older than its own code ---';
const END = '# --- Step 10: Clean old backups';

let dir: string;
let harness: string;

/** The block as shipped, wrapped in just enough context to run. */
function extractBlock(): string {
  const s = readFileSync(SCRIPT, 'utf8');
  const start = s.indexOf(START);
  const end = s.indexOf(END);
  if (start === -1 || end === -1) {
    throw new Error('Step 9b markers not found — the deploy script changed shape');
  }
  return s.slice(start, end);
}

interface Stubs {
  /** What `systemctl show -p ActiveEnterTimestamp` returns. Empty models a unit mid-restart. */
  started?: string;
  /** `is-active` output after the restart. */
  activeAfter?: string;
  /** Whether `systemctl restart` succeeds. */
  restartOk?: boolean;
  /** Whether the readiness probe answers. */
  curlOk?: boolean;
  /** Files `find` reports as newer than the process. Empty = connector is current. */
  findOutput?: string;
  /** Whether `find` itself succeeds. */
  findOk?: boolean;
}

function run(stubs: Stubs = {}): { stdout: string; calls: string } {
  const {
    started = '2026-01-01 00:00:00 SAST',
    activeAfter = 'active',
    restartOk = true,
    curlOk = true,
    findOutput = '',
    findOk = true,
  } = stubs;

  // A fresh directory per run: the `restarted` marker is what makes MainPID change, so
  // sharing it across cases would let one test's restart satisfy the next test's check.
  const runDir = mkdtempSync(join(dir, 'run-'));
  const bin = join(runDir, 'bin');
  mkdirSync(bin, { recursive: true });
  const calls = join(runDir, 'calls.log');
  writeFileSync(calls, '');

  const stub = (name: string, body: string) => {
    const p = join(bin, name);
    writeFileSync(p, `#!/usr/bin/env bash\necho "${name} $*" >> "${calls}"\n${body}\n`);
    chmodSync(p, 0o755);
  };

  // MainPID differs before/after so the "new pid" condition can be satisfied.
  stub(
    'systemctl',
    `case "$*" in
       *list-unit-files*)          exit 0 ;;
       *ActiveEnterTimestamp*)     echo "${started ? `Wed ${started}` : ''}"; exit 0 ;;
       *MainPID*)                  if [[ -f "${runDir}/restarted" ]]; then echo 2222; else echo 1111; fi; exit 0 ;;
       *is-active*)                echo "${activeAfter}"; exit 0 ;;
       *restart*)                  ${restartOk ? `touch "${runDir}/restarted"; exit 0` : 'echo "Job failed" >&2; exit 1'} ;;
     esac
     exit 0`,
  );
  // `sudo -u velo find ...` — swallow the sudo prefix and answer as find.
  stub('sudo', `${findOk ? `printf '%s' '${findOutput}'; exit 0` : 'echo "find: cannot access" >&2; exit 1'}`);
  stub('curl', curlOk ? 'exit 0' : 'exit 7');

  const script = join(runDir, 'harness.sh');
  writeFileSync(
    script,
    `#!/usr/bin/env bash
set -euo pipefail
log()  { echo "[log] $*"; }
warn() { echo "[warn] $*"; }
TARGET="dev"
DIR="/nonexistent"
${harness}`,
  );

  const stdout = execFileSync('bash', [script], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
  });
  return { stdout, calls: readFileSync(calls, 'utf8') };
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'mcp-restart-'));
  harness = extractBlock();
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('deploy step 9b — MCP connector restart', () => {
  it('does nothing when the connector is newer than its code', () => {
    // Most deploys do not touch apps/ff_mcp, and a restart drops live MCP sessions.
    const { stdout, calls } = run({ findOutput: '' });
    expect(calls).not.toMatch(/systemctl --user restart/);
    expect(stdout).not.toContain('restarting');
  });

  it('restarts when a source file is newer than the running process', () => {
    // The property that matters, and the one the commit-range version got wrong: after a
    // deploy that pulled new Python and then failed at the build, the retry sees an
    // unchanged commit range but code that is still newer than the process.
    const { stdout, calls } = run({ findOutput: '/deploy/apps/ff_mcp/tools.py' });
    expect(calls).toMatch(/systemctl --user restart ff-remote-mcp/);
    expect(stdout).toContain('older than its code');
  });

  it('restarts when the start time cannot be read, rather than assuming it is current', () => {
    const { stdout, calls } = run({ started: '', findOutput: '' });
    expect(calls).toMatch(/systemctl --user restart ff-remote-mcp/);
    expect(stdout).toContain('restarting rather than assuming');
  });

  it('restarts when the staleness check itself fails', () => {
    // A check that could not run has not established that the connector is current.
    // Silent-skip here was the failure mode: no restart, no output, stale code served.
    const { stdout, calls } = run({ findOk: false });
    expect(calls).toMatch(/systemctl --user restart ff-remote-mcp/);
    expect(stdout).toContain('restarting to be safe');
  });

  it('confirms readiness with an HTTP probe, not merely with is-active', () => {
    // These units are Type=simple with Restart=always, so `restart` returns as soon as
    // exec succeeds — a process that imports fine and dies seconds later still looks
    // active. Only an answer on the port shows it is serving.
    const { stdout, calls } = run({ findOutput: '/x/tools.py' });
    expect(calls).toMatch(/^curl /m);
    expect(stdout).toContain('restarted and serving');
  });

  it('does NOT claim success when the process is up but not answering', () => {
    const { stdout } = run({ findOutput: '/x/tools.py', curlOk: false });
    expect(stdout).not.toContain('restarted and serving');
    expect(stdout).toContain('did not come back cleanly');
  });

  it('says the connector may be DOWN when the restart itself fails', () => {
    // Not "still running the old code" — a failed start means the old process is already
    // stopped, and telling the operator otherwise sends them the wrong way.
    const { stdout } = run({ findOutput: '/x/tools.py', restartOk: false });
    expect(stdout).toContain('may now be DOWN');
    expect(stdout).toContain('reset-failed');
  });

  it('surfaces systemd’s own error text rather than discarding it', () => {
    const { stdout } = run({ findOutput: '/x/tools.py', restartOk: false });
    expect(stdout).toContain('Job failed');
  });

  it('excludes tests and conftest from the staleness scan', () => {
    // Restarting for a test-only change drops live sessions for something the running
    // service never imports.
    const block = extractBlock();
    expect(block).toContain("! -name 'test_*.py'");
    expect(block).toContain("! -name 'conftest.py'");
  });

  it('maps each environment to its own unit and port', () => {
    const block = extractBlock();
    expect(block).toContain('ff-remote-mcp.service');
    expect(block).toContain('ff-remote-mcp-production.service');
    expect(block).toContain('7416');
    expect(block).toContain('7417');
  });
});
