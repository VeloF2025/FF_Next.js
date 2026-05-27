/**
 * ontMismatchFallback.test.ts — decision table for the ph_bl ONT mismatch fallback.
 * Includes the three real adjudicated cases from the 2026-05-26 audit.
 */
import { describe, it, expect } from 'vitest';
import { classifyOntMismatch, applyOntFallbackToBadge, type OntFallbackResult } from '../ontMismatchFallback';

describe('classifyOntMismatch', () => {
  it('suppresses as confirmed_oes when OES confirms 1Map (VLM is the outlier)', () => {
    const r = classifyOntMismatch({
      dropNumber: 'DR100', dr9: 'DR100', ont9: 'ALCLBWRONG', onemap: 'ALCLB48AB0FB', oes: 'ALCLB48AB0FB',
    });
    expect(r.outcome).toBe('confirmed_oes');
    expect(r.status).toBe('bronze');
  });

  it('flags wrong_photo when the ph_bl DR number is a different drop', () => {
    const r = classifyOntMismatch({
      dropNumber: 'DR1744823', dr9: 'DR1744819', ont9: 'ALCLB48EAE0B', onemap: 'ALCLB48E9992', oes: null,
    });
    expect(r.outcome).toBe('wrong_photo');
    expect(r.label).toContain('wrong photo');
    expect(r.detail).toContain('DR1744819');
  });

  it('flags oes_correction when OES is present and differs from 1Map', () => {
    const r = classifyOntMismatch({
      dropNumber: 'DR200', dr9: 'DR200', ont9: 'ALCLBX', onemap: 'ALCLB1111', oes: 'ALCLB2222',
    });
    expect(r.outcome).toBe('oes_correction');
  });

  it('flags needs_human when no OES, DR# matches, photo ONT ≠ 1Map', () => {
    const r = classifyOntMismatch({
      dropNumber: 'DR300', dr9: 'DR300', ont9: 'ALCLBAAAA', onemap: 'ALCLBBBBB', oes: null,
    });
    expect(r.outcome).toBe('needs_human');
    expect(r.label).toContain('needs photo review');
  });

  it('prioritises OES confirmation even when the photo is also misattached', () => {
    // dr9≠drop AND oes=onemap → 1Map is confirmed regardless of the photo.
    const r = classifyOntMismatch({
      dropNumber: 'DR400', dr9: 'DR999', ont9: 'X', onemap: 'ALCLBSAME', oes: 'ALCLBSAME',
    });
    expect(r.outcome).toBe('confirmed_oes');
  });

  it('returns none when there is no usable signal (no OES, no dr9)', () => {
    const r = classifyOntMismatch({
      dropNumber: 'DR500', dr9: null, ont9: 'ALCLBAAAA', onemap: 'ALCLBBBBB', oes: null,
    });
    expect(r.outcome).toBe('none');
  });

  it('normalises case/whitespace before comparing', () => {
    const r = classifyOntMismatch({
      dropNumber: ' dr600 ', dr9: 'DR600', ont9: 'x', onemap: '  alclbsame ', oes: 'ALCLBSAME',
    });
    expect(r.outcome).toBe('confirmed_oes');
  });

  // Real audited cases (2026-05-26):
  it('DR1734971 → confirmed_oes (ph_bl DR# matches, ONT = OES = 1Map)', () => {
    const r = classifyOntMismatch({
      dropNumber: 'DR1734971', dr9: 'DR1734971', ont9: 'ALCLB48AB0FB', onemap: 'ALCLB48AB0FB', oes: 'ALCLB48AB0FB',
    });
    expect(r.outcome).toBe('confirmed_oes');
  });

  it('DR1744823 → wrong_photo (ph_bl shows DR1744819)', () => {
    const r = classifyOntMismatch({
      dropNumber: 'DR1744823', dr9: 'DR1744819', ont9: 'ALCLB48EAE0B', onemap: 'ALCLB48E9992', oes: null,
    });
    expect(r.outcome).toBe('wrong_photo');
  });
});

describe('applyOntFallbackToBadge', () => {
  const fb = (outcome: OntFallbackResult['outcome']): OntFallbackResult => ({
    outcome, status: outcome === 'confirmed_oes' ? 'bronze' : 'warning',
    label: outcome === 'confirmed_oes' ? 'Serial Confirmed (OES)' : 'Serial Mismatch — x', detail: '',
  });

  it('suppresses a warning to bronze when confirmed_oes and UPS not mismatched', () => {
    const r = applyOntFallbackToBadge({ overallStatus: 'warning', badgeLabel: 'Serial Mismatch' }, fb('confirmed_oes'), false);
    expect(r).toEqual({ overallStatus: 'bronze', badgeLabel: 'Serial Confirmed (OES)' });
  });

  it('does NOT downgrade a silver badge (verified UPS) even on confirmed_oes', () => {
    const r = applyOntFallbackToBadge({ overallStatus: 'silver', badgeLabel: 'Serial Verified' }, fb('confirmed_oes'), false);
    expect(r).toEqual({ overallStatus: 'silver', badgeLabel: 'Serial Verified' });
  });

  it('does NOT downgrade gold', () => {
    const r = applyOntFallbackToBadge({ overallStatus: 'gold', badgeLabel: '4-Way Verified' }, fb('wrong_photo'), false);
    expect(r.overallStatus).toBe('gold');
  });

  it('keeps warning + generic label when confirmed_oes but UPS is genuinely mismatched', () => {
    const r = applyOntFallbackToBadge({ overallStatus: 'warning', badgeLabel: 'Serial Mismatch' }, fb('confirmed_oes'), true);
    expect(r).toEqual({ overallStatus: 'warning', badgeLabel: 'Serial Mismatch' }); // not relabelled "Confirmed"
  });

  it('relabels a warning with the precise ONT label for wrong_photo / needs_human', () => {
    const r = applyOntFallbackToBadge({ overallStatus: 'warning', badgeLabel: 'Serial Mismatch' }, fb('wrong_photo'), true);
    expect(r).toEqual({ overallStatus: 'warning', badgeLabel: 'Serial Mismatch — x' });
  });

  it('leaves the badge untouched when outcome is none', () => {
    const r = applyOntFallbackToBadge({ overallStatus: 'warning', badgeLabel: 'Serial Mismatch' }, fb('none'), false);
    expect(r).toEqual({ overallStatus: 'warning', badgeLabel: 'Serial Mismatch' });
  });
});
