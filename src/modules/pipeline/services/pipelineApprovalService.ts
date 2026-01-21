/**
 * Pipeline Approval Service
 * Database operations for project approvals
 */

import { sql } from '@/lib/neon';
import type {
  PipelineProjectApproval,
  PipelineProjectApprovalWithType,
  PipelineApprovalDocument,
  CreateApprovalInput,
  UpdateApprovalInput,
  SubmitApplicationInput,
  ApproveApprovalInput,
  RejectApprovalInput,
  InternalApproveInput,
  ScheduleFollowupInput,
  CompleteFollowupInput,
  UploadApprovalDocumentInput,
  VerifyDocumentInput,
  ExpiringApproval,
  DueFollowup,
} from '../types';

// ============================================================================
// Approval CRUD
// ============================================================================

export async function createApproval(
  input: CreateApprovalInput
): Promise<PipelineProjectApproval> {
  const result = (await sql`
    INSERT INTO pipeline_project_approvals (
      pipeline_project_id, approval_type_id, is_required,
      authority_name, authority_contact_name, authority_contact_email,
      authority_contact_phone, authority_address, notes, created_by
    ) VALUES (
      ${input.pipeline_project_id},
      ${input.approval_type_id},
      ${input.is_required ?? true},
      ${input.authority_name || null},
      ${input.authority_contact_name || null},
      ${input.authority_contact_email || null},
      ${input.authority_contact_phone || null},
      ${input.authority_address || null},
      ${input.notes || null},
      ${input.created_by || null}
    )
    RETURNING *
  `) as Record<string, unknown>[];

  return result[0] as unknown as PipelineProjectApproval;
}

export async function getApprovalById(
  id: string
): Promise<PipelineProjectApprovalWithType | null> {
  const result = (await sql`
    SELECT
      a.*,
      t.code AS approval_type_code,
      t.name AS approval_type_name,
      t.category AS approval_type_category
    FROM pipeline_project_approvals a
    JOIN pipeline_approval_types t ON a.approval_type_id = t.id
    WHERE a.id = ${id}
  `) as Record<string, unknown>[];

  return result.length > 0 ? (result[0] as unknown as PipelineProjectApprovalWithType) : null;
}

export async function getProjectApprovals(
  projectId: string
): Promise<PipelineProjectApprovalWithType[]> {
  const result = await sql`
    SELECT
      a.*,
      t.code AS approval_type_code,
      t.name AS approval_type_name,
      t.category AS approval_type_category
    FROM pipeline_project_approvals a
    JOIN pipeline_approval_types t ON a.approval_type_id = t.id
    WHERE a.pipeline_project_id = ${projectId}
    ORDER BY t.display_order, t.name
  `;

  return result as PipelineProjectApprovalWithType[];
}

export async function updateApproval(
  id: string,
  input: UpdateApprovalInput
): Promise<PipelineProjectApproval | null> {
  // Build dynamic update
  const updates: string[] = [];
  const values: unknown[] = [];
  let paramIndex = 1;

  const addUpdate = (field: string, value: unknown) => {
    if (value !== undefined) {
      updates.push(`${field} = $${paramIndex}`);
      values.push(value);
      paramIndex++;
    }
  };

  addUpdate('status', input.status);
  addUpdate('is_required', input.is_required);
  addUpdate('application_date', input.application_date);
  addUpdate('application_reference', input.application_reference);
  addUpdate('application_document_url', input.application_document_url);
  addUpdate('authority_name', input.authority_name);
  addUpdate('authority_contact_name', input.authority_contact_name);
  addUpdate('authority_contact_email', input.authority_contact_email);
  addUpdate('authority_contact_phone', input.authority_contact_phone);
  addUpdate('authority_address', input.authority_address);
  addUpdate('assigned_officer', input.assigned_officer);
  addUpdate('next_followup_date', input.next_followup_date);
  addUpdate('followup_notes', input.followup_notes);
  addUpdate('approval_date', input.approval_date);
  addUpdate('approval_reference', input.approval_reference);
  addUpdate('approval_document_url', input.approval_document_url);
  addUpdate('issue_date', input.issue_date);
  addUpdate('expiry_date', input.expiry_date);
  addUpdate('application_fee', input.application_fee);
  addUpdate('fee_paid', input.fee_paid);
  addUpdate('fee_paid_date', input.fee_paid_date);
  addUpdate('fee_receipt_reference', input.fee_receipt_reference);
  addUpdate('fee_receipt_url', input.fee_receipt_url);
  addUpdate('coverage_description', input.coverage_description);
  if (input.affected_coordinates !== undefined) {
    addUpdate('affected_coordinates', input.affected_coordinates ? JSON.stringify(input.affected_coordinates) : null);
  }
  addUpdate('conditions', input.conditions);
  addUpdate('notes', input.notes);
  addUpdate('updated_by', input.updated_by);

  if (updates.length === 0) {
    return getApprovalById(id) as Promise<PipelineProjectApproval | null>;
  }

  updates.push('updated_at = NOW()');
  values.push(id);

  const query = `
    UPDATE pipeline_project_approvals
    SET ${updates.join(', ')}
    WHERE id = $${paramIndex}
    RETURNING *
  `;

  const result = (await sql.query(query, values)) as Record<string, unknown>[];
  return result.length > 0 ? (result[0] as unknown as PipelineProjectApproval) : null;
}

export async function deleteApproval(id: string): Promise<boolean> {
  const result = (await sql`
    DELETE FROM pipeline_project_approvals
    WHERE id = ${id}
    RETURNING id
  `) as Record<string, unknown>[];

  return result.length > 0;
}

// ============================================================================
// Approval Workflow Actions
// ============================================================================

export async function submitApplication(
  id: string,
  input: SubmitApplicationInput
): Promise<PipelineProjectApproval | null> {
  const result = (await sql`
    UPDATE pipeline_project_approvals
    SET
      status = 'submitted',
      application_date = ${input.application_date},
      application_reference = ${input.application_reference || null},
      application_document_url = ${input.application_document_url || null},
      application_fee = ${input.application_fee || null},
      notes = COALESCE(${input.notes || null}, notes),
      updated_at = NOW(),
      updated_by = ${input.updated_by}
    WHERE id = ${id}
    RETURNING *
  `) as Record<string, unknown>[];

  return result.length > 0 ? (result[0] as unknown as PipelineProjectApproval) : null;
}

export async function markApproved(
  id: string,
  input: ApproveApprovalInput
): Promise<PipelineProjectApproval | null> {
  const result = (await sql`
    UPDATE pipeline_project_approvals
    SET
      status = 'approved',
      approval_date = ${input.approval_date},
      approval_reference = ${input.approval_reference},
      approval_document_url = ${input.approval_document_url || null},
      issue_date = ${input.issue_date || null},
      expiry_date = ${input.expiry_date || null},
      conditions = ${input.conditions || null},
      notes = COALESCE(${input.notes || null}, notes),
      updated_at = NOW(),
      updated_by = ${input.updated_by}
    WHERE id = ${id}
    RETURNING *
  `) as Record<string, unknown>[];

  return result.length > 0 ? (result[0] as unknown as PipelineProjectApproval) : null;
}

export async function markRejected(
  id: string,
  input: RejectApprovalInput
): Promise<PipelineProjectApproval | null> {
  const result = (await sql`
    UPDATE pipeline_project_approvals
    SET
      status = 'rejected',
      rejection_date = ${input.rejection_date},
      rejection_reason = ${input.rejection_reason},
      notes = COALESCE(${input.notes || null}, notes),
      updated_at = NOW(),
      updated_by = ${input.updated_by}
    WHERE id = ${id}
    RETURNING *
  `) as Record<string, unknown>[];

  return result.length > 0 ? (result[0] as unknown as PipelineProjectApproval) : null;
}

export async function internalApprove(
  id: string,
  input: InternalApproveInput
): Promise<PipelineProjectApproval | null> {
  if (input.action === 'pm_approve') {
    const result = (await sql`
      UPDATE pipeline_project_approvals
      SET
        internal_status = 'pm_approved',
        pm_approved_by = ${input.approved_by},
        pm_approved_at = NOW(),
        pm_notes = ${input.notes || null},
        updated_at = NOW(),
        updated_by = ${input.approved_by}
      WHERE id = ${id} AND internal_status = 'pending'
      RETURNING *
    `) as Record<string, unknown>[];
    return result.length > 0 ? (result[0] as unknown as PipelineProjectApproval) : null;
  }

  if (input.action === 'ops_approve') {
    const result = (await sql`
      UPDATE pipeline_project_approvals
      SET
        internal_status = 'ops_approved',
        ops_approved_by = ${input.approved_by},
        ops_approved_at = NOW(),
        ops_notes = ${input.notes || null},
        updated_at = NOW(),
        updated_by = ${input.approved_by}
      WHERE id = ${id} AND internal_status = 'pm_approved'
      RETURNING *
    `) as Record<string, unknown>[];
    return result.length > 0 ? (result[0] as unknown as PipelineProjectApproval) : null;
  }

  if (input.action === 'reject') {
    const result = (await sql`
      UPDATE pipeline_project_approvals
      SET
        internal_status = 'rejected',
        internal_rejected_by = ${input.approved_by},
        internal_rejected_at = NOW(),
        internal_rejection_reason = ${input.rejection_reason || null},
        updated_at = NOW(),
        updated_by = ${input.approved_by}
      WHERE id = ${id}
      RETURNING *
    `) as Record<string, unknown>[];
    return result.length > 0 ? (result[0] as unknown as PipelineProjectApproval) : null;
  }

  return null;
}

export async function scheduleFollowup(
  id: string,
  input: ScheduleFollowupInput
): Promise<PipelineProjectApproval | null> {
  const result = (await sql`
    UPDATE pipeline_project_approvals
    SET
      next_followup_date = ${input.next_followup_date},
      followup_notes = COALESCE(${input.followup_notes || null}, followup_notes),
      updated_at = NOW(),
      updated_by = ${input.updated_by}
    WHERE id = ${id}
    RETURNING *
  `) as Record<string, unknown>[];

  return result.length > 0 ? (result[0] as unknown as PipelineProjectApproval) : null;
}

export async function completeFollowup(
  id: string,
  input: CompleteFollowupInput
): Promise<PipelineProjectApproval | null> {
  const result = (await sql`
    UPDATE pipeline_project_approvals
    SET
      last_followup_date = CURRENT_DATE,
      followup_count = followup_count + 1,
      followup_notes = ${input.followup_notes},
      next_followup_date = ${input.next_followup_date || null},
      updated_at = NOW(),
      updated_by = ${input.updated_by}
    WHERE id = ${id}
    RETURNING *
  `) as Record<string, unknown>[];

  return result.length > 0 ? (result[0] as unknown as PipelineProjectApproval) : null;
}

// ============================================================================
// Document Operations
// ============================================================================

export async function uploadDocument(
  input: UploadApprovalDocumentInput
): Promise<PipelineApprovalDocument> {
  // Get the pipeline_project_id from the approval
  const approval = await getApprovalById(input.approval_id);
  if (!approval) {
    throw new Error('Approval not found');
  }

  const result = (await sql`
    INSERT INTO pipeline_approval_documents (
      approval_id, pipeline_project_id, document_type, document_name, description,
      file_name, file_path, file_url, file_size, mime_type,
      document_date, issue_date, expiry_date, reference_number, issuing_authority,
      uploaded_by
    ) VALUES (
      ${input.approval_id},
      ${approval.pipeline_project_id},
      ${input.document_type},
      ${input.document_name},
      ${input.description || null},
      ${input.file_name},
      ${input.file_path || null},
      ${input.file_url || null},
      ${input.file_size || null},
      ${input.mime_type || null},
      ${input.document_date || null},
      ${input.issue_date || null},
      ${input.expiry_date || null},
      ${input.reference_number || null},
      ${input.issuing_authority || null},
      ${input.uploaded_by}
    )
    RETURNING *
  `) as Record<string, unknown>[];

  return result[0] as unknown as PipelineApprovalDocument;
}

export async function getApprovalDocuments(
  approvalId: string
): Promise<PipelineApprovalDocument[]> {
  const result = (await sql`
    SELECT * FROM pipeline_approval_documents
    WHERE approval_id = ${approvalId} AND is_active = true
    ORDER BY created_at DESC
  `) as Record<string, unknown>[];

  return result as unknown as PipelineApprovalDocument[];
}

export async function verifyDocument(
  id: string,
  input: VerifyDocumentInput
): Promise<PipelineApprovalDocument | null> {
  const result = (await sql`
    UPDATE pipeline_approval_documents
    SET
      is_verified = ${input.is_verified},
      verification_notes = ${input.verification_notes || null},
      verified_by = ${input.verified_by},
      verified_at = NOW(),
      updated_at = NOW()
    WHERE id = ${id}
    RETURNING *
  `) as Record<string, unknown>[];

  return result.length > 0 ? (result[0] as unknown as PipelineApprovalDocument) : null;
}

export async function deleteDocument(id: string): Promise<boolean> {
  const result = (await sql`
    UPDATE pipeline_approval_documents
    SET is_active = false, updated_at = NOW()
    WHERE id = ${id}
    RETURNING id
  `) as Record<string, unknown>[];

  return result.length > 0;
}

// ============================================================================
// Views / Reports
// ============================================================================

export async function getExpiringApprovals(
  daysAhead: number = 90
): Promise<ExpiringApproval[]> {
  const result = (await sql`
    SELECT * FROM pipeline_expiring_approvals
    WHERE days_until_expiry <= ${daysAhead}
    ORDER BY expiry_date ASC
  `) as Record<string, unknown>[];

  return result as unknown as ExpiringApproval[];
}

export async function getDueFollowups(): Promise<DueFollowup[]> {
  const result = (await sql`
    SELECT * FROM pipeline_due_followups
    ORDER BY next_followup_date ASC
  `) as Record<string, unknown>[];

  return result as unknown as DueFollowup[];
}

// ============================================================================
// Check if all required approvals are complete
// ============================================================================

export async function checkAllApprovalsComplete(
  projectId: string
): Promise<{
  complete: boolean;
  total: number;
  approved: number;
  pending: string[];
  expired: string[];
}> {
  const approvals = await getProjectApprovals(projectId);

  const required = approvals.filter((a) => a.is_required);
  const approved = required.filter((a) =>
    ['approved', 'conditionally_approved'].includes(a.status)
  );
  const pending = required.filter(
    (a) => !['approved', 'conditionally_approved'].includes(a.status)
  );
  const expired = approved.filter(
    (a) => a.expiry_date && new Date(a.expiry_date) < new Date()
  );

  return {
    complete: pending.length === 0 && expired.length === 0,
    total: required.length,
    approved: approved.length,
    pending: pending.map((a) => a.approval_type_name),
    expired: expired.map((a) => a.approval_type_name),
  };
}

// ============================================================================
// Export Service
// ============================================================================

export const pipelineApprovalService = {
  // CRUD
  createApproval,
  getApprovalById,
  getProjectApprovals,
  updateApproval,
  deleteApproval,

  // Workflow
  submitApplication,
  markApproved,
  markRejected,
  internalApprove,
  scheduleFollowup,
  completeFollowup,

  // Documents
  uploadDocument,
  getApprovalDocuments,
  verifyDocument,
  deleteDocument,

  // Views
  getExpiringApprovals,
  getDueFollowups,

  // Helpers
  checkAllApprovalsComplete,
};
