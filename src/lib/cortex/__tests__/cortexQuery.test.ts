import { describe, it, expect } from 'vitest';
import { clampLimit } from '../../../../pages/api/cortex/query';
import { citationMeta } from '@/lib/cortex/citationFormat';

describe('clampLimit', () => {
  it('defaults garbage / missing to 10', () => {
    expect(clampLimit(undefined)).toBe(10);
    expect(clampLimit('')).toBe(10);
    expect(clampLimit('abc')).toBe(10);
    expect(clampLimit('0')).toBe(10);
    expect(clampLimit('-5')).toBe(10);
  });

  it('passes through valid values and caps at 25', () => {
    expect(clampLimit('5')).toBe(5);
    expect(clampLimit('25')).toBe(25);
    expect(clampLimit('100')).toBe(25);
    expect(clampLimit(7)).toBe(7);
  });
});

describe('citationMeta', () => {
  it('joins source · channel · day, trimming the timestamp', () => {
    expect(citationMeta({ source: 'teams', channel: 'noc/ops', timestamp: '2026-06-11T09:30:00Z' }))
      .toBe('teams · noc/ops · 2026-06-11');
  });

  it('drops empty parts', () => {
    expect(citationMeta({ source: 'wa', channel: '', timestamp: '' })).toBe('wa');
    expect(citationMeta({ source: '', channel: '', timestamp: '' })).toBe('');
  });
});
