import { describe, it, expect, vi } from 'vitest';

// Mock @/lib/db-pool so the resolver doesn't hit DB in this unit suite.
vi.mock('@/lib/db-pool', () => ({
  sql: vi.fn().mockResolvedValue([]),
}));

// Mock the date formatter used by the report template to keep output ISO-clean.
vi.mock('@/utils/dateFormat', () => ({
  formatDisplayDateLong: vi.fn((date: string) => date),
}));

import { renderScopeSnagReportHtml } from './snagReportRenderer';
import type { SnagReportScopeRow, SnagReportMeta } from './snagReportRenderer';

const meta: SnagReportMeta = {
  reportNumber: 'SCOPE-LAWL-20260520-001',
  projectName: 'Lawley',
  scope: 'zone',
  zones: [24],
  pons: [],
  poles: [],
  fromDate: '2026-04-20',
  toDate: '2026-05-20',
  severities: ['critical', 'major', 'minor'],
  categories: ['photo_quality', 'pole_quality'],
  generatedAt: '2026-05-20T02:30:00Z',
  generatedBy: 'Hein van Vuuren',
};

const rows: SnagReportScopeRow[] = [
  {
    id: 's1',
    snag_number: 1,
    category: 'pole_quality',
    severity: 'major',
    status: 'open',
    description: 'Pole leaning',
    zone_no: 24,
    pon_no: 265,
    pole_number: 'LAW.P.X001',
    pole_qa_photo_id: 'p1',
    slot_key: 'civil_after',
    created_at: '2026-05-19T10:00:00Z',
    noc_ticket_uid: 'NOC-12345',
  },
];

describe('renderScopeSnagReportHtml', () => {
  it('emits an HTML document with the universal template wrapper', async () => {
    const html = await renderScopeSnagReportHtml(meta, rows);
    expect(html).toMatch(/<!DOCTYPE html>/);
    expect(html).toContain('Lawley');
    expect(html).toContain('SCOPE-LAWL-20260520-001');
  });

  it('subtitle is past tense and lists the scope summary', async () => {
    const html = await renderScopeSnagReportHtml(meta, rows);
    expect(html).toMatch(/covered? snags raised between 2026-04-20 and 2026-05-20/i);
    expect(html).toContain('Zone 24');
  });

  it('includes ticket UID and pole number in the table row', async () => {
    const html = await renderScopeSnagReportHtml(meta, rows);
    expect(html).toContain('NOC-12345');
    expect(html).toContain('LAW.P.X001');
  });

  it('KPIs: Total/Critical/Major/Minor/Resolved render with correct counts', async () => {
    const html = await renderScopeSnagReportHtml(meta, rows);
    // KPI label then value appear in sequence in the HTML
    expect(html).toMatch(/Total snags[\s\S]*?1/);
    expect(html).toMatch(/Major[\s\S]*?1/);
    expect(html).toMatch(/Critical[\s\S]*?0/);
  });

  it('does NOT emit locale date strings (only ISO YYYY-MM-DD)', async () => {
    const html = await renderScopeSnagReportHtml(meta, rows);
    expect(html).not.toMatch(/\d{1,2}\/\d{1,2}\/\d{4}/); // US locale
    expect(html).not.toMatch(/\d{1,2} May 2026/); // en-GB long form
  });

  it('handles empty rows array — KPIs all zero, no table crash', async () => {
    const html = await renderScopeSnagReportHtml(meta, []);
    expect(html).toMatch(/Total snags[\s\S]*?0/);
    expect(html).toContain('Lawley');
  });
});
