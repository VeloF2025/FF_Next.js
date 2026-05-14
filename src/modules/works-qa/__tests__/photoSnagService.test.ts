import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the pg pool before importing the service. vi.mock is hoisted above
// imports, but factories capture outer-scope variables — so the spies must
// also be hoisted via vi.hoisted to be defined at the time the factories run.
const { queryMock, createTicketMock, updateTicketMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
  createTicketMock: vi.fn(),
  updateTicketMock: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  default: { query: queryMock },
  pool: { query: queryMock },
}));

vi.mock('@/modules/noc/services/ticketService', () => ({
  createTicket: createTicketMock,
  updateTicket: updateTicketMock,
}));

vi.mock('@/lib/logger', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  createPhotoSnag,
  resolvePhotoSnag,
  approvePhoto,
  getPoleSnagReport,
  listPhotoSnags,
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

  it('creates snag + ticket with assignee, status=assigned, tags include works_qa', async () => {
    setupQueryQueue([
      // findOpenSnagForSlot → none
      { match: /FROM snags/i, rows: [] },
      // loadPoleAndPhoto
      { match: /SELECT id, project_id, pole_label[\s\S]+FROM pole_qa_photos/i, rows: [POLE_ROW] },
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
      assignedToUserId: 'user-uuid-9',
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
    expect(payload.assigned_to).toBe('user-uuid-9');         // passed through, not resolved here
    expect(payload.status).toBe('assigned');
    expect(payload.uid_prefix).toBe('WQA');
    const parsed = JSON.parse(payload.external_id);
    expect(parsed.snag_id).toBe('snag-uuid-1');
    expect(parsed.tags).toEqual(expect.arrayContaining(['snag', 'works_qa', 'civil']));
    expect(result.slotApprovals.civil_03?.decision).toBe('snagged');
  });

  it('treats whitespace-only assigneeId as null (no FK ::uuid cast errors)', async () => {
    setupQueryQueue([
      { match: /FROM snags/i, rows: [] },
      { match: /FROM pole_qa_photos/i, rows: [POLE_ROW] },
      { match: /SELECT id FROM snag_reports/i, rows: [{ id: 'report-uuid-1' }] },
      { match: /COALESCE\(MAX\(snag_number\)/i, rows: [{ next: 1 }] },
      { match: /INSERT INTO snags/i, rows: [SNAG_INSERT_ROW] },
      { match: /INSERT INTO snag_photos/i, rows: [] },
      { match: /UPDATE snags SET noc_ticket_id/i, rows: [] },
      { match: /UPDATE pole_qa_photos/i, rows: [{ slot_approvals: {} }] },
    ]);
    createTicketMock.mockResolvedValue({ id: 'ticket-x', uid: 'WQA-x' });

    await createPhotoSnag({
      poleQaPhotoId: 'pole-uuid-1',
      slotKey: 'civil_03',
      comment: 'x',
      assignedToUserId: '   ',                                // whitespace-only from form input
      createdBy: 'user-1',
    });

    // The INSERT params must have `null` for assigned_to, not ''.
    const insertCall = queryMock.mock.calls.find((c: [string, unknown[]]) => /INSERT INTO snags/.test(c[0]));
    expect(insertCall).toBeDefined();
    const params = insertCall![1];
    expect(params[10]).toBeNull();                            // assigned_to (11th param, index 10)
    // No assigned_to or status in the ticket payload either.
    const payload = createTicketMock.mock.calls[0]![0];
    expect(payload.assigned_to).toBeUndefined();
    expect(payload.status).toBeUndefined();
  });

  it('maps severity correctly: minor → low, critical → high', async () => {
    for (const [severity, expectedPriority] of [['minor', 'low'], ['critical', 'high']] as const) {
      setupQueryQueue([
        { match: /FROM snags/i, rows: [] },
        { match: /FROM pole_qa_photos/i, rows: [POLE_ROW] },
        { match: /SELECT id FROM snag_reports/i, rows: [{ id: 'report-uuid-1' }] },
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

  it('auto-resolves linked NOC ticket via updateTicket (not direct SQL UPDATE)', async () => {
    setupQueryQueue([
      { match: /UPDATE snags/i, rows: [{
        ...SNAG_INSERT_ROW,
        status: 'verified',
        noc_ticket_id: 'ticket-uuid-1',
      }] },
      { match: /UPDATE pole_qa_photos/i, rows: [] },
    ]);
    updateTicketMock.mockReset();
    updateTicketMock.mockResolvedValue({ id: 'ticket-uuid-1', status: 'resolved' });
    const result = await resolvePhotoSnag({
      snagId: 'snag-uuid-1',
      resolvedBy: 'user-2',
      closeTicket: true,
    });
    expect(result.ticketResolved).toBe(true);
    // Critical: must go through the ticket service so activity log + notifications fire.
    expect(updateTicketMock).toHaveBeenCalledWith('ticket-uuid-1', { status: 'resolved' });
    // And NOT via a direct SQL UPDATE on maintenance_tickets.
    const sqlCalls = queryMock.mock.calls.map((c: [string, unknown[]]) => c[0]);
    expect(sqlCalls.some((s: string) => /UPDATE maintenance_tickets/i.test(s))).toBe(false);
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

describe('photoSnagService.listPhotoSnags', () => {
  beforeEach(() => { queryMock.mockReset(); });

  it('joins maintenance_tickets.ticket_uid and users.name (not staff.user_id)', async () => {
    setupQueryQueue([
      { match: /FROM snags s[\s\S]+JOIN pole_qa_photos[\s\S]+LEFT JOIN maintenance_tickets[\s\S]+LEFT JOIN users/i, rows: [
        { id: 'snag-1', pole_qa_photo_id: 'pole-1', slot_key: 'civil_03', ticket_uid: 'WQA-20260514-001', assignee_name: 'Jane Doe', pole_label: 'MAM.P.A033' },
      ] },
    ]);
    const result = await listPhotoSnags('pole-1');
    expect(result[0]!.ticket_uid).toBe('WQA-20260514-001');
    expect(result[0]!.assignee_name).toBe('Jane Doe');
    // Guardrail: ensure the SQL did NOT reference staff.user_id or t.uid
    // (regressions of the bugs the blind reviewer flagged on PR #1633).
    const callSql = queryMock.mock.calls[0]![0] as string;
    expect(callSql).not.toMatch(/staff\.user_id/);
    expect(callSql).not.toMatch(/staff\.name/);
    expect(callSql).not.toMatch(/\bt\.uid\b/);
    // users.name does not exist; users has first_name/last_name only.
    expect(callSql).not.toMatch(/\bu\.name\b/);
    expect(callSql).toMatch(/t\.ticket_uid/);
    expect(callSql).toMatch(/u\.first_name/);
    expect(callSql).toMatch(/u\.last_name/);
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
