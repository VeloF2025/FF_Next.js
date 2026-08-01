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
const distinctCandidate = (index: number): PreparedCandidate => {
  const msisdn = `278${String(10_000_000 + index)}`;
  return {
    ...candidate(`DR${String(index + 1).padStart(4, '0')}`, index.toString(16).padStart(64, '0')),
    msisdn,
    phoneE164: `+${msisdn}`,
  };
};
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
    const item = context();
    const { deps } = oneDeps({ readbacks: [contact(item.export.exportKey, ['velocity-review-ready'])] });
    const result = await processOneExport(item, deps);
    expect(result).toMatchObject({ state: 'ambiguous', errorCode: 'stale_transient_tag' });
  });

  it('reports identity failure before stale tags when both checks fail', async () => {
    const mismatched = { ...contact('older-key', ['velocity-review-ready']), phone: '+27831112222' };
    const { deps } = oneDeps({ readbacks: [mismatched] });
    const result = await processOneExport(context(), deps);
    expect(result).toMatchObject({ state: 'ambiguous', errorCode: 'contact_verification_failed' });
    expect(deps.ghl.addTags).not.toHaveBeenCalled();
  });

  it('acknowledges only matching key plus enrolled plus absent ready, then cleans enrolled', async () => {
    const item = context();
    const { deps } = oneDeps({ readbacks: [contact(item.export.exportKey),
      contact(item.export.exportKey, ['velocity-review-enrolled'])] });
    const result = await processOneExport(item, deps);
    expect(result).toMatchObject({ state: 'completed', workflowAcknowledged: true });
    expect(deps.ghl.addTags).toHaveBeenCalledWith('contact-1', ['velocity-review-ready']);
    expect(deps.ghl.removeTags).toHaveBeenCalledWith('contact-1', ['velocity-review-enrolled']);
    const cleanupHandoff = vi.mocked(deps.exports.transitionExportState).mock.calls.find((call) =>
      call[2] === 'ack_cleanup_pending');
    expect(cleanupHandoff?.[3]).toMatchObject({
      workflowAcknowledgedAt: NOW, nextAttemptAt: new Date('2026-08-01T07:01:00Z'),
    });
    expect(vi.mocked(deps.exports.transitionExportState).mock.invocationCallOrder[2])
      .toBeLessThan(vi.mocked(deps.ghl.removeTags).mock.invocationCallOrder[0] as number);
  });

  it('schedules retryable acknowledgement cleanup without retriggering', async () => {
    const item = context(); const { deps } = oneDeps({ readbacks: [contact(item.export.exportKey),
      contact(item.export.exportKey, ['velocity-review-enrolled'])] });
    deps.ghl.removeTags = vi.fn(async () => { throw new HighLevelRequestError('busy', 503, true, false); });
    const result = await processOneExport(item, deps);
    expect(result).toMatchObject({ state: 'ack_cleanup_pending', errorCode: 'ack_cleanup_retryable',
      nextAttemptAt: new Date('2026-08-01T07:01:00Z'), workflowAcknowledged: true });
    expect(deps.ghl.addTags).toHaveBeenCalledTimes(1);
  });

  it('holds ambiguous acknowledgement cleanup without automatic retry', async () => {
    const item = context(); const { deps } = oneDeps({ readbacks: [contact(item.export.exportKey),
      contact(item.export.exportKey, ['velocity-review-enrolled'])] });
    deps.ghl.removeTags = vi.fn(async () => { throw new HighLevelRequestError('timeout', null, false, true); });
    const result = await processOneExport(item, deps);
    expect(result).toMatchObject({ state: 'ack_cleanup_pending', errorCode: 'ack_cleanup_ambiguous',
      nextAttemptAt: null, workflowAcknowledged: true });
  });

  it('holds permanent acknowledgement cleanup separately without automatic retry', async () => {
    const item = context(); const { deps } = oneDeps({ readbacks: [contact(item.export.exportKey),
      contact(item.export.exportKey, ['velocity-review-enrolled'])] });
    deps.ghl.removeTags = vi.fn(async () => { throw new HighLevelRequestError('rejected', 400, false, false); });
    const result = await processOneExport(item, deps);
    expect(result).toMatchObject({ state: 'ack_cleanup_pending', errorCode: 'ack_cleanup_permanent',
      nextAttemptAt: null, workflowAcknowledged: true });
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
      const row = { ...exportRow(value, value.drNumber), state: 'ready' as const, attemptCount: 0 };
      rows.set(row.id, row);
      events.push(`create:${value.drNumber}`); return { created: true, export: row };
    }), claimNextExport: vi.fn(async () => {
      const ready = [...rows.values()].find((row) => (row.state === 'ready'
        || (row.state === 'retryable_failure' && (row.nextAttemptAt?.getTime() ?? Infinity) <= deps.now().getTime()))
        && ![...rows.values()].some((held) =>
        held.phoneFingerprint === row.phoneFingerprint && held.id !== row.id && !['ready', 'completed', 'permanent_failure'].includes(held.state)));
      if (!ready) return null; const claimed = { ...ready, state: 'upserting' as const, attemptCount: ready.attemptCount + 1 };
      rows.set(claimed.id, claimed); events.push(`claim:${claimed.drNumber}`); return claimed;
    }), claimDueAcknowledgementCleanup: vi.fn(async () => null),
    transitionExportState: vi.fn(async (id, _expected, state, updates = {}) => {
      const changed = { ...rows.get(id)!, ...updates, state }; rows.set(id, changed); events.push(`${state}:${changed.drNumber}`); return changed;
    }) }, summary: { send: vi.fn(async () => true) },
  } as unknown as ProcessorDependencies;
  return { deps, events, rows };
}

describe('runVelocityReviewExport', () => {
  it('suppresses a completed duplicate without counting it as newly acknowledged or failed', async () => {
    const value = candidate();
    const { deps, rows } = runDeps([value]);
    const completed = {
      ...exportRow(value), state: 'completed' as const, completedAt: NOW,
      workflowAcknowledgedAt: NOW,
    };
    deps.exports.createExport = vi.fn(async () => {
      rows.set(completed.id, completed);
      return { created: false, export: completed };
    });

    const result = await runVelocityReviewExport({}, deps);

    expect(result.counts).toMatchObject({
      duplicates: 1,
      completed: 0,
      permanent_failure: 0,
      contacts_upserted: 0,
    });
    expect(deps.ghl.upsertContact).not.toHaveBeenCalled();
  });

  it('persists source, quarantine-reason, and actual contact-upsert totals', async () => {
    const ready = { ...candidate('DR001'), sources: ['dr_submitted', 'drops_installed'] as const };
    const { deps } = runDeps([ready]);
    const rows = [
      { dr_number: 'DR001', sources: ready.sources },
      { dr_number: 'DR002', sources: ['stock_installed'] },
      { dr_number: 'DR003', sources: ['stock_installed'] },
    ] as CandidateDbRow[];
    const decisions: CandidateDecision[] = [
      { status: 'ready', candidate: ready },
      { status: 'quarantined', drNumber: 'DR002', reason: 'no_safe_phone' },
      { status: 'quarantined', drNumber: 'DR003', reason: 'consent_missing' },
    ];
    deps.candidates.listCandidateRows = vi.fn(async () => rows);
    deps.candidates.prepareCandidate = vi.fn((row) => decisions.find((decision) =>
      (decision.status === 'ready' ? decision.candidate.drNumber : decision.drNumber) === row.dr_number)!);

    const output = await runVelocityReviewExport({}, deps);

    expect(output.counts).toMatchObject({
      candidate_total: 3,
      source_dr_submitted: 1,
      source_drops_installed: 1,
      source_stock_installed: 2,
      quarantine_no_safe_phone: 1,
      quarantine_consent_missing: 1,
      contacts_upserted: 1,
    });
    const persisted = vi.mocked(deps.runs.transitionRunStatus).mock.calls.at(-1)?.[3];
    expect(persisted).toMatchObject(output.counts);
  });

  it('waits for a minute-scale retry in the same invocation', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    try {
      const { deps } = runDeps([candidate()]);
      deps.now = () => new Date();
      deps.sleep = vi.fn(async (ms: number) => {
        vi.setSystemTime(new Date(Date.now() + ms));
      });
      let upserts = 0;
      let exportKey = '';
      let reads = 0;
      deps.ghl.upsertContact = vi.fn(async (input) => {
        upserts += 1;
        if (upserts === 1) throw new HighLevelRequestError('busy', 503, true, false);
        exportKey = input.exportKey;
        reads = 0;
        return contact(exportKey);
      });
      deps.ghl.getContact = vi.fn(async () =>
        contact(exportKey, reads++ === 0 ? [] : ['velocity-review-enrolled']));

      await expect(runVelocityReviewExport({}, deps)).resolves.toMatchObject({
        status: 'complete', counts: { completed: 1, contacts_upserted: 1 },
      });
      expect(deps.ghl.upsertContact).toHaveBeenCalledTimes(2);
      expect(deps.sleep).toHaveBeenCalledWith(60_000);
    } finally {
      vi.useRealTimers();
    }
  });

  it('bounds a large slow wave, preserves unclaimed exports, and never processes one export twice', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    try {
      const values = Array.from({ length: 60 }, (_, index) => distinctCandidate(index));
      const { deps, rows } = runDeps(values);
      deps.now = () => new Date();
      // This short fake-time budget exercises the same cutoff arithmetic as the
      // production 25-minute budget and three-minute drain reserve.
      deps.limits = { runBudgetMs: 60_000, contactDrainMs: 10_000 };

      let activeSleeps = 0;
      let maxActiveSleeps = 0;
      deps.sleep = vi.fn((ms: number) => new Promise<void>((resolve) => {
        activeSleeps += 1;
        maxActiveSleeps = Math.max(maxActiveSleeps, activeSleeps);
        setTimeout(() => {
          activeSleeps -= 1;
          resolve();
        }, ms);
      }));

      const readCounts = new Map<string, number>();
      const upsertedKeys: string[] = [];
      deps.ghl.upsertContact = vi.fn(async (input) => {
        upsertedKeys.push(input.exportKey);
        readCounts.set(input.exportKey, 0);
        return { ...contact(input.exportKey), id: `contact-${input.exportKey}`, phone: input.phoneE164 };
      });
      deps.ghl.getContact = vi.fn(async (contactId: string) => {
        const exportKey = contactId.replace(/^contact-/, '');
        const value = values.find((item) => `key-${item.drNumber}` === exportKey)!;
        const reads = readCounts.get(exportKey) ?? 0;
        readCounts.set(exportKey, reads + 1);
        return {
          ...contact(exportKey, reads === 0 ? [] : ['velocity-review-enrolled']),
          id: contactId,
          phone: value.phoneE164,
        };
      });

      const pending = runVelocityReviewExport({}, deps);
      await vi.runAllTimersAsync();
      const result = await pending;

      expect(result).toMatchObject({
        status: 'partial',
        counts: { completed: 40, deadline_deferred: 20, permanent_failure: 0 },
      });
      expect(maxActiveSleeps).toBe(4);
      expect(upsertedKeys).toHaveLength(40);
      expect(new Set(upsertedKeys).size).toBe(upsertedKeys.length);
      expect([...rows.values()].filter((row) => row.state === 'ready')).toHaveLength(20);
      expect((result.counts.completed ?? 0) + (result.counts.deadline_deferred ?? 0))
        .toBe(result.counts.candidate_total);
      expect(Date.now()).toBe(NOW.getTime() + 50_000);

      const laterClaims = await Promise.all(Array.from({ length: 4 },
        () => deps.exports.claimNextExport(deps.now(), [...rows.keys()])));
      const laterIds = laterClaims.flatMap((row) => row ? [row.id] : []);
      expect(laterIds).toHaveLength(4);
      expect(new Set(laterIds).size).toBe(laterIds.length);
    } finally {
      vi.useRealTimers();
    }
  });

  it('defers a retry beyond the claim cutoff without sleeping or spinning', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    try {
      const { deps, rows } = runDeps([candidate()]);
      deps.now = () => new Date();
      deps.limits = { runBudgetMs: 30_000, contactDrainMs: 10_000 };
      deps.sleep = vi.fn(async (ms: number) => {
        vi.setSystemTime(new Date(Date.now() + ms));
      });
      deps.ghl.upsertContact = vi.fn(async () => {
        throw new HighLevelRequestError('busy', 503, true, false);
      });

      const result = await runVelocityReviewExport({}, deps);

      expect(result).toMatchObject({
        status: 'partial',
        counts: { completed: 0, retryable: 1, deadline_deferred: 1 },
      });
      expect(deps.ghl.upsertContact).toHaveBeenCalledOnce();
      expect(deps.sleep).not.toHaveBeenCalled();
      expect(rows.get('DR001')).toMatchObject({
        state: 'retryable_failure', nextAttemptAt: new Date('2026-08-01T07:01:00Z'),
      });
      expect(Date.now()).toBe(NOW.getTime());
    } finally {
      vi.useRealTimers();
    }
  });

  it('drains claim attempts and processes a successful delayed claim before propagating a claim error', async () => {
    const claimError = new Error('claim failed');
    const { deps, rows, events } = runDeps([candidate()]);
    let releaseClaim!: () => void;
    const claimGate = new Promise<void>((resolve) => { releaseClaim = resolve; });
    let markDelayedClaimFinished!: () => void;
    const delayedClaimFinished = new Promise<void>((resolve) => { markDelayedClaimFinished = resolve; });
    let claimCalls = 0;
    deps.exports.claimNextExport = vi.fn(async () => {
      const call = claimCalls++;
      if (call === 0) throw claimError;
      if (call !== 1) return null;
      await claimGate;
      const ready = rows.get('DR001')!;
      const claimed = { ...ready, state: 'upserting' as const, attemptCount: ready.attemptCount + 1 };
      rows.set(claimed.id, claimed);
      events.push(`claim:${claimed.drNumber}`);
      markDelayedClaimFinished();
      return claimed;
    });

    let eventsAtSettlement = -1;
    const outcome = runVelocityReviewExport({}, deps).then(
      () => ({ status: 'resolved' as const, error: null }),
      (error: unknown) => {
        eventsAtSettlement = events.length;
        return { status: 'rejected' as const, error };
      },
    );
    await vi.waitFor(() => expect(deps.exports.claimNextExport).toHaveBeenCalledTimes(4));
    const beforeRelease = await Promise.race([
      outcome.then(() => 'settled' as const),
      new Promise<'waiting'>((resolve) => setTimeout(() => resolve('waiting'), 0)),
    ]);
    releaseClaim();
    await delayedClaimFinished;
    const final = await outcome;

    expect(beforeRelease).toBe('waiting');
    expect(final).toEqual({ status: 'rejected', error: claimError });
    expect(rows.get('DR001')).toMatchObject({ state: 'completed' });
    expect(deps.ghl.upsertContact).toHaveBeenCalledOnce();
    expect(events.length).toBe(eventsAtSettlement);
  });

  it('settles a delayed successful worker before propagating a sibling processing error', async () => {
    const workerError = new Error('worker transition failed');
    const values = [distinctCandidate(0), distinctCandidate(1)];
    const { deps, rows, events } = runDeps(values);
    const delayedKey = `key-${values[1].drNumber}`;
    let releaseWorker!: () => void;
    const workerGate = new Promise<void>((resolve) => { releaseWorker = resolve; });
    let markWorkerStarted!: () => void;
    const workerStarted = new Promise<void>((resolve) => { markWorkerStarted = resolve; });
    const readCounts = new Map<string, number>();
    const phones = new Map<string, string>();
    deps.ghl.upsertContact = vi.fn(async (input) => {
      phones.set(input.exportKey, input.phoneE164);
      readCounts.set(input.exportKey, 0);
      if (input.exportKey === delayedKey) {
        markWorkerStarted();
        await workerGate;
      }
      return { ...contact(input.exportKey), id: `contact-${input.exportKey}`, phone: input.phoneE164 };
    });
    deps.ghl.getContact = vi.fn(async (contactId: string) => {
      const exportKey = contactId.replace(/^contact-/, '');
      const reads = readCounts.get(exportKey) ?? 0;
      readCounts.set(exportKey, reads + 1);
      return {
        ...contact(exportKey, reads === 0 ? [] : ['velocity-review-enrolled']),
        id: contactId,
        phone: phones.get(exportKey)!,
      };
    });
    const transition = deps.exports.transitionExportState;
    deps.exports.transitionExportState = vi.fn(async (...args) => {
      if (args[0] === values[0].drNumber && args[2] === 'contact_upserted') throw workerError;
      return transition(...args);
    });

    let eventsAtSettlement = -1;
    const outcome = runVelocityReviewExport({}, deps).then(
      () => ({ status: 'resolved' as const, error: null }),
      (error: unknown) => {
        eventsAtSettlement = events.length;
        return { status: 'rejected' as const, error };
      },
    );
    await workerStarted;
    const beforeRelease = await Promise.race([
      outcome.then(() => 'settled' as const),
      new Promise<'waiting'>((resolve) => setTimeout(() => resolve('waiting'), 0)),
    ]);
    releaseWorker();
    const final = await outcome;

    expect(beforeRelease).toBe('waiting');
    expect(final).toEqual({ status: 'rejected', error: workerError });
    expect(rows.get(values[1].drNumber)).toMatchObject({ state: 'completed' });
    expect(deps.ghl.upsertContact).toHaveBeenCalledTimes(2);
    expect(events.length).toBe(eventsAtSettlement);
  });

  it('exits with a terminal failure when retry attempts are exhausted', async () => {
    const value = candidate();
    const { deps, rows } = runDeps([value]);
    const exhausted = { ...exportRow(value), state: 'ready' as const, attemptCount: 5 };
    deps.exports.createExport = vi.fn(async () => {
      rows.set(exhausted.id, exhausted);
      return { created: true, export: exhausted };
    });
    deps.ghl.upsertContact = vi.fn(async () => {
      throw new HighLevelRequestError('busy', 503, true, false);
    });

    await expect(runVelocityReviewExport({}, deps)).resolves.toMatchObject({
      status: 'complete',
      counts: { permanent_failure: 1, contacts_upserted: 0 },
    });
  });

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

  it('scopes pilot claims, leaves an older outside-date export untouched, and summarizes once', async () => {
    const { deps, rows } = runDeps([candidate('DR001', 'a'.repeat(64))], {
      automationEnabled: false, pilotEnabled: true, pilotTargetDate: '2026-07-30', pilotLimit: 1,
    });
    const outside = { ...exportRow(candidate('OUTSIDE', 'b'.repeat(64)), 'outside'), state: 'ready' as const,
      attemptCount: 0, firstTargetDate: '2026-07-29' };
    rows.set(outside.id, outside); const before = { ...outside };
    deps.exports.claimNextExport = vi.fn(async (_now, eligibleIds?: readonly string[]) => {
      const eligible = eligibleIds ?? [outside.id];
      const row = [...rows.values()].find((value) => eligible.includes(value.id) && value.state === 'ready');
      if (!row) return null;
      const claimed = { ...row, state: 'upserting' as const, attemptCount: row.attemptCount + 1 };
      rows.set(row.id, claimed); return claimed;
    });

    await expect(runVelocityReviewExport({}, deps)).resolves.toMatchObject({ status: 'pilot' });
    expect(rows.get(outside.id)).toEqual(before);
    expect(deps.summary.send).toHaveBeenCalledOnce();
    expect(deps.exports.claimNextExport).toHaveBeenCalledWith(NOW, ['DR001']);
  });

  it('runs due acknowledgement cleanup only without upsert or ready-tag addition', async () => {
    const value = candidate(); const { deps, rows } = runDeps([value]);
    const cleanup = { ...exportRow(value), state: 'ack_cleanup_pending' as const,
      attemptCount: 1, nextAttemptAt: new Date('2026-08-01T06:59:00Z'), ghlContactId: 'contact-1' };
    deps.exports.createExport = vi.fn(async () => { rows.set(cleanup.id, cleanup); return { created: false, export: cleanup }; });
    deps.exports.claimNextExport = vi.fn(async () => null);
    deps.exports.claimDueAcknowledgementCleanup = vi.fn(async (_now, _eligible, leaseUntil) => {
      const row = rows.get(cleanup.id);
      if (!row?.nextAttemptAt || row.nextAttemptAt > NOW) return null;
      const claimed = { ...row, attemptCount: row.attemptCount + 1, nextAttemptAt: leaseUntil };
      rows.set(row.id, claimed); return claimed;
    });

    await expect(runVelocityReviewExport({}, deps)).resolves.toMatchObject({ status: 'complete' });
    expect(deps.ghl.upsertContact).not.toHaveBeenCalled();
    expect(deps.ghl.addTags).not.toHaveBeenCalled();
    expect(deps.ghl.removeTags).toHaveBeenCalledWith('contact-1', ['velocity-review-enrolled']);
    expect(deps.runs.withVelocityReviewLock).toHaveBeenCalledOnce();
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
    const claims = events.filter((event) => event.startsWith('claim:'));
    expect(claims[0]).toBe('claim:DR001');
    expect(claims.filter((event) => event === 'claim:DR001')).toHaveLength(2);
    expect(claims.filter((event) => event === 'claim:DR002')).toHaveLength(1);
  });
});
