import { execFileSync, spawnSync } from 'node:child_process';
import {
  copyFileSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const tempRoots: string[] = [];

function git(cwd: string, ...args: string[]): void {
  execFileSync('git', args, { cwd, stdio: 'ignore' });
}

function gitOutput(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function commitFixture(source: string, output: string): void {
  const scriptPath = join(source, 'scripts', 'deploy-local-main.sh');
  writeFileSync(scriptPath, `#!/bin/bash\nprintf '${output}:%s\\n' "$1"\n`);
  git(source, 'add', 'scripts/deploy-local-main.sh');
  git(source, 'commit', '-m', output);
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('deploy-local fresh control bootstrap', () => {
  it('executes the latest origin/master script without changing the caller checkout', () => {
    const root = mkdtempSync(join(tmpdir(), 'ff-deploy-control-'));
    tempRoots.push(root);
    const source = join(root, 'source');
    const remote = join(root, 'origin.git');
    const cacheRoot = join(root, 'cache-root');
    const cache = join(cacheRoot, 'fibreflow-deploy-control');
    mkdirSync(join(source, 'scripts'), { recursive: true });
    copyFileSync(
      join(process.cwd(), 'scripts', 'deploy-local.sh'),
      join(source, 'scripts', 'deploy-local.sh'),
    );

    git(source, 'init', '-b', 'master');
    git(source, 'config', 'user.email', 'test@example.invalid');
    git(source, 'config', 'user.name', 'Deploy Bootstrap Test');
    git(source, 'add', 'scripts/deploy-local.sh');
    commitFixture(source, 'fresh-v1');
    git(root, 'init', '--bare', remote);
    git(source, 'remote', 'add', 'origin', remote);
    git(source, 'push', '-u', 'origin', 'master');

    const launcher = join(source, 'scripts', 'deploy-local.sh');
    const run = (extraEnv: Record<string, string> = {}) => spawnSync('bash', [launcher, 'sentinel'], {
      cwd: source,
      encoding: 'utf8',
      env: {
        ...process.env,
        XDG_CACHE_HOME: cacheRoot,
        FF_DEPLOY_CONTROL_GIT_DIR: join(root, 'forged.git'),
        FF_DEPLOY_CONTROL_SHA: 'forged-sha',
        ...extraEnv,
      },
    });

    const first = run();
    expect(first.status).toBe(0);
    expect(first.stdout).toContain('fresh-v1:sentinel');

    commitFixture(source, 'fresh-v2');
    git(source, 'push', 'origin', 'master');
    const freshSha = gitOutput(source, 'rev-parse', 'HEAD');

    const attacker = join(root, 'attacker');
    mkdirSync(join(attacker, 'scripts'), { recursive: true });
    git(attacker, 'init', '-b', 'master');
    git(attacker, 'config', 'user.email', 'test@example.invalid');
    git(attacker, 'config', 'user.name', 'Deploy Bootstrap Attacker Fixture');
    commitFixture(attacker, 'malicious');
    const attackerSha = gitOutput(attacker, 'rev-parse', 'HEAD');
    const poisonedGitCache = join(cache, 'repo.git');
    git(root, 'clone', '--bare', attacker, poisonedGitCache);
    git(
      root,
      `--git-dir=${poisonedGitCache}`,
      'config',
      `url.${attacker}.insteadOf`,
      remote,
    );
    git(
      root,
      `--git-dir=${poisonedGitCache}`,
      'update-ref',
      `refs/replace/${freshSha}`,
      attackerSha,
    );

    const poisonTarget = join(root, 'poisoned-control.sh');
    writeFileSync(poisonTarget, "#!/bin/bash\nprintf 'poisoned:%s\\n' \"$1\"\n");
    symlinkSync(
      poisonTarget,
      join(cache, `deploy-local-main-${freshSha}.sh`),
    );

    const poisonedGlobal = join(root, 'poisoned.gitconfig');
    writeFileSync(
      poisonedGlobal,
      `[url "${attacker}"]\n\tinsteadOf = ${remote}\n`,
    );
    const poisonedTemplate = join(root, 'poisoned-template');
    mkdirSync(poisonedTemplate);
    writeFileSync(
      join(poisonedTemplate, 'config'),
      `[core]\n\trepositoryformatversion = 0\n\tbare = true\n[url "${attacker}"]\n\tinsteadOf = ${remote}\n`,
    );
    const poisonedHome = join(root, 'poisoned-home');
    const poisonedConfigHome = join(poisonedHome, '.config');
    mkdirSync(join(poisonedConfigHome, 'git'), { recursive: true });
    writeFileSync(
      join(poisonedHome, '.gitconfig'),
      '[credential "https://github.com"]\n\thelper = !printf inherited-helper-ran\n',
    );
    const second = run({
      HOME: poisonedHome,
      XDG_CONFIG_HOME: poisonedConfigHome,
      GH_CONFIG_DIR: join(poisonedConfigHome, 'gh'),
      GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: `url.${attacker}.insteadOf`,
      GIT_CONFIG_VALUE_0: remote,
      GIT_CONFIG_GLOBAL: poisonedGlobal,
      GIT_TEMPLATE_DIR: poisonedTemplate,
      GIT_EXEC_PATH: join(root, 'poisoned-exec-path'),
      GIT_SSL_NO_VERIFY: '1',
      'BASH_FUNC_git%%': '() { printf "function-poisoned\\n"; return 0; }',
    });
    expect(second.status).toBe(0);
    expect(second.stdout).toContain('fresh-v2:sentinel');
    expect(second.stdout).not.toContain('poisoned:sentinel');
    expect(second.stdout).not.toContain('malicious:sentinel');
    expect(second.stdout).not.toContain('function-poisoned');
    expect(readFileSync(launcher, 'utf8')).not.toContain('git config --global');

    git(source, 'remote', 'set-url', 'origin', join(root, 'missing-origin.git'));
    const offline = run();
    expect(offline.status).not.toBe(0);
    expect(offline.stderr).toContain('refusing stale orchestration');
    expect(offline.stdout).not.toContain('fresh-v2:sentinel');
    expect(gitOutput(source, 'status', '--porcelain')).toBe('');
  });
});
