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

  it('ASKS a field worker when nothing is known today', () => {
    expect(resolveCurrentProject({ hasEverCheckedInOnProject: true })).toEqual({
      projectId: null, source: 'none', shouldAsk: true,
    });
  });

  it('does NOT ask someone who does no field work', () => {
    // The shell renders this on EVERY /my page for EVERY role. An office worker
    // fetching a payslip must not be asked which project they are on, nor be
    // able to write junk into the field the stores flow depends on.
    expect(resolveCurrentProject({})).toEqual({
      projectId: null, source: 'none', shouldAsk: false,
    });
  });

  it('treats a standing declaration as evidence of field work', () => {
    // Someone declared a project at registration: the question means something
    // to them even if they have never used the H&S check-in.
    expect(resolveCurrentProject({ standingDeclarationProjectId: 'p-lawley' })).toMatchObject({
      shouldAsk: true,
    });
  });

  it('does not gate on ROLE, which is unreliable here', () => {
    // 89 staff rows have a NULL role, 18 of them do field work; `stores` and
    // `supervisor` do none. Behaviour decides, and this function is never told
    // a role at all — asserted by the absence of any role field in the input.
    const asked = resolveCurrentProject({ hasEverCheckedInOnProject: true });
    const notAsked = resolveCurrentProject({ hasEverCheckedInOnProject: false });
    expect(asked.shouldAsk).toBe(true);
    expect(notAsked.shouldAsk).toBe(false);
  });

  it('treats null and undefined signals the same as absent', () => {
    expect(
      resolveCurrentProject({
        checkinTodayProjectId: null,
        declaredTodayProjectId: null,
        standingDeclarationProjectId: null,
        hasEverCheckedInOnProject: true,
      }),
    ).toMatchObject({ projectId: null, shouldAsk: true });
  });

  it('stays silent with no project ONLY for someone who does no field work', () => {
    // Staying quiet while holding no project is correct for office staff and
    // wrong for a field worker — for them it would mean the picker has nothing
    // and nobody was ever asked to fix that.
    const cases: Array<[Record<string, unknown>, boolean]> = [
      [{}, false],                                        // office: silent, no project — fine
      [{ hasEverCheckedInOnProject: true }, true],         // field worker: must be asked
      [{ standingDeclarationProjectId: 'p' }, true],
      [{ checkinTodayProjectId: 'p' }, false],
      [{ declaredTodayProjectId: 'p' }, false],
    ];
    for (const [signals, expectAsk] of cases) {
      const r = resolveCurrentProject(signals);
      expect(r.shouldAsk).toBe(expectAsk);
      const doesFieldWork =
        signals.hasEverCheckedInOnProject === true || !!signals.standingDeclarationProjectId;
      if (!r.shouldAsk && doesFieldWork) expect(r.projectId).not.toBeNull();
    }
  });
});
