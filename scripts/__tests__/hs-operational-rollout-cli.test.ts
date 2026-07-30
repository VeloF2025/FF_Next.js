import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  assertLiveOutputPath,
  parseCliOptions,
  run,
} from '../hs-operational-rollout/index';

const createdDirectories: string[] = [];

async function disposableOutput(): Promise<string> {
  const parent = await mkdtemp(join(tmpdir(), 'ff-hs-rollout-'));
  createdDirectories.push(parent);
  return join(parent, 'pack');
}

afterEach(async () => {
  await Promise.all(
    createdDirectories.splice(0).map((path) =>
      rm(path, { recursive: true, force: true })
    )
  );
});

describe('H&S operational rollout CLI', () => {
  it('writes the complete pack from disposable demo data', async () => {
    const outputDir = await disposableOutput();

    const written = await run({
      fixturePath: resolve('scripts/hs-operational-rollout/demo-fixture.json'),
      outputDir,
    });

    expect(written.sort()).toEqual([
      'README.md',
      'contractor-mapping.csv',
      'crew-lead-candidates.csv',
      'manifest.json',
      'medical-blockers.csv',
      'staff-announcement-DRAFT.md',
    ]);
    expect(await readFile(join(outputDir, 'manifest.json'), 'utf8')).toContain(
      '"source": "fixture"'
    );
  });

  it('refuses to overwrite an existing pack file', async () => {
    const outputDir = await disposableOutput();
    const options = {
      fixturePath: resolve('scripts/hs-operational-rollout/demo-fixture.json'),
      outputDir,
    };
    await run(options);

    await expect(run(options)).rejects.toThrow('Refusing to overwrite');
  });

  it('keeps live output beneath the repository private rollout directory', () => {
    const repoRoot = '/workspace/ff';

    expect(() =>
      assertLiveOutputPath(
        '/workspace/ff/.private/hs-operational-rollout/20260730-060000',
        repoRoot
      )
    ).not.toThrow();
    expect(() =>
      assertLiveOutputPath('/tmp/public-output', repoRoot)
    ).toThrow('Live output must be inside');
  });

  it('requires exactly one input mode and a database URL for live runs', () => {
    const repoRoot = '/workspace/ff';
    const outputDir =
      '/workspace/ff/.private/hs-operational-rollout/20260730-060000';

    expect(
      parseCliOptions(
        ['--live', '--output', outputDir],
        repoRoot,
        'postgres://demo'
      )
    ).toEqual({
      live: true,
      outputDir,
      repoRoot,
      databaseUrl: 'postgres://demo',
    });
    expect(() =>
      parseCliOptions(
        ['--live', '--fixture', 'demo.json', '--output', outputDir],
        repoRoot,
        'postgres://demo'
      )
    ).toThrow('Choose exactly one input mode');
    expect(() =>
      parseCliOptions(['--live', '--output', outputDir], repoRoot, undefined)
    ).toThrow('DATABASE_URL is required');
  });
});
