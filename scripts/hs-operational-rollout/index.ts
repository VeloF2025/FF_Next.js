#!/usr/bin/env tsx

import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

import { buildPack } from './buildPack';
import { loadLiveSnapshot } from './loadSnapshot';
import type { RolloutSnapshot } from './types';

export interface FixtureRunOptions {
  fixturePath: string;
  outputDir: string;
}

export interface LiveRunOptions {
  live: true;
  outputDir: string;
  repoRoot: string;
  databaseUrl: string;
}

export type RunOptions = FixtureRunOptions | LiveRunOptions;

function isNotFound(error: unknown): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    (error as NodeJS.ErrnoException).code === 'ENOENT'
  );
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch (error) {
    if (isNotFound(error)) return false;
    throw error;
  }
}

function assertSnapshot(value: unknown): asserts value is RolloutSnapshot {
  if (!value || typeof value !== 'object') {
    throw new Error('Fixture must contain a rollout snapshot object');
  }
  const candidate = value as Partial<RolloutSnapshot>;
  if (
    candidate.source !== 'fixture' ||
    !candidate.adoption ||
    !Array.isArray(candidate.contractors) ||
    !Array.isArray(candidate.teams) ||
    !Array.isArray(candidate.members) ||
    !Array.isArray(candidate.blockedCheckins) ||
    !Array.isArray(candidate.leadEvidence)
  ) {
    throw new Error('Fixture is missing required rollout snapshot fields');
  }
}

async function loadFixtureSnapshot(path: string): Promise<RolloutSnapshot> {
  const parsed: unknown = JSON.parse(await readFile(path, 'utf8'));
  assertSnapshot(parsed);
  return parsed;
}

export function assertLiveOutputPath(outputDir: string, repoRoot: string): void {
  const allowedRoot = resolve(repoRoot, '.private', 'hs-operational-rollout');
  const target = resolve(outputDir);
  const pathFromRoot = relative(allowedRoot, target);
  if (
    pathFromRoot === '' ||
    pathFromRoot === '..' ||
    pathFromRoot.startsWith(`..${sep}`) ||
    resolve(allowedRoot, pathFromRoot) !== target
  ) {
    throw new Error(`Live output must be inside ${allowedRoot}`);
  }
}

export async function writePack(
  snapshot: RolloutSnapshot,
  outputDir: string
): Promise<string[]> {
  const files = buildPack(snapshot);
  const filenames = Object.keys(files).sort();
  for (const filename of filenames) {
    if (await pathExists(join(outputDir, filename))) {
      throw new Error(`Refusing to overwrite ${join(outputDir, filename)}`);
    }
  }

  await mkdir(outputDir, { recursive: true });
  for (const filename of filenames) {
    await writeFile(join(outputDir, filename), files[filename], {
      encoding: 'utf8',
      flag: 'wx',
    });
  }
  return filenames;
}

export async function run(options: RunOptions): Promise<string[]> {
  let snapshot: RolloutSnapshot;
  if ('fixturePath' in options) {
    snapshot = await loadFixtureSnapshot(options.fixturePath);
  } else {
    assertLiveOutputPath(options.outputDir, options.repoRoot);
    snapshot = await loadLiveSnapshot(options.databaseUrl);
  }
  return writePack(snapshot, resolve(options.outputDir));
}

function argumentValue(argv: string[], flag: string): string | null {
  const index = argv.indexOf(flag);
  const value = index >= 0 ? argv[index + 1] : undefined;
  return value && !value.startsWith('--') ? value : null;
}

export function parseCliOptions(
  argv: string[],
  repoRoot: string,
  databaseUrl: string | undefined
): RunOptions {
  const fixturePath = argumentValue(argv, '--fixture');
  const outputDir = argumentValue(argv, '--output');
  const live = argv.includes('--live');
  if (Boolean(fixturePath) === live) {
    throw new Error('Choose exactly one input mode: --fixture <json> or --live');
  }
  if (!outputDir) {
    throw new Error('--output <directory> is required');
  }
  if (live) {
    if (!databaseUrl) throw new Error('DATABASE_URL is required for --live');
    return { live: true, outputDir, repoRoot, databaseUrl };
  }
  return { fixturePath: fixturePath as string, outputDir };
}

async function main(argv: string[]): Promise<void> {
  const options = parseCliOptions(argv, process.cwd(), process.env.DATABASE_URL);
  const written = await run(options);
  process.stdout.write(
    `Wrote ${written.length} private rollout artifacts to ${resolve(options.outputDir)}\n`
  );
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '';
if (import.meta.url === invokedPath) {
  void main(process.argv.slice(2)).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`H&S rollout pack failed: ${message}\n`);
    process.exitCode = 1;
  });
}
