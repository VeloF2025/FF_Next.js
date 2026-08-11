/**
 * Reads and writes for `hs_attachments`.
 *
 * Uses pg.Pool via @/lib/db-pool rather than the Neon shim: this is new code,
 * and the shim cannot run the transaction the delete path needs.
 *
 * The parent column is interpolated into SQL because a column name cannot be a
 * bind parameter. It is safe only because it comes from the closed policy table
 * keyed by `AttachmentSurface`, and `requireAttachmentSurface` is the sole route
 * from a request string to that type — no caller-supplied text reaches this
 * file. Ids are always parameterised.
 */

import { query, queryOne } from '@/lib/db-pool';
import { surfaceConfig, type AttachmentSurface } from './hsAttachmentPolicy';
import { HsAttachmentError } from './hsAttachmentValidation';

/** Postgres foreign-key violation. */
const FOREIGN_KEY_VIOLATION = '23503';

/**
 * What a client is allowed to know about an attachment.
 *
 * Deliberately without `file_path`. Returning it would hand back a storage
 * location that only nginx is keeping private, re-creating the guessable-URL
 * problem this design exists to remove — the module's .claude.md already forbids
 * returning `file_path`, `file_url` or `certificate_url` from an H&S response.
 */
// Type aliases rather than interfaces: `query<T>` constrains T to SqlRow
// (Record<string, unknown>), and only an alias gets the implicit index
// signature that satisfies it.
export type AttachmentSummary = {
  id: string;
  file_name: string;
  file_size: number;
  mime_type: string;
  uploaded_by: string;
  created_at: string;
};

/** Adds the storage location. Server-side only — never serialised to a client. */
export type AttachmentRecord = AttachmentSummary & {
  file_path: string;
  surface: AttachmentSurface;
  parent_id: string;
};

export interface NewAttachment {
  surface: AttachmentSurface;
  parentId: string;
  filePath: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  uploadedBy: string;
}

const SUMMARY_COLUMNS = `id, file_name, file_size, mime_type, uploaded_by, created_at`;

/**
 * Insert an attachment against its parent record.
 *
 * Parent existence is enforced by the foreign key rather than a preceding
 * SELECT: a check-then-insert can be overtaken by a concurrent delete of the
 * parent, and the constraint cannot. A 23503 here can only be the one foreign
 * key this statement touches, so it means the parent is gone.
 */
export async function insertAttachment(attachment: NewAttachment): Promise<AttachmentSummary> {
  const { parentColumn, label } = surfaceConfig(attachment.surface);

  try {
    const rows = await query<AttachmentSummary>(
      `INSERT INTO hs_attachments
         (${parentColumn}, file_path, file_name, file_size, mime_type, uploaded_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING ${SUMMARY_COLUMNS}`,
      [
        attachment.parentId,
        attachment.filePath,
        attachment.fileName,
        attachment.fileSize,
        attachment.mimeType,
        attachment.uploadedBy,
      ]
    );
    const inserted = rows[0];
    // RETURNING on a successful single-row INSERT always yields a row, so an
    // empty result means the driver returned something this code does not
    // understand — surfaced rather than passed on as a half-built object.
    if (!inserted) {
      throw new Error('Attachment insert returned no row');
    }
    return inserted;
  } catch (error) {
    if ((error as { code?: string }).code === FOREIGN_KEY_VIOLATION) {
      throw new HsAttachmentError('not_found', `That ${label} no longer exists`);
    }
    throw error;
  }
}

/** Attachments on one parent record, newest first. */
export async function listAttachments(
  surface: AttachmentSurface,
  parentId: string
): Promise<AttachmentSummary[]> {
  const { parentColumn } = surfaceConfig(surface);

  return query<AttachmentSummary>(
    `SELECT ${SUMMARY_COLUMNS}
       FROM hs_attachments
      WHERE ${parentColumn} = $1
      ORDER BY created_at DESC`,
    [parentId]
  );
}

/**
 * Fetch one attachment including its storage path, for the download and delete
 * routes.
 *
 * The surface is recovered from whichever parent column is set rather than
 * taken from the caller, so a request cannot name one surface while pointing at
 * an id belonging to another.
 */
export async function getAttachment(attachmentId: string): Promise<AttachmentRecord | null> {
  const row = await queryOne<Record<string, unknown>>(
    `SELECT ${SUMMARY_COLUMNS}, file_path,
            medical_id, contractor_document_id, library_id,
            talk_id, capa_id, letter_id, permit_id, ppe_acknowledgement_id
       FROM hs_attachments
      WHERE id = $1`,
    [attachmentId]
  );

  if (!row) return null;

  const arcs: Array<[AttachmentSurface, string]> = [
    ['medical', 'medical_id'],
    ['contractor_document', 'contractor_document_id'],
    ['library', 'library_id'],
    ['talk', 'talk_id'],
    ['capa', 'capa_id'],
    ['letter', 'letter_id'],
    ['permit', 'permit_id'],
    ['ppe_acknowledgement', 'ppe_acknowledgement_id'],
  ];

  const matched = arcs.find(([, column]) => row[column] !== null && row[column] !== undefined);

  // Unreachable while hs_attachments_exactly_one_parent holds. Treated as a
  // hard error rather than a default surface, because guessing here would pick
  // a storage category and hand out bytes on the strength of a guess.
  if (!matched) {
    throw new HsAttachmentError('not_found', 'That attachment is not linked to a record');
  }

  return {
    id: row.id as string,
    file_name: row.file_name as string,
    file_size: row.file_size as number,
    mime_type: row.mime_type as string,
    uploaded_by: row.uploaded_by as string,
    created_at: row.created_at as string,
    file_path: row.file_path as string,
    surface: matched[0],
    parent_id: row[matched[1]] as string,
  };
}

/**
 * Delete the row and report whether it was there to delete.
 *
 * The row goes first and the object second, so a failure between them leaves an
 * unreferenced file — recoverable by an operator — rather than a row pointing at
 * bytes that no longer exist, which would surface to users as a download that
 * 500s forever.
 */
export async function deleteAttachmentRow(attachmentId: string): Promise<boolean> {
  const rows = await query<{ id: string }>(
    `DELETE FROM hs_attachments WHERE id = $1 RETURNING id`,
    [attachmentId]
  );
  return rows.length > 0;
}
