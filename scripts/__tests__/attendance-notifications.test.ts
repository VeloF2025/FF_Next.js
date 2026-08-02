import { chmod, mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { spawnSync } from 'child_process';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_CHANNEL_PREFERENCES, EVENT_GROUPS, EVENT_ICONS, EVENT_LABELS, EVENT_SEVERITY,
  getRegisteredEventTypes,
} from '@/modules/notifications/constants';
import {
  parseAttendanceNotificationPhase, runAttendanceNotificationCli,
  type AttendanceNotificationCliDependencies,
} from '../cron/attendance-notifications';

const temporaryPaths: string[] = [];
afterEach(async () => {
  await Promise.all(temporaryPaths.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

function cliDeps(overrides: Partial<AttendanceNotificationCliDependencies> = {}) {
  const output: string[] = [];
  const env: NodeJS.ProcessEnv = { NODE_ENV: 'production', FF_ATTENDANCE_ENV_FILE: '/deploy/.env.local' };
  const dependencies: AttendanceNotificationCliDependencies = {
    argv: ['node', 'attendance-notifications.ts', '--phase=morning'], env,
    exists: () => true,
    configureEnv: vi.fn(() => { env.DATABASE_URL = 'postgres://secret@db/fibreflow'; }),
    loadRunner: vi.fn(async () => ({
      runAttendanceNotifications: vi.fn(async () => ({
        runId: 'attendance-run-1', phase: 'morning' as const, examined: 4, claimed: 3,
        accepted: 2, failed: 1, skipped: 1,
        failures: [{ sourceKey: 'exception:1', reason: 'recipient_missing' as const }],
      })),
    })),
    write: (line) => { output.push(line); },
    ...overrides,
  };
  return { dependencies, output, env };
}

describe('attendance notification CLI', () => {
  it.each([
    ['morning', 'morning'], ['clockout', 'clockout'], ['digest', 'digest'], ['weekly', 'weekly'],
  ] as const)('accepts only the exact %s phase', (value, expected) => {
    expect(parseAttendanceNotificationPhase(['node', 'script', `--phase=${value}`])).toBe(expected);
  });

  it.each([
    { args: [] }, { args: ['--phase=later'] },
    { args: ['--phase=morning', '--phase=weekly'] }, { args: ['morning'] },
  ])('rejects absent, invalid, duplicated or positional phase arguments', ({ args }) => {
    expect(() => parseAttendanceNotificationPhase(['node', 'script', ...args])).toThrow('phase');
  });

  it('loads the selected dotenv file before importing DB and notification runtime', async () => {
    const order: string[] = [];
    const { dependencies, env } = cliDeps({
      configureEnv: vi.fn((_path, target) => { order.push('dotenv'); target.DATABASE_URL = 'postgres://db/fibreflow'; }),
      loadRunner: vi.fn(async () => {
        order.push(`runtime:${Boolean(env.DATABASE_URL)}`);
        return { runAttendanceNotifications: vi.fn(async () => ({ runId: 'run', phase: 'morning' as const,
          examined: 0, claimed: 0, accepted: 0, failed: 0, skipped: 0, failures: [] })) };
      }),
    });

    expect(await runAttendanceNotificationCli(dependencies)).toBe(0);
    expect(order).toEqual(['dotenv', 'runtime:true']);
  });

  it('emits bounded structured evidence without environment secrets', async () => {
    const { dependencies, output } = cliDeps();
    expect(await runAttendanceNotificationCli(dependencies)).toBe(0);
    expect(output).toHaveLength(1);
    const evidence = JSON.parse(output[0]!) as Record<string, unknown>;
    expect(evidence).toMatchObject({ event: 'attendance_notifications_complete', runId: 'attendance-run-1',
      phase: 'morning', examined: 4, claimed: 3, accepted: 2, failed: 1, skipped: 1 });
    expect(JSON.stringify(evidence)).not.toContain('postgres://');
    expect(JSON.stringify(evidence)).not.toContain('secret');
  });

  it('returns nonzero only for invalid setup or a fatal run', async () => {
    const invalid = cliDeps({ argv: ['node', 'script', '--phase=nope'] });
    expect(await runAttendanceNotificationCli(invalid.dependencies)).toBe(2);
    expect(invalid.dependencies.loadRunner).not.toHaveBeenCalled();
    expect(invalid.output.join('')).toContain('invalid_phase');

    const fatal = cliDeps({ loadRunner: vi.fn(async () => { throw new Error('postgres://secret@db'); }) });
    expect(await runAttendanceNotificationCli(fatal.dependencies)).toBe(1);
    expect(fatal.output.join('')).toContain('fatal_run_error');
    expect(fatal.output.join('')).not.toContain('secret');
  });
});

describe('unified attendance event registry', () => {
  const events = [
    'attendance.clockout_due', 'attendance.correction_required',
    'attendance.supervisor_digest', 'attendance.hr_readiness',
  ];

  it('registers every attendance event in every required map and group', () => {
    for (const event of events) {
      expect(getRegisteredEventTypes()).toContain(event);
      expect(DEFAULT_CHANNEL_PREFERENCES[event]).toEqual({ in_app: true, email: false, whatsapp: false });
      expect(EVENT_ICONS[event]).toBeTruthy();
      expect(EVENT_SEVERITY[event]).toBeTruthy();
      expect(EVENT_LABELS[event]).toBeTruthy();
      expect(EVENT_GROUPS[event]).toBe('Attendance');
    }
  });
});

describe('attendance notification shell wrapper', () => {
  it('is valid bash and invokes the absolute TS entry once with phase and selected env', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ff-attendance-notify-'));
    temporaryPaths.push(root);
    const capture = join(root, 'args.txt');
    const fakeTsx = join(root, 'tsx');
    const envFile = join(root, '.env.local');
    const lockFile = join(root, 'attendance.lock');
    await writeFile(fakeTsx, `#!/usr/bin/env bash\nprintf '%s\\n' "$@" > "${capture}"\n`, 'utf8');
    await chmod(fakeTsx, 0o700);
    await writeFile(envFile, 'DATABASE_URL=not-read-by-wrapper\n', 'utf8');
    const script = resolve('scripts/cron-attendance-notifications.sh');

    expect(spawnSync('bash', ['-n', script], { encoding: 'utf8' }).status).toBe(0);
    const result = spawnSync('bash', [script, 'digest'], {
      encoding: 'utf8', env: { ...process.env, FF_ATTENDANCE_DEPLOY_ENV: 'local',
        FF_ATTENDANCE_TSX_BIN: fakeTsx, FF_ATTENDANCE_ENV_FILE: envFile,
        FF_ATTENDANCE_LOCK_FILE: lockFile },
    });
    expect(result.status).toBe(0);
    const args = await readFile(capture, 'utf8');
    expect(args).toContain(resolve('scripts/cron/attendance-notifications.ts'));
    expect(args).toContain('--phase=digest');
    expect(args).not.toContain('DATABASE_URL=not-read-by-wrapper');
  });
});
