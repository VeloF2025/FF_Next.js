/**
 * resolveCurrentProject — ask a worker their project, but only when we don't
 * already know it from today.
 *
 * The failure to avoid in both directions:
 *  - asking someone who already answered in the morning check-in (nagging)
 *  - trusting staff.declared_project_id, set once at registration and measured
 *    stale for 5 of 15 technicians on 2026-08-21
 */
import { describe, it, expect } from 'vitest';
import { resolveCurrentProject } from '../currentProject';

describe('resolveCurrentProject', () => {
  it("does NOT ask when today's check-in already answered it", () => {
    expect(resolveCurrentProject({ checkinTodayProjectId: 'p-lawley' })).toEqual({
      projectId: 'p-lawley', source: 'checkin-today', shouldAsk: false,
    });
  });

  it('prefers the check-in over everything else, even a fresh declaration', () => {
    // The check-in is geofenced; a portal declaration is typed.
    expect(
      resolveCurrentProject({
        checkinTodayProjectId: 'p-lawley',
        declaredTodayProjectId: 'p-mohadin',
        standingDeclarationProjectId: 'p-etwatwa',
      }),
    ).toMatchObject({ projectId: 'p-lawley', source: 'checkin-today' });
  });

  it("does NOT ask again once the worker declared today in the portal", () => {
    expect(resolveCurrentProject({ declaredTodayProjectId: 'p-mohadin' })).toEqual({
      projectId: 'p-mohadin', source: 'declared-today', shouldAsk: false,
    });
  });

  it('ASKS when only a standing registration-time declaration exists', () => {
    // This is the field that was wrong for a third of the workers checked, so
    // it pre-fills the answer but never silences the question.
    expect(resolveCurrentProject({ standingDeclarationProjectId: 'p-etwatwa' })).toEqual({
      projectId: 'p-etwatwa', source: 'stale-declaration', shouldAsk: true,
    });
  });

  it('ASKS when nothing is known at all', () => {
    expect(resolveCurrentProject({})).toEqual({
      projectId: null, source: 'none', shouldAsk: true,
    });
  });

  it('treats null and undefined signals the same as absent', () => {
    expect(
      resolveCurrentProject({
        checkinTodayProjectId: null,
        declaredTodayProjectId: null,
        standingDeclarationProjectId: null,
      }),
    ).toMatchObject({ projectId: null, shouldAsk: true });
  });

  it('never reports shouldAsk=false without a project to show for it', () => {
    // A silent prompt AND no project would leave the picker with nothing.
    for (const signals of [
      {}, { standingDeclarationProjectId: 'p' }, { checkinTodayProjectId: 'p' },
      { declaredTodayProjectId: 'p' },
    ]) {
      const r = resolveCurrentProject(signals);
      if (!r.shouldAsk) expect(r.projectId).not.toBeNull();
    }
  });
});
