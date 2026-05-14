import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the pg pool before importing the service. vi.mock is hoisted above
// imports, but factories capture outer-scope variables — so the spies must
// also be hoisted via vi.hoisted to be defined at the time the factories run.
const { queryMock, createTicketMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
  createTicketMock: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  default: { query: queryMock },
  pool: { query: queryMock },
}));

vi.mock('@/modules/noc/services/ticketService', () => ({
  createTicket: createTicketMock,
}));

vi.mock('@/lib/logger', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  createPhotoSnag,
  resolvePhotoSnag,
  approvePhoto,
  getPoleSnagReport,
  buildTicketTitle,
  buildTicketDescription,
} from '../services/photoSnagService';

function setupQueryQueue(steps: Array<{ match: RegExp; rows: Record<string, unknown>[] }>) {
  queryMock.mockReset();
  let i = 0;
  queryMock.mockImplementation(async (text: string) => {
    const expectedStep = steps[i++];
    if (!expectedStep) throw new Error(`Unexpected query #${i}: ${text.slice(0, 80)}`);
    if (!expectedStep.match.test(text)) {
      throw new Error(`Query #${i} did not match expected pattern. Got: ${text.slice(0, 120)}`);
    }
    return { rows: expectedStep.rows };
  });
}

const POLE_ROW = {
  id: 'pole-uuid-1',
  project_id: 'proj-1',
  pole_label: 'MAM.P.A033',
  zone_no: 6,
  pon_no: 67,
  slot_approvals: {},
  slot_photo_key: 'mamelodi/MAM.P.A033/civil_03.jpg',
};

const SNAG_INSERT_ROW = {
  id: 'snag-uuid-1',
  pole_qa_photo_id: 'pole-uuid-1',
  slot_key: 'civil_03',
  slot_photo_key: 'mamelodi/MAM.P.A033/civil_03.jpg',
  discipline: 'civil',
  description: 'Depth not reaching 600mm',
  severity: 'major',
  status: 'assigned',
  noc_ticket_id: null,
  assigned_to: 'staff-uuid-9',
  created_at: new Date('2026-05-14T16:00:00Z'),
};

describe('photoSnagService.buildTicketTitle', () => {
  it('returns the raw title when under 100 chars', () => {
    expect(buildTicketTitle('MAM.P.A033', 'Depth Photo'))
      .toBe('[SNAG] MAM.P.A033 — Depth Photo');
  });

  it('truncates to 100 chars with ellipsis when over the limit', () => {
    const longLabel = 'X'.repeat(120);
    const t = buildTicketTitle('MAM.P.A033', longLabel);
    expect(t.length).toBe(100);
    expect(t.endsWith('...')).toBe(true);
  });
});

describe('photoSnagService.buildTicketDescription', () => {
  it('omits null zone/pon lines', () => {
    const d = buildTicketDescription({
      comment: 'Missing SJC label',
      poleLabel: 'MAM.P.A033',
      slotLabel: 'Dome Label',
      discipline: 'dome',
      severity: 'major',
      zoneNo: null,
      ponNo: null,
    });
    expect(d).toContain('Missing SJC label');
    expect(d).toContain('Pole: MAM.P.A033');
    expect(d).toContain('Slot: Dome Label (dome)');
    expect(d).toContain('Severity: major');
    expect(d).not.toContain('Zone:');
    expect(d).not.toContain('PON:');
  });

  it('includes zone/pon when present', () => {
    const d = buildTicketDescription({
      comment: 'X',
      poleLabel: 'MAM.P.A033',
      slotLabel: 'Depth Photo',
      discipline: 'civil',
      severity: 'critical',
      zoneNo: 6,
      ponNo: 67,
    });
    expect(d).toContain('Zone: 6');
    expect(d).toContain('PON: 67');
  });
});

describe('photoSnagService.createPhotoSnag', () => {
  beforeEach(() => {
    queryMock.mockReset();
    createTicketMock.mockReset();
  });

  it('returns status="duplicate" when an open snag already exists on the slot', async () => {
    setupQueryQueue([
      // findOpenSnagForSlot → existing
      { match: /FROM snags[\s\S]+pole_qa_photo_id/i, rows: [{ ...SNAG_INSERT_ROW, status: 'open' }] },
      // SELECT slot_approvals for snapshot
      { match: /SELECT slot_approvals FROM pole_qa_photos/i, rows: [{ slot_approvals: { civil_03: { decision: 'snagged' } } }] },
    ]);

    const result = await createPhotoSnag({
      poleQaPhotoId: 'pole-uuid-1',
      slotKey: 'civil_03',
      comment: 'duplicate attempt',
      createdBy: 'user-1',
    });

    expect(result.status).toBe('duplicate');
    expect(result.snag.id).toBe('snag-uuid-1');
    expect(result.slotApprovals.civil_03?.decision).toBe('snagged');
    expect(createTicketMock).not.toHaveBeenCalled();
  });

  it('creates snag + ticket, auto-assigns to site manager when no assignee passed', async () => {
    setupQueryQueue([
      // findOpenSnagForSlot → none
      { match: /FROM snags/i, rows: [] },
      // loadPoleAndPhoto
      { match: /SELECT id, project_id, pole_label[\s\S]+FROM pole_qa_photos/i, rows: [POLE_ROW] },
      // site manager lookup
      { match: /FROM v_project_team/i, rows: [{ person_id: 'staff-uuid-9' }] },
      // findOrCreateWorksQaReport: select existing
      { match: /SELECT id FROM snag_reports[\s\S]+works_qa/i, rows: [] },
      // findOrCreateWorksQaReport: insert
      { match: /INSERT INTO snag_reports/i, rows: [{ id: 'report-uuid-1' }] },
      // nextSnagNumber
      { match: /COALESCE\(MAX\(snag_number\)/i, rows: [{ next: 1 }] },
      // insert snag
      { match: /INSERT INTO snags/i, rows: [SNAG_INSERT_ROW] },
      // insert snag_photos (before)
      { match: /INSERT INTO snag_photos/i, rows: [] },
      // update snag.noc_ticket_id
      { match: /UPDATE snags SET noc_ticket_id/i, rows: [] },
      // update pole_qa_photos.slot_approvals
      { match: /UPDATE pole_qa_photos[\s\S]+slot_approvals/i, rows: [{ slot_approvals: { civil_03: { decision: 'snagged', snag_id: 'snag-uuid-1' } } }] },
    ]);
    createTicketMock.mockResolvedValue({ id: 'ticket-uuid-1', uid: 'WQA-20260514-001' });

    const result = await createPhotoSnag({
      poleQaPhotoId: 'pole-uuid-1',
      slotKey: 'civil_03',
      comment: 'Depth not reaching 600mm',
      createdBy: 'user-1',
    });

    expect(result.status).toBe('created');
    expect(result.ticket?.id).toBe('ticket-uuid-1');
    expect(createTicketMock).toHaveBeenCalledTimes(1);
    const payload = createTicketMock.mock.calls[0]![0];
    expect(payload.source).toBe('snags');
    expect(payload.ticket_category).toBe('snag');
    expect(payload.ticket_type).toBe('civils');
    expect(payload.priority).toBe('normal');                 // default severity='major' → priority='normal'
    expect(payload.assigned_to).toBe('staff-uuid-9');        // auto from v_project_team
    expect(payload.status).toBe('assigned');
    expect(payload.uid_prefix).toBe('WQA');
    expect(payload.external_id).toContain('snag-uuid-1');
    expect(result.slotApprovals.civil_03?.decision).toBe('snagged');
  });

  it('maps severity correctly: minor → low, critical → high', async () => {
    // Run twice with different severities; assert priority mapping each time.
    for (const [severity, expectedPriority] of [['minor', 'low'], ['critical', 'high']] as const) {
      setupQueryQueue([
        { match: /FROM snags/i, rows: [] },
        { match: /FROM pole_qa_photos/i, rows: [POLE_ROW] },
        { match: /FROM v_project_team/i, rows: [] },        // no manager
        { match: /SELECT id FROM snag_reports/i, rows: [{ id: 'report-uuid-1' }] }, // existing report
        { match: /COALESCE\(MAX\(snag_number\)/i, rows: [{ next: 2 }] },
        { match: /INSERT INTO snags/i, rows: [{ ...SNAG_INSERT_ROW, severity }] },
        { match: /INSERT INTO snag_photos/i, rows: [] },
        { match: /UPDATE snags SET noc_ticket_id/i, rows: [] },
        { match: /UPDATE pole_qa_photos/i, rows: [{ slot_approvals: {} }] },
      ]);
      createTicketMock.mockResolvedValue({ id: 'ticket-x', uid: 'WQA-x' });

      await createPhotoSnag({
        poleQaPhotoId: 'pole-uuid-1',
        slotKey: 'civil_03',
        comment: 'sev test',
        severity,
        createdBy: 'user-1',
      });

      const lastCall = createTicketMock.mock.calls.at(-1)![0];
      expect(lastCall.priority).toBe(expectedPriority);
      createTicketMock.mockReset();
    }
  });

  it('throws on unknown slot key', async () => {
    setupQueryQueue([
      { match: /FROM snags/i, rows: [] },
    ]);
    await expect(createPhotoSnag({
      poleQaPhotoId: 'pole-uuid-1',
      slotKey: 'civil_99',
      comment: 'x',
      createdBy: 'user-1',
    })).rejects.toThrow(/Unknown slot key/);
  });
});

describe('photoSnagService.resolvePhotoSnag', () => {
  beforeEach(() => { queryMock.mockReset(); });

  it('marks snag verified and flips slot_approvals back to approved', async () => {
    setupQueryQueue([
      { match: /UPDATE snags[\s\S]+status = 'verified'/i, rows: [{
        ...SNAG_INSERT_ROW,
        status: 'verified',
        noc_ticket_id: 'ticket-uuid-1',
      }] },
      { match: /UPDATE pole_qa_photos/i, rows: [] },
    ]);
    const result = await resolvePhotoSnag({
      snagId: 'snag-uuid-1',
      resolvedBy: 'user-2',
      closeTicket: false,
    });
    expect(result.snag.status).toBe('verified');
    expect(result.ticketResolved).toBe(false);
  });

  it('auto-resolves linked NOC ticket when closeTicket=true', async () => {
    setupQueryQueue([
      { match: /UPDATE snags/i, rows: [{
        ...SNAG_INSERT_ROW,
        status: 'verified',
        noc_ticket_id: 'ticket-uuid-1',
      }] },
      { match: /UPDATE pole_qa_photos/i, rows: [] },
      { match: /UPDATE maintenance_tickets[\s\S]+resolved/i, rows: [] },
    ]);
    const result = await resolvePhotoSnag({
      snagId: 'snag-uuid-1',
      resolvedBy: 'user-2',
      closeTicket: true,
    });
    expect(result.ticketResolved).toBe(true);
  });

  it('throws when snag id is missing or not a works-qa snag', async () => {
    setupQueryQueue([
      { match: /UPDATE snags/i, rows: [] },
    ]);
    await expect(resolvePhotoSnag({
      snagId: 'nonexistent',
      resolvedBy: 'user-2',
      closeTicket: false,
    })).rejects.toThrow(/snag not found/);
  });
});

describe('photoSnagService.approvePhoto', () => {
  beforeEach(() => { queryMock.mockReset(); });

  it('writes approved decision to slot_approvals JSONB', async () => {
    setupQueryQueue([
      { match: /UPDATE pole_qa_photos[\s\S]+slot_approvals/i, rows: [{
        slot_approvals: { civil_01: { decision: 'approved', by: 'user-1', at: '2026-05-14T16:00:00Z' } },
      }] },
    ]);
    const result = await approvePhoto({
      poleQaPhotoId: 'pole-uuid-1',
      slotKey: 'civil_01',
      approvedBy: 'user-1',
    });
    expect(result.civil_01?.decision).toBe('approved');
  });

  it('rejects unknown slot keys', async () => {
    await expect(approvePhoto({
      poleQaPhotoId: 'pole-uuid-1',
      slotKey: 'made_up_slot',
      approvedBy: 'user-1',
    })).rejects.toThrow(/Unknown slot key/);
  });
});

describe('photoSnagService.getPoleSnagReport', () => {
  beforeEach(() => { queryMock.mockReset(); });

  it('counts approved/snagged/pending and materialises a snag_reports row', async () => {
    const approvals = {
      civil_01: { decision: 'approved', by: 'u', at: '2026-05-14' },
      civil_02: { decision: 'approved', by: 'u', at: '2026-05-14' },
      civil_03: { decision: 'snagged', by: 'u', at: '2026-05-14', snag_id: 'snag-1' },
    };
    setupQueryQueue([
      { match: /SELECT id, pole_label[\s\S]+FROM pole_qa_photos/i, rows: [{
        id: 'pole-uuid-1',
        pole_label: 'MAM.P.A033',
        zone_no: 6,
        pon_no: 67,
        project_id: 'proj-1',
        slot_approvals: approvals,
      }] },
      // findOrCreateWorksQaReport: existing
      { match: /SELECT id FROM snag_reports/i, rows: [{ id: 'report-uuid-1' }] },
      // listPhotoSnags
      { match: /FROM snags s[\s\S]+JOIN pole_qa_photos/i, rows: [] },
    ]);

    const report = await getPoleSnagReport('pole-uuid-1', 'user-1');
    expect(report.totals.total).toBe(21);            // 7 civil + 8 dome + 6 main_joint
    expect(report.totals.approved).toBe(2);
    expect(report.totals.snagged).toBe(1);
    expect(report.totals.pending).toBe(18);
    expect(report.report_id).toBe('report-uuid-1');
  });
});
