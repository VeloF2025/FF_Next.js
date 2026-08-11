/**
 * `getAttachment` recovers which surface an attachment belongs to by finding
 * the one non-null parent column. Everything downstream depends on that answer:
 * the storage category used to delete the object, and the label shown to the
 * user. The API tests mock this module out, so without this file the arc
 * recovery — the part with seven near-identical branches and therefore the part
 * most likely to carry a copy-paste error — runs in no test at all.
 *
 * Driven through a stub query layer rather than a database: the mapping from
 * "which column is set" to "which surface" is pure logic over a row, and a real
 * Postgres adds nothing to it. The CHECK constraint that makes exactly one
 * column non-null is asserted separately, against real SQL, in
 * tests/migrations/487_hs_attachments.test.ts.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const h = vi.hoisted(() => ({
  row: { current: null as Record<string, unknown> | null },
  queries: { current: [] as Array<{ text: string; params: unknown[] }> },
}));

vi.mock('@/lib/db-pool', () => ({
  query: vi.fn(async (text: string, params: unknown[] = []) => {
    h.queries.current.push({ text, params });
    return [];
  }),
  queryOne: vi.fn(async (text: string, params: unknown[] = []) => {
    h.queries.current.push({ text, params });
    return h.row.current;
  }),
}));

import { getAttachment, listAttachments } from '../services/hsAttachmentService';
import { ATTACHMENT_SURFACES, surfaceConfig } from '../services/hsAttachmentPolicy';

const ARCS = {
  medical: 'medical_id',
  contractor_document: 'contractor_document_id',
  library: 'library_id',
  talk: 'talk_id',
  capa: 'capa_id',
  letter: 'letter_id',
  permit: 'permit_id',
  ppe_acknowledgement: 'ppe_acknowledgement_id',
} as const;

const NULL_ARCS = Object.fromEntries(Object.values(ARCS).map((c) => [c, null]));

function rowWith(column: string, parentId: string) {
  return {
    ...NULL_ARCS,
    [column]: parentId,
    id: 'att-1',
    file_name: 'cert.pdf',
    file_size: 1024,
    mime_type: 'application/pdf',
    uploaded_by: 'user-1',
    created_at: '2026-08-11T00:00:00Z',
    file_path: 'hs-private/medicals/stored.pdf',
  };
}

beforeEach(() => {
  h.row.current = null;
  h.queries.current = [];
});

describe('getAttachment — surface recovery', () => {
  // Table-driven over the policy's own list, so a surface added there without
  // a branch here fails rather than silently going untested.
  it.each(ATTACHMENT_SURFACES)('recovers the %s surface from its parent column', async (surface) => {
    const column = ARCS[surface as keyof typeof ARCS];
    expect(column, `no arc mapped for ${surface}`).toBeDefined();
    h.row.current = rowWith(column, 'parent-123');

    const attachment = await getAttachment('11111111-1111-1111-1111-111111111111');

    expect(attachment?.surface).toBe(surface);
    expect(attachment?.parent_id).toBe('parent-123');
  });

  it('maps every surface to the column the policy declares', () => {
    // Catches the arc table in the service drifting from the policy — they are
    // two lists of the same thing, and the service interpolates its copy
    // into SQL.
    for (const surface of ATTACHMENT_SURFACES) {
      expect(ARCS[surface as keyof typeof ARCS]).toBe(surfaceConfig(surface).parentColumn);
    }
  });

  it('returns null when the attachment does not exist', async () => {
    h.row.current = null;
    expect(await getAttachment('11111111-1111-1111-1111-111111111111')).toBeNull();
  });

  it('throws rather than guessing when no parent column is set', async () => {
    // Unreachable while the CHECK constraint holds. It must not fall back to a
    // default surface: that would pick a storage category and act on bytes on
    // the strength of a guess.
    h.row.current = { ...rowWith('medical_id', 'p'), medical_id: null };

    await expect(getAttachment('11111111-1111-1111-1111-111111111111')).rejects.toThrow(
      /not linked to a record/i
    );
  });

  it('never selects file_path in the list query', async () => {
    await listAttachments('medical', 'parent-123');

    const listQuery = h.queries.current.at(-1)?.text ?? '';
    // The list response goes to the browser. A storage path in it would undo
    // the point of routing reads through the download endpoint.
    expect(listQuery).not.toContain('file_path');
    expect(listQuery).toContain('medical_id');
  });

  it('parameterises the parent id rather than inlining it', async () => {
    await listAttachments('medical', "'; DROP TABLE hs_attachments; --");

    const { text, params } = h.queries.current.at(-1)!;
    expect(text).toContain('$1');
    expect(text).not.toContain('DROP TABLE');
    expect(params).toContain("'; DROP TABLE hs_attachments; --");
  });
});
