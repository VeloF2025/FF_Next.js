import { describe, expect, it, vi } from 'vitest';
import { HighLevelRequestError, type HighLevelContact } from '../ghlClient';
import {
  processOneExport,
  runVelocityReviewExport,
  type ProcessableExport,
  type ProcessorDependencies,
} from '../processor';
import type { VelocityReviewExport } from '../exportRepository';
import type { CandidateDbRow, CandidateDecision, PreparedCandidate } from '../types';

const NOW = new Date('2026-08-01T07:00:00.000Z');
const candidate = (drNumber = 'DR001', fingerprint = 'a'.repeat(64)): PreparedCandidate => ({
  drNumber, sources: ['dr_submitted'], msisdn: '27821234567', phoneE164: '+27821234567',
  phoneFingerprint: fingerprint, phoneSource: 'onemap', firstName: 'Ada', lastName: 'Lovelace',
  consentEvidence: { source: 'onemap_home_signup', grantedAt: new Date('2026-07-31T08:00:00Z') },
});
const exportRow = (value = candidate(), id = value.drNumber): VelocityReviewExport => ({
  id, firstRunId: 'run-1', firstTargetDate: '2026-07-31', drNumber: value.drNumber,
  phoneE164: value.phoneE164, phoneFingerprint: value.phoneFingerprint, phoneSource: value.phoneSource,
  sourceFlags: value.sources, exportKey: `key-${value.drNumber}`, ghlContactId: null, state: 'upserting',
  attemptCount: 1, nextAttemptAt: null, errorCode: null, upsertedAt: null, triggerRequestedAt: null,
  workflowAcknowledgedAt: null, completedAt: null, createdAt: NOW, updatedAt: NOW,
});
const context = (value = candidate(), id?: string): ProcessableExport => ({
  export: exportRow(value, id), candidate: value,
});
const contact = (key: string, tags: string[] = [], dnd = false): HighLevelContact => ({
  id: 'contact-1', phone: '+27821234567', tags, customFields: { export: key }, whatsappDndBlocked: dnd,
});

function oneDeps(options: { consent?: 'granted' | 'withdrawn'; readbacks?: HighLevelContact[];
  upsertError?: HighLevelRequestError; addError?: HighLevelRequestError } = {}) {
  const events: string[] = [];
  let current = context().export;
  const readbacks = [...(options.readbacks ?? [contact(current.exportKey),
    contact(current.exportKey, ['velocity-review-enrolled'])])];
  const deps = {
    now: () => NOW, sleep: vi.fn(async () => undefined), exportKeyFieldId: 'export',
    consent: { recordOneMapConsent: vi.fn(async () => { events.push('consent'); return options.consent ?? 'granted'; }) },
    ghl: {
      upsertContact: vi.fn(async () => { events.push('upsert'); if (options.upsertError) throw options.upsertError;
        return contact(current.exportKey); }),
      getContact: vi.fn(async () => readbacks.shift() ?? contact(current.exportKey)),
      addTags: vi.fn(async () => { if (options.addError) throw options.addError; }),
      removeTags: vi.fn(async () => undefined),
    },
    exports: { transitionExportState: vi.fn(async (_id, _expected, next, updates = {}) => {
      current = { ...current, ...updates, state: next }; return current;
    }) },
  } as unknown as ProcessorDependencies;
  return { deps, events };
}

describe('processOneExport', () => {
  it('records and reads granted OneMap consent before the first GHL call', async () => {
    const { deps, events } = oneDeps();
    await processOneExport(context(), deps);
    expect(events).toEqual(['consent', 'upsert']);
  });

  it('fails permanently on withdrawn consent without calling GHL', async () => {
    const { deps } = oneDeps({ consent: 'withdrawn' });
    const result = await processOneExport(context(), deps);
    expect(result).toMatchObject({ state: 'permanent_failure', errorCode: 'consent_withdrawn' });
    expect(deps.ghl.upsertContact).not.toHaveBeenCalled();
  });

  it('retries a consent-store outage without calling GHL', async () => {
    const { deps } = oneDeps();
    deps.consent.recordOneMapConsent = vi.fn(async () => { throw new Error('database unavailable'); });
    const result = await processOneExport(context(), deps);
    expect(result).toMatchObject({ state: 'retryable_failure', errorCode: 'consent_verification_failed',
      nextAttemptAt: new Date('2026-08-01T07:01:00Z') });
    expect(deps.ghl.upsertContact).not.toHaveBeenCalled();
  });

  it('preserves candidate names and sends all four exact contact values', async () => {
    const { deps } = oneDeps();
    await processOneExport(context(), deps);
    expect(deps.ghl.upsertContact).toHaveBeenCalledWith({ phoneE164: '+27821234567', firstName: 'Ada',
      lastName: 'Lovelace', drNumber: 'DR001', eventDate: '2026-07-31', sources: ['dr_submitted'],
      exportKey: 'key-DR001' });
  });

  it('fails permanently on WhatsApp DND before adding a tag', async () => {
    const item = context();
    const { deps } = oneDeps({ readbacks: [contact(item.export.exportKey, [], true)] });
    const result = await processOneExport(item, deps);
    expect(result).toMatchObject({ state: 'permanent_failure', errorCode: 'ghl_whatsapp_dnd' });
    expect(deps.ghl.addTags).not.toHaveBeenCalled();
  });

  it('holds a contact with another export transient tag as ambiguous', async () => {
    const { deps } = oneDeps({ readbacks: [contact('older-key', ['velocity-review-ready'])] });
    const result = await processOneExport(context(), deps);
    expect(result).toMatchObject({ state: 'ambiguous', errorCode: 'stale_transient_tag' });
  });

  it('acknowledges only matching key plus enrolled plus absent ready, then cleans enrolled', async () => {
    const item = context();
    const { deps } = oneDeps({ readbacks: [contact(item.export.exportKey),
      contact(item.export.exportKey, ['velocity-review-enrolled'])] });
    const result = await processOneExport(item, deps);
    expect(result).toMatchObject({ state: 'completed', workflowAcknowledged: true });
    expect(deps.ghl.addTags).toHaveBeenCalledWith('contact-1', ['velocity-review-ready']);
    expect(deps.ghl.removeTags).toHaveBeenCalledWith('contact-1', ['velocity-review-enrolled']);
  });

  it('holds a timed-out tag addition as ambiguous without retry time', async () => {
    const error = new HighLevelRequestError('timeout', null, false, true);
    const { deps } = oneDeps({ addError: error });
    const result = await processOneExport(context(), deps);
    expect(result).toMatchObject({ state: 'ambiguous', errorCode: 'tag_add_ambiguous', nextAttemptAt: null });
  });

  it('polls every five seconds for at most thirty seconds before holding acknowledgement', async () => {
    const item = context();
    const { deps } = oneDeps({ readbacks: [contact(item.export.exportKey)] });
    const result = await processOneExport(item, deps);
    expect(result).toMatchObject({ state: 'ambiguous', errorCode: 'workflow_acknowledgement_timeout' });
    expect(deps.sleep).toHaveBeenCalledTimes(6);
    expect(deps.sleep).toHaveBeenCalledWith(5_000);
  });

  it('schedules bounded backoff after a retryable upsert', async () => {
    const error = new HighLevelRequestError('busy', 503, true, false);
    const { deps } = oneDeps({ upsertError: error });
    const result = await processOneExport(context(), deps);
    expect(result).toMatchObject({ state: 'retryable_failure', nextAttemptAt: new Date('2026-08-01T07:01:00Z') });
  });
});

function runDeps(values: PreparedCandidate[], control: Partial<{
  automationEnabled: boolean; goLiveDate: string | null; pilotEnabled: boolean;
  pilotTargetDate: string | null; pilotLimit: number | null;
}> = {}) {
  const events: string[] = []; const rows = new Map<string, VelocityReviewExport>();
  const decisions = values.map((value): CandidateDecision => ({ status: 'ready', candidate: value }));
  const deps = {
    ...oneDeps().deps, now: () => NOW, exportKeyFieldId: 'export',
    candidates: { listCandidateRows: vi.fn(async () => decisions.map((decision) => ({
      dr_number: decision.status === 'ready' ? decision.candidate.drNumber : '',
    } as CandidateDbRow))), prepareCandidate: vi.fn((row: CandidateDbRow) => decisions.find((decision) =>
      decision.status === 'ready' && decision.candidate.drNumber === row.dr_number) as CandidateDecision) },
    runs: { withVelocityReviewLock: vi.fn(async (work: () => Promise<unknown>) => ({ acquired: true, value: await work() })),
      loadVelocityReviewControl: vi.fn(async () => ({ automationEnabled: true, goLiveDate: '2026-07-31',
        pilotEnabled: false, pilotTargetDate: null, pilotLimit: null, ...control })),
      listCompletedRunDates: vi.fn(async () => new Set<string>()), createOrResumeRun: vi.fn(async (date: string) =>
        ({ id: `run-${date}`, targetDate: date, status: 'pending', startedAt: null, completedAt: null, counts: {}, summaryStatus: 'pending' })),
      transitionRunStatus: vi.fn(async () => null) },
    exports: { saveCandidateDecision: vi.fn(async () => undefined), createExport: vi.fn(async (_run, value) => {
      const row = { ...exportRow(value, value.drNumber), state: 'ready' as const }; rows.set(row.id, row);
      events.push(`create:${value.drNumber}`); return { created: true, export: row };
    }), claimNextExport: vi.fn(async () => {
      const ready = [...rows.values()].find((row) => (row.state === 'ready'
        || (row.state === 'retryable_failure' && (row.nextAttemptAt?.getTime() ?? Infinity) <= deps.now().getTime()))
        && ![...rows.values()].some((held) =>
        held.phoneFingerprint === row.phoneFingerprint && held.id !== row.id && !['ready', 'completed', 'permanent_failure'].includes(held.state)));
      if (!ready) return null; const claimed = { ...ready, state: 'upserting' as const, attemptCount: ready.attemptCount + 1 };
      rows.set(claimed.id, claimed); events.push(`claim:${claimed.drNumber}`); return claimed;
    }), transitionExportState: vi.fn(async (id, _expected, state, updates = {}) => {
      const changed = { ...rows.get(id)!, ...updates, state }; rows.set(id, changed); events.push(`${state}:${changed.drNumber}`); return changed;
    }) }, summary: { send: vi.fn(async () => true) },
  } as unknown as ProcessorDependencies;
  return { deps, events };
}

describe('runVelocityReviewExport', () => {
  it('processes same-phone different-DR exports sequentially instead of collapsing them', async () => {
    const { deps, events } = runDeps([candidate('DR002'), candidate('DR001')]);
    await runVelocityReviewExport({}, deps);
    expect(events.filter((event) => event.startsWith('claim:'))).toEqual(['claim:DR001', 'claim:DR002']);
  });

  it('dry-run performs only candidate discovery and preparation', async () => {
    const { deps } = runDeps([candidate()]);
    const result = await runVelocityReviewExport({ dryRun: true, targetDate: '2026-07-31' }, deps);
    expect(result.status).toBe('dry_run');
    expect(deps.candidates.listCandidateRows).toHaveBeenCalledOnce();
    expect(deps.runs.withVelocityReviewLock).not.toHaveBeenCalled();
    expect(deps.exports.saveCandidateDecision).not.toHaveBeenCalled();
    expect(deps.ghl.upsertContact).not.toHaveBeenCalled();
    expect(deps.summary.send).not.toHaveBeenCalled();
  });

  it('pilot limits canonical DR creation and reports every deferred ready candidate', async () => {
    const { deps, events } = runDeps([candidate('DR010'), candidate('DR002'), candidate('DR001')], {
      automationEnabled: false, pilotEnabled: true, pilotTargetDate: '2026-07-30', pilotLimit: 2,
    });
    const result = await runVelocityReviewExport({}, deps);
    expect(events.filter((event) => event.startsWith('create:'))).toEqual(['create:DR001', 'create:DR002']);
    expect(deps.candidates.listCandidateRows).toHaveBeenCalledWith('2026-07-30');
    expect(deps.exports.saveCandidateDecision).toHaveBeenCalledTimes(3);
    expect(result.counts.pilot_deferred).toBe(1);
  });

  it('leaves a second same-phone DR unclaimed for retryable, ambiguous, and cleanup states', async () => {
    for (const blocked of ['retryable_failure', 'ambiguous', 'ack_cleanup_pending'] as const) {
      const { deps, events } = runDeps([candidate('DR001'), candidate('DR002')]);
      if (blocked === 'retryable_failure') deps.ghl.upsertContact = vi.fn(async () => {
        throw new HighLevelRequestError('busy', 503, true, false);
      });
      if (blocked === 'ambiguous') deps.ghl.addTags = vi.fn(async () => {
        throw new HighLevelRequestError('timeout', null, false, true);
      });
      if (blocked === 'ack_cleanup_pending') deps.ghl.removeTags = vi.fn(async () => { throw new Error('cleanup'); });
      await runVelocityReviewExport({}, deps);
      expect(events.filter((event) => event.startsWith('claim:')), blocked).toEqual(['claim:DR001']);
      expect(events, blocked).toContain(`${blocked}:DR001`);
    }
  });

  it('retains candidate evidence when an earlier-date retry becomes due during catch-up', async () => {
    const one = candidate('DR001', 'a'.repeat(64)); const two = candidate('DR002', 'b'.repeat(64));
    const { deps, events } = runDeps([one, two], { goLiveDate: '2026-07-30' });
    let clock = NOW; deps.now = () => clock;
    deps.candidates.listCandidateRows = vi.fn(async (date) =>
      [{ dr_number: date === '2026-07-30' ? 'DR001' : 'DR002' } as CandidateDbRow]);
    deps.candidates.prepareCandidate = vi.fn((row) => ({ status: 'ready',
      candidate: row.dr_number === 'DR001' ? one : two }));
    const transition = deps.exports.transitionExportState;
    deps.exports.transitionExportState = vi.fn(async (...args) => {
      const changed = await transition(...args);
      if (args[2] === 'retryable_failure') clock = new Date(NOW.getTime() + 120_000);
      return changed;
    });
    let first = true; let activeKey = ''; let reads = 0;
    deps.ghl.upsertContact = vi.fn(async (input) => {
      if (first) { first = false; throw new HighLevelRequestError('busy', 503, true, false); }
      activeKey = input.exportKey; reads = 0; return contact(activeKey);
    });
    deps.ghl.getContact = vi.fn(async () => contact(activeKey, reads++ === 0 ? [] : ['velocity-review-enrolled']));
    await expect(runVelocityReviewExport({}, deps)).resolves.toMatchObject({ status: 'complete' });
    expect(events.filter((event) => event.startsWith('claim:'))).toEqual(['claim:DR001', 'claim:DR001', 'claim:DR002']);
  });
});
