/**
 * Unit tests for the project-AOI distortion → WA alert module.
 *
 * shouldAlert + buildAlertMessage are pure; sendProjectAoiDistortionAlert has
 * the WA sender injected so the test uses a local stub.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  buildAlertMessage,
  sendProjectAoiDistortionAlert,
  shouldAlert,
  type ProjectAoiHealthRow,
} from '../projectAoiAlert';

function row(overrides: Partial<ProjectAoiHealthRow> = {}): ProjectAoiHealthRow {
  return {
    projectName: 'Clean site',
    aoiStatus: 'ok',
    aoiStatusReason: null,
    previousAoiStatus: 'ok',
    poleCount: 2815,
    outlierPoleCount: 0,
    aoiAreaM2: 4_100_000,
    robustAoiAreaM2: 4_100_000,
    aoiAreaRatio: 1,
    furthestOutlierM: null,
    previousAoiAreaM2: 4_100_000,
    aoiGrowthRatio: 1,
    ...overrides,
  };
}

// The 2026-08-21 incident as the cron would read it back the night it appeared.
const INCIDENT = row({
  projectName: 'Thembisa POP 1',
  aoiStatus: 'distorted',
  aoiStatusReason: 'absolute_area',
  previousAoiStatus: 'ok',
  poleCount: 2816,
  outlierPoleCount: 1,
  aoiAreaM2: 258_900_000,
  robustAoiAreaM2: 4_100_000,
  aoiAreaRatio: 63.1,
  furthestOutlierM: 145_000,
  previousAoiAreaM2: 4_100_000,
  aoiGrowthRatio: 63.1,
});

function logger() {
  return { info: vi.fn(), error: vi.fn() };
}

describe('shouldAlert', () => {
  it('stays quiet when every project is clean', () => {
    expect(shouldAlert([row(), row({ projectName: 'Lawley' })])).toEqual([]);
  });

  it('flags a project that has newly become distorted', () => {
    const flagged = shouldAlert([row(), INCIDENT, row({ projectName: 'Lawley' })]);
    expect(flagged).toHaveLength(1);
    expect(flagged[0].projectName).toBe('Thembisa POP 1');
  });

  it('does NOT alert again on a distortion nobody has fixed yet', () => {
    // This cron runs nightly with no memory between runs. Without the
    // transition rule, an unfixed distortion is a message every night forever,
    // which is how a channel gets muted.
    const stillBroken = row({ ...INCIDENT, previousAoiStatus: 'distorted' });
    expect(shouldAlert([stillBroken])).toEqual([]);
  });

  it('alerts for a brand-new project that arrives already distorted', () => {
    // No previous status means it has never been scored, not that it was fine.
    const fresh = row({ ...INCIDENT, previousAoiStatus: null });
    expect(shouldAlert([fresh])).toHaveLength(1);
  });

  it('does NOT alert on suspect', () => {
    // `suspect` means the outlier ratio moved with no absolute signal behind
    // it. An adversarial review measured that the ratio tracks how a project is
    // split between work areas, not how distorted it is — a dense cluster with
    // a long feeder would have alerted every night.
    const suspect = row({ projectName: 'Tonga', aoiStatus: 'suspect', aoiStatusReason: 'outlier_ratio', outlierPoleCount: 60, aoiAreaRatio: 1.35 });
    expect(shouldAlert([suspect])).toEqual([]);
  });

  it('does NOT alert on outlier poles alone', () => {
    // A 90/10 split of two genuine work areas has ~99 outlier poles and is
    // perfectly healthy.
    expect(shouldAlert([row({ projectName: 'Two areas', outlierPoleCount: 99 })])).toEqual([]);
  });

  it('leaves unassessed to the liveness check rather than alerting nightly', () => {
    // A row the refresh never touched has no previous status either, so this
    // path could not dedupe it. /api/cron/db-health watches that condition from
    // outside this cron and has its own cooldown.
    expect(shouldAlert([row({ aoiStatus: 'unassessed', previousAoiStatus: null })])).toEqual([]);
  });

  it('does not treat a large clean project as a problem', () => {
    expect(shouldAlert([row({ projectName: 'Wide', aoiAreaM2: 113_000_000, robustAoiAreaM2: 113_000_000 })]))
      .toEqual([]);
  });
});

describe('buildAlertMessage', () => {
  it('names the project, the signal that fired, and the numbers behind it', () => {
    const msg = buildAlertMessage([INCIDENT], 9);
    expect(msg).toContain('1 of 9 project AOI(s) newly look distorted.');
    expect(msg).toContain('Thembisa POP 1');
    expect(msg).toContain('larger than any real project site');
    expect(msg).toContain('258.90 km²');
    expect(msg).toContain('4.10 km²');
    expect(msg).toContain('1 of 2816 pole(s) out of place');
    expect(msg).toContain('furthest 145.0 km');
  });

  it('describes a growth flag against the previous refresh, not against a robust hull', () => {
    // Different signal, different evidence: nothing is out of place here, the
    // hull simply stepped up.
    const grown = row({
      projectName: 'Etwatwa', aoiStatus: 'distorted', aoiStatusReason: 'area_growth',
      outlierPoleCount: 0, aoiAreaM2: 113_000_000, previousAoiAreaM2: 12_600_000, aoiGrowthRatio: 8.97,
    });
    const msg = buildAlertMessage([grown], 9);
    expect(msg).toContain('jumped against its own previous refresh');
    expect(msg).toContain('up from 12.60 km²');
    expect(msg).toContain('9.0x');
    expect(msg).not.toContain('out of place');
  });

  it('says the geometry was not corrected', () => {
    const msg = buildAlertMessage([INCIDENT], 9);
    expect(msg).toContain('nothing was trimmed automatically');
    expect(msg).toContain('Fix the pole assignment');
  });

  it('never prints NaN when a measure is missing', () => {
    const msg = buildAlertMessage(
      [row({ projectName: 'Barely surveyed', aoiStatus: 'distorted', aoiStatusReason: 'no_robust_hull',
             poleCount: 3, outlierPoleCount: 1, robustAoiAreaM2: null, aoiAreaRatio: null,
             furthestOutlierM: 145_000, previousAoiAreaM2: null, aoiGrowthRatio: null })],
      9,
    );
    expect(msg).toContain('too few poles left');
    expect(msg).not.toContain('NaN');
  });
});

describe('sendProjectAoiDistortionAlert', () => {
  it('does not send when nothing newly broke', async () => {
    const send = vi.fn();
    const log = logger();
    const result = await sendProjectAoiDistortionAlert({ rows: [row()], groupJid: 'g@g.us', send, logger: log });
    expect(send).not.toHaveBeenCalled();
    expect(result).toEqual({ alerted: false, flagged: [] });
    expect(log.info).toHaveBeenCalledWith(expect.stringContaining('no new distortion across 1 AOI(s)'));
  });

  it('sends the built message to the configured group', async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const result = await sendProjectAoiDistortionAlert({
      rows: [row(), INCIDENT], groupJid: 'ops@g.us', send, logger: logger(),
    });
    expect(result.alerted).toBe(true);
    expect(result.flagged).toHaveLength(1);
    expect(send).toHaveBeenCalledTimes(1);
    const [jid, message] = send.mock.calls[0];
    expect(jid).toBe('ops@g.us');
    expect(message).toContain('Thembisa POP 1');
    expect(message).toContain('1 of 2 project AOI(s)');
  });

  it('swallows a send failure and still reports what was flagged', async () => {
    const send = vi.fn().mockRejectedValue(new Error('bridge down'));
    const log = logger();
    const result = await sendProjectAoiDistortionAlert({
      rows: [INCIDENT], groupJid: 'ops@g.us', send, logger: log,
    });
    expect(result).toEqual({ alerted: false, flagged: [INCIDENT] });
    expect(log.error).toHaveBeenCalledWith(expect.stringContaining('bridge down'));
  });
});
