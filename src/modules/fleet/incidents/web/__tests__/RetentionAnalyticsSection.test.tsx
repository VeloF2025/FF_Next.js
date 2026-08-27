/** @vitest-environment jsdom */
/**
 * The PR8 analytics/retention section of the incident settings dialog.
 *
 * Compact in the same way `DriverInputSection` is: it edits the numbers a
 * manager actually tunes and passes the rest of the policy through unchanged,
 * because versioning requires the full shape.
 *
 * The assertions that matter are about the one field that destroys data.
 * Shortening the retention window makes every incident between the new cutoff
 * and the old one deletable at the next purge, so the section warns, demands a
 * dry run to point at, and refuses to send without one.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ get: vi.fn(), save: vi.fn() }));
vi.mock('@/lib/logger', () => ({ log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }));
vi.mock('../retentionSettingsApi', () => ({
  retentionSettingsApi: { get: mocks.get, version: mocks.save },
}));

import { RetentionAnalyticsSection } from '../RetentionAnalyticsSection';
import { IncidentApiError } from '../incidentApi';

const POLICY = {
  version: 4, effectiveFrom: '2026-01-01T00:00:00.000Z', retentionMonths: 12,
  anonymityMinContributors: 5, recalculationWindowMonths: 3, retentionBatchSize: 100,
  maximumHoldReviewDays: 90, holdReviewReminderLeadDays: 14,
  aggregationRunHourSast: 1, aggregationRunMinuteSast: 0,
  retentionRunHourSast: 3, retentionRunMinuteSast: 30,
  aggregateFreshnessWarningHours: 36, retentionFreshnessWarningHours: 48,
  permittedHoldCategories: ['legal', 'accident'], metricVersion: 1, liveRetentionEnabled: false,
};

async function flush(): Promise<void> {
  await act(async () => { for (let tick = 0; tick < 5; tick += 1) await Promise.resolve(); });
}

async function renderSection(canEdit = true, policy: unknown = POLICY) {
  mocks.get.mockResolvedValue(policy);
  render(<RetentionAnalyticsSection canEdit={canEdit} />);
  await flush();
}

/** Fills the change reason, which every save requires. */
function withReason(text = 'Quarterly review'): void {
  fireEvent.change(screen.getByLabelText('Retention settings change reason'), { target: { value: text } });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.save.mockResolvedValue({ ...POLICY, version: 5 });
});

describe('RetentionAnalyticsSection', () => {
  it('summarises the policy in force', async () => {
    await renderSection(false);
    const section = await screen.findByLabelText('Analytics and retention settings');
    expect(section.textContent).toContain('12');
    expect(section.textContent).toMatch(/version 4/i);
  });

  it('offers no controls to a viewer who cannot edit', async () => {
    await renderSection(false);
    expect(screen.queryByLabelText('Retention months')).toBeNull();
    expect(screen.queryByTestId('retention-save')).toBeNull();
  });

  it('prefills every editable field from the policy', async () => {
    await renderSection();
    expect((screen.getByLabelText('Retention months') as HTMLInputElement).value).toBe('12');
    expect((screen.getByLabelText('Anonymity threshold') as HTMLInputElement).value).toBe('5');
    expect((screen.getByLabelText('Recalculation window months') as HTMLInputElement).value).toBe('3');
    expect((screen.getByLabelText('Retention batch size') as HTMLInputElement).value).toBe('100');
    expect((screen.getByLabelText('Maximum hold review days') as HTMLInputElement).value).toBe('90');
    expect((screen.getByLabelText('Hold review reminder lead days') as HTMLInputElement).value).toBe('14');
  });

  it('will not save without a change reason', async () => {
    await renderSection();
    await act(async () => { screen.getByTestId('retention-save').click(); });
    await flush();
    expect(mocks.save).not.toHaveBeenCalled();
  });

  /**
   * Versioning takes the whole policy, so anything the section does not expose
   * has to travel through untouched. Dropping a field would quietly rewrite it
   * to whatever the request omitted.
   */
  it('passes the fields it does not expose through unchanged', async () => {
    await renderSection();
    withReason();
    await act(async () => { screen.getByTestId('retention-save').click(); });
    await flush();
    expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({
      permittedHoldCategories: ['legal', 'accident'],
      metricVersion: 1,
      liveRetentionEnabled: false,
      aggregateFreshnessWarningHours: 36,
      retentionFreshnessWarningHours: 48,
    }));
  });

  it('sends the edited numbers as numbers, not strings', async () => {
    await renderSection();
    fireEvent.change(screen.getByLabelText('Recalculation window months'), { target: { value: '6' } });
    withReason();
    await act(async () => { screen.getByTestId('retention-save').click(); });
    await flush();
    expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({ recalculationWindowMonths: 6 }));
  });

  it('sends an effective timestamp in the future', async () => {
    await renderSection();
    withReason();
    await act(async () => { screen.getByTestId('retention-save').click(); });
    await flush();
    const sent = mocks.save.mock.calls.at(-1)?.[0] as { effectiveFrom: string };
    expect(Date.parse(sent.effectiveFrom)).toBeGreaterThan(Date.now());
  });

  describe('shortening the retention window', () => {
    async function shortenTo(months: string): Promise<void> {
      fireEvent.change(screen.getByLabelText('Retention months'), { target: { value: months } });
      await flush();
    }

    it('warns as soon as the number is reduced, before anything is saved', async () => {
      await renderSection();
      await shortenTo('6');
      const warning = await screen.findByTestId('retention-shorten-warning');
      expect(warning.textContent).toMatch(/12/);
      expect(warning.textContent).toMatch(/6/);
      expect(mocks.save).not.toHaveBeenCalled();
    });

    it('refuses to save a shortening with no dry run named', async () => {
      await renderSection();
      await shortenTo('6');
      withReason();
      await act(async () => { screen.getByTestId('retention-save').click(); });
      await flush();
      expect(mocks.save).not.toHaveBeenCalled();
    });

    it('sends the acknowledged dry run once one is given', async () => {
      await renderSection();
      await shortenTo('6');
      withReason();
      fireEvent.change(screen.getByLabelText('Acknowledged dry run id'), { target: { value: 'run-77' } });
      await act(async () => { screen.getByTestId('retention-save').click(); });
      await flush();
      expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({
        retentionMonths: 6, acknowledgedDryRunId: 'run-77',
      }));
    });

    /** Lengthening makes nothing newly deletable, so it asks for nothing extra. */
    it('asks for no acknowledgement when the window is lengthened', async () => {
      await renderSection();
      fireEvent.change(screen.getByLabelText('Retention months'), { target: { value: '24' } });
      await flush();
      expect(screen.queryByTestId('retention-shorten-warning')).toBeNull();
      withReason();
      await act(async () => { screen.getByTestId('retention-save').click(); });
      await flush();
      expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({ retentionMonths: 24 }));
    });

    it('sends no dry run field when nothing was shortened', async () => {
      await renderSection();
      withReason();
      await act(async () => { screen.getByTestId('retention-save').click(); });
      await flush();
      const sent = mocks.save.mock.calls.at(-1)?.[0] as Record<string, unknown>;
      expect(sent.acknowledgedDryRunId ?? null).toBeNull();
    });
  });

  it('reports a refused save in the server words', async () => {
    await renderSection();
    mocks.save.mockRejectedValue(new IncidentApiError('effectiveFrom must be after the version it replaces', 400, 'BAD_REQUEST'));
    withReason();
    await act(async () => { screen.getByTestId('retention-save').click(); });
    await flush();
    expect((await screen.findByRole('alert')).textContent).toContain('after the version it replaces');
  });

  it('shows a load failure rather than an empty section', async () => {
    mocks.get.mockRejectedValue(new IncidentApiError('connection reset', 500, 'INTERNAL'));
    render(<RetentionAnalyticsSection canEdit />);
    await flush();
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.queryByTestId('retention-save')).toBeNull();
  });

  /**
   * The dark-only amber-900/20 + amber-300 this pair replaced measured
   * ~1.02:1 against a light background — invisible, not merely faint.
   * `CheckInSummary.tsx` proves the fix reads correctly in both themes for
   * the same amber-family warning, so the shorten warning is asserted
   * against that exact token set rather than a fresh judgement call.
   */
  describe('shorten-warning contrast (source parity with CheckInSummary.tsx)', () => {
    const proven = readFileSync(
      resolve(__dirname, '../../../check-in/components/CheckInSummary.tsx'), 'utf8',
    );
    const section = readFileSync(resolve(__dirname, '../RetentionAnalyticsSection.tsx'), 'utf8');

    it.each([
      'bg-amber-50', 'dark:bg-amber-900/20', 'text-amber-700', 'dark:text-amber-400',
    ])('uses the proven %s pair, not a dark-only token', (token) => {
      expect(proven).toContain(token);
      expect(section).toContain(token);
    });

    it('does not regress to the dark-only amber-300/amber-900 pair with no light variant', () => {
      expect(section).not.toMatch(/border-amber-700\b/);
      expect(section).not.toMatch(/\btext-amber-300\b/);
    });
  });

  describe('blank retention months', () => {
    it('shows no shorten warning while the field is blank', async () => {
      await renderSection();
      fireEvent.change(screen.getByLabelText('Retention months'), { target: { value: '' } });
      await flush();
      expect(screen.queryByTestId('retention-shorten-warning')).toBeNull();
    });

    it('disables save while retention months is blank', async () => {
      await renderSection();
      fireEvent.change(screen.getByLabelText('Retention months'), { target: { value: '' } });
      withReason();
      await flush();
      expect(screen.getByTestId('retention-save')).toBeDisabled();
    });

    it('never sends a request with retentionMonths blank or zero', async () => {
      await renderSection();
      fireEvent.change(screen.getByLabelText('Retention months'), { target: { value: '' } });
      withReason();
      await act(async () => { screen.getByTestId('retention-save').click(); });
      await flush();
      expect(mocks.save).not.toHaveBeenCalled();
    });
  });

  describe('server-mirrored floors', () => {
    it('disables save when the anonymity threshold drops below the server floor of 5', async () => {
      await renderSection();
      fireEvent.change(screen.getByLabelText('Anonymity threshold'), { target: { value: '4' } });
      withReason();
      await flush();
      expect(screen.getByTestId('retention-save')).toBeDisabled();
    });

    it('allows the anonymity threshold at exactly the server floor of 5', async () => {
      await renderSection();
      fireEvent.change(screen.getByLabelText('Anonymity threshold'), { target: { value: '5' } });
      withReason();
      await flush();
      expect(screen.getByTestId('retention-save')).not.toBeDisabled();
    });

    it('disables save when the hold review reminder lead exceeds the maximum hold review days', async () => {
      await renderSection();
      fireEvent.change(screen.getByLabelText('Hold review reminder lead days'), { target: { value: '91' } });
      withReason();
      await flush();
      expect(screen.getByTestId('retention-save')).toBeDisabled();
    });

    it('allows the hold review reminder lead exactly at the maximum hold review days', async () => {
      await renderSection();
      fireEvent.change(screen.getByLabelText('Hold review reminder lead days'), { target: { value: '90' } });
      withReason();
      await flush();
      expect(screen.getByTestId('retention-save')).not.toBeDisabled();
    });
  });

  /**
   * Every field mirrors the server's CHECK ceiling too (migration 518), not
   * just its floor. `retentionMonths` exercises the one that matters most:
   * blowing past 120 would otherwise 500 on save naming a constraint instead
   * of disabling the button.
   */
  describe('server-mirrored ceilings', () => {
    it('disables save when retention months exceeds the server ceiling of 120', async () => {
      await renderSection();
      fireEvent.change(screen.getByLabelText('Retention months'), { target: { value: '121' } });
      withReason();
      await flush();
      expect(screen.getByTestId('retention-save')).toBeDisabled();
    });

    it('allows retention months at exactly the server ceiling of 120', async () => {
      await renderSection();
      fireEvent.change(screen.getByLabelText('Retention months'), { target: { value: '120' } });
      withReason();
      await flush();
      expect(screen.getByTestId('retention-save')).not.toBeDisabled();
    });
  });

  /**
   * `isValidWhole`'s `trimmed !== ''` clause is the only thing stopping a
   * blank min-0 field (the two SAST hour/minute fields floor at 0, not 1)
   * from validating as 0 — `Number('')` coerces to 0, which is itself a
   * legal value. Without that clause, a blank hour would silently save the
   * aggregation run at midnight instead of disabling save. Regressed once in
   * round-1 review; this is the missing regression test.
   */
  describe('blank min-0 field (aggregation run hour)', () => {
    it('disables save when aggregation run hour is left blank, not treated as midnight', async () => {
      await renderSection();
      fireEvent.change(screen.getByLabelText('Aggregation run hour (SAST)'), { target: { value: '' } });
      withReason();
      await flush();
      expect(screen.getByTestId('retention-save')).toBeDisabled();
    });

    it('never sends a request with aggregation run hour blank', async () => {
      await renderSection();
      fireEvent.change(screen.getByLabelText('Aggregation run hour (SAST)'), { target: { value: '' } });
      withReason();
      await act(async () => { screen.getByTestId('retention-save').click(); });
      await flush();
      expect(mocks.save).not.toHaveBeenCalled();
    });
  });

  describe('the integer guard in `valid`', () => {
    it('disables save when a field is left blank', async () => {
      await renderSection();
      fireEvent.change(screen.getByLabelText('Retention batch size'), { target: { value: '' } });
      withReason();
      await flush();
      expect(screen.getByTestId('retention-save')).toBeDisabled();
    });

    it('disables save when a field holds a fractional value', async () => {
      await renderSection();
      fireEvent.change(screen.getByLabelText('Retention batch size'), { target: { value: '1.5' } });
      withReason();
      await flush();
      expect(screen.getByTestId('retention-save')).toBeDisabled();
    });
  });
});
