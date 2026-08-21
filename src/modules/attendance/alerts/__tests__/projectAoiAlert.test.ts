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
    poleCount: 2815,
    outlierPoleCount: 0,
    aoiAreaM2: 4_100_000,
    robustAoiAreaM2: 4_100_000,
    aoiAreaRatio: 1,
    furthestOutlierM: null,
    ...overrides,
  };
}

// The 2026-08-21 incident as the cron would read it back.
const INCIDENT = row({
  projectName: 'Thembisa POP 1',
  aoiStatus: 'distorted',
  poleCount: 2816,
  outlierPoleCount: 1,
  aoiAreaM2: 258_900_000,
  robustAoiAreaM2: 4_100_000,
  aoiAreaRatio: 63.1,
  furthestOutlierM: 145_000,
});

function logger() {
  return { info: vi.fn(), error: vi.fn() };
}

describe('shouldAlert', () => {
  it('stays quiet when every project is clean', () => {
    expect(shouldAlert([row(), row({ projectName: 'Lawley' })])).toEqual([]);
  });

  it('flags the distorted project and only it', () => {
    const flagged = shouldAlert([row(), INCIDENT, row({ projectName: 'Lawley' })]);
    expect(flagged).toHaveLength(1);
    expect(flagged[0].projectName).toBe('Thembisa POP 1');
  });

  it('flags an outlier pole even when the hull barely moved', () => {
    // "suspect" is still a pole in the wrong project. Waiting for it to become
    // "distorted" is waiting for the geofence to already be wrong.
    const suspect = row({ projectName: 'Tonga', aoiStatus: 'suspect', outlierPoleCount: 1, aoiAreaRatio: 1.2 });
    expect(shouldAlert([suspect]).map((r) => r.projectName)).toEqual(['Tonga']);
  });

  it('flags a row the refresh never scored', () => {
    // The column default survives only if the refresh did not reach the row —
    // a silent scoring gap, which is the shape of the original incident.
    const stale = row({ projectName: 'Grabouw', aoiStatus: 'unassessed', outlierPoleCount: 0 });
    expect(shouldAlert([stale]).map((r) => r.projectName)).toEqual(['Grabouw']);
  });

  it('does not treat a large clean project as a problem', () => {
    // A genuinely spread-out project has a huge hull and no outliers. If size
    // alone alerted, the guard would be muted within a week.
    expect(shouldAlert([row({ projectName: 'Wide', aoiAreaM2: 9_720_000_000, robustAoiAreaM2: 9_720_000_000 })]))
      .toEqual([]);
  });
});

describe('buildAlertMessage', () => {
  it('names the project, the pole count, the distance and both areas', () => {
    const msg = buildAlertMessage([INCIDENT], 9);
    expect(msg).toContain('1 of 9 project AOI(s) look distorted.');
    expect(msg).toContain('Thembisa POP 1 [distorted]');
    expect(msg).toContain('1 of 2816 pole(s) out of place');
    expect(msg).toContain('furthest 145.0 km');
    expect(msg).toContain('258.90 km²');
    expect(msg).toContain('4.10 km²');
    expect(msg).toContain('63.1x');
  });

  it('says the geometry was not corrected', () => {
    // Without this the reader's natural conclusion is that it has been handled.
    // It has not, and it must not be: a heuristically trimmed hull can shrink a
    // legitimate geofence and flag people off-site who were on it.
    const msg = buildAlertMessage([INCIDENT], 9);
    expect(msg).toContain('nothing was trimmed automatically');
    expect(msg).toContain('Fix the pole assignment');
  });

  it('reports a missing robust hull as such rather than as a number', () => {
    const msg = buildAlertMessage(
      [row({ projectName: 'Barely surveyed', aoiStatus: 'distorted', poleCount: 3, outlierPoleCount: 1,
             robustAoiAreaM2: null, aoiAreaRatio: null, furthestOutlierM: 145_000 })],
      9,
    );
    expect(msg).toContain('no robust hull');
    expect(msg).not.toContain('NaN');
  });

  it('points an unscored row at the cron rather than at the data', () => {
    const msg = buildAlertMessage([row({ projectName: 'Grabouw', aoiStatus: 'unassessed' })], 9);
    expect(msg).toContain('not scored by the last refresh');
  });
});

describe('sendProjectAoiDistortionAlert', () => {
  it('does not send when everything is clean', async () => {
    const send = vi.fn();
    const log = logger();
    const result = await sendProjectAoiDistortionAlert({ rows: [row()], groupJid: 'g@g.us', send, logger: log });
    expect(send).not.toHaveBeenCalled();
    expect(result).toEqual({ alerted: false, flagged: [] });
    expect(log.info).toHaveBeenCalledWith(expect.stringContaining('all 1 AOI(s) clean'));
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
    // The refresh already succeeded. Throwing here would turn an undelivered
    // message into a red cron job, which is how people learn to ignore the job.
    const send = vi.fn().mockRejectedValue(new Error('bridge down'));
    const log = logger();
    const result = await sendProjectAoiDistortionAlert({
      rows: [INCIDENT], groupJid: 'ops@g.us', send, logger: log,
    });
    expect(result).toEqual({ alerted: false, flagged: [INCIDENT] });
    expect(log.error).toHaveBeenCalledWith(expect.stringContaining('bridge down'));
  });
});
