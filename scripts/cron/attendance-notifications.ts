#!/usr/bin/env node
/**
 * Idempotent attendance notification entry point.
 *
 * Intended SAST schedules (installation remains approval-gated): morning at
 * 08:15 Mon-Sat; clockout at 17:00 Mon-Fri and 13:00 Sat; end-of-day digest;
 * weekly readiness in the approved payroll operations slot.
 *
 * dotenv is configured before the dynamic attendance-service import because
 * db-pool and the unified bus bind their database clients at module load.
 */
import { existsSync } from 'fs';
import { isAbsolute, resolve } from 'path';
import * as dotenv from 'dotenv';

type Phase = 'morning' | 'clockout' | 'digest' | 'weekly';
const PHASES = new Set<Phase>(['morning', 'clockout', 'digest', 'weekly']);

interface Report {
  runId: string; phase: Phase; examined: number; claimed: number; accepted: number;
  failed: number; skipped: number; failures: { sourceKey: string; reason: string }[];
}

interface RunnerModule {
  runAttendanceNotifications(args: { phase: Phase; now: Date }): Promise<Report>;
}

export interface AttendanceNotificationCliDependencies {
  argv: string[];
  env: NodeJS.ProcessEnv;
  exists(path: string): boolean;
  configureEnv(path: string, env: NodeJS.ProcessEnv): void;
  loadRunner(): Promise<RunnerModule>;
  write(line: string): void;
}

export function parseAttendanceNotificationPhase(argv: string[]): Phase {
  const args = argv.slice(2);
  const values = args.filter((arg) => arg.startsWith('--phase='));
  if (values.length !== 1 || args.length !== 1) {
    throw new Error('Exactly one --phase=morning|clockout|digest|weekly argument is required');
  }
  const value = values[0]!.slice('--phase='.length) as Phase;
  if (!PHASES.has(value)) throw new Error('Unsupported attendance notification phase');
  return value;
}

function defaultDependencies(): AttendanceNotificationCliDependencies {
  return {
    argv: process.argv,
    env: process.env,
    exists: existsSync,
    configureEnv: (path) => { dotenv.config({ path }); },
    loadRunner: () => import('../../src/modules/attendance/workflow/notificationService'),
    write: (line) => { process.stdout.write(`${line}\n`); },
  };
}

export async function runAttendanceNotificationCli(
  dependencies: AttendanceNotificationCliDependencies = defaultDependencies(),
): Promise<number> {
  let phase: Phase;
  try {
    phase = parseAttendanceNotificationPhase(dependencies.argv);
  } catch {
    dependencies.write(JSON.stringify({ event: 'attendance_notifications_fatal', reason: 'invalid_phase' }));
    return 2;
  }

  const fallback = resolve(process.cwd(), dependencies.env.NODE_ENV === 'production'
    ? '.env.production' : '.env.local');
  const envFile = dependencies.env.FF_ATTENDANCE_ENV_FILE ?? fallback;
  if (!isAbsolute(envFile) || !dependencies.exists(envFile)) {
    dependencies.write(JSON.stringify({ event: 'attendance_notifications_fatal', phase,
      reason: 'environment_file_unavailable' }));
    return 2;
  }
  dependencies.configureEnv(envFile, dependencies.env);
  if (!dependencies.env.DATABASE_URL) {
    dependencies.write(JSON.stringify({ event: 'attendance_notifications_fatal', phase,
      reason: 'database_url_unavailable' }));
    return 2;
  }

  try {
    const runtime = await dependencies.loadRunner();
    const report = await runtime.runAttendanceNotifications({ phase, now: new Date() });
    dependencies.write(JSON.stringify({ event: 'attendance_notifications_complete', ...report,
      failures: report.failures.slice(0, 20) }));
    return 0;
  } catch {
    dependencies.write(JSON.stringify({ event: 'attendance_notifications_fatal', phase,
      reason: 'fatal_run_error' }));
    return 1;
  }
}

if (require.main === module) {
  void runAttendanceNotificationCli().then((code) => { process.exitCode = code; });
}
