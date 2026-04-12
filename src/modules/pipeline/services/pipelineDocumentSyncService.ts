/**
 * Pipeline Document Sync Service
 * Downloads documents from Smartsheet and stores them on the Velocity server
 */

import { sql } from '@/lib/neon';
import FormData from 'form-data';
import { log } from '@/lib/logger';

// ============================================================================
// Configuration
// ============================================================================

const SMARTSHEET_API_BASE = 'https://api.smartsheet.com/2.0';
const VF_STORAGE_URL = process.env.VF_STORAGE_URL || 'http://100.96.203.105:8091';
const SHEET_ID = '8735086443712388';

// Stakeholder name patterns for parsing filenames
const STAKEHOLDER_PATTERNS: Record<string, string[]> = {
  'wayleave_eskom': ['eskom', 'escom'],
  'wayleave_telkom': ['telkom'],
  'wayleave_transnet': ['transnet'],
  'wayleave_cell_c': ['cell c', 'cellc'],
  'wayleave_dfa': ['dfa', 'dark fibre'],
  'wayleave_frogfoot': ['frogfoot'],
  'wayleave_liquid': ['liquid'],
  'wayleave_metro_fibre': ['metro fibre', 'metrofibre'],
  'wayleave_mtn': ['mtn'],
  'wayleave_open_serve': ['open serve', 'openserve'],
  'wayleave_vodacom': ['vodacom'],
  'wayleave_vumatel': ['vumatel'],
  'wayleave_rand_water': ['rand water', 'randwater'],
  'wayleave_sasol': ['sasol'],
  'wayleave_city_power': ['city power', 'citypower'],
  'wayleave_city_parks': ['city parks', 'cityparks'],
  'municipal_jra': ['jra', 'johannesburg roads'],
  'municipal_ekurhuleni_roads': ['ekurhuleni roads'],
  'municipal_ekurhuleni_electricity': ['ekurhuleni electricity'],
  'municipal_ekurhuleni_water': ['ekurhuleni water'],
};

// Document type patterns
const DOC_TYPE_PATTERNS: Record<string, string[]> = {
  'approval_certificate': ['approval letter', 'approval', 'approved', 'certificate'],
  'application_form': ['application', 'form'],
  'site_plan': ['map', 'plan', 'locality', 'route'],
  'conditions_doc': ['condition', 'conditional'],
  'fee_receipt': ['receipt', 'invoice', 'payment', 'proof of payment'],
  'correspondence': ['email', 'letter', 'response'],
  'supporting_doc': ['indemnity', 'consent', 'signed', 'cession'],
};

// ============================================================================
// Types
// ============================================================================

interface SmartsheetAttachment {
  id: number;
  name: string;
  mimeType: string;
  sizeInKb: number;
  parentType: string;
  parentId: number;
  url?: string;
}

interface DocumentSyncResult {
  success: boolean;
  totalAttachments: number;
  downloaded: number;
  uploaded: number;
  linked: number;
  skipped: number;
  errors: Array<{ attachmentId: number; name: string; error: string }>;
  duration_ms: number;
}

// ============================================================================
// Helper Functions
// ============================================================================

function getSmartsheetToken(): string {
  const token = process.env.SMARTSHEET_API_TOKEN;
  if (!token) {
    throw new Error('SMARTSHEET_API_TOKEN not set');
  }
  return token;
}

/**
 * Parse filename to extract stakeholder code
 */
function parseStakeholderFromFilename(filename: string): string | null {
  const lower = filename.toLowerCase();

  for (const [code, patterns] of Object.entries(STAKEHOLDER_PATTERNS)) {
    for (const pattern of patterns) {
      if (lower.includes(pattern)) {
        return code;
      }
    }
  }

  return null;
}

/**
 * Parse filename to extract document type
 */
function parseDocTypeFromFilename(filename: string): string {
  const lower = filename.toLowerCase();

  for (const [type, patterns] of Object.entries(DOC_TYPE_PATTERNS)) {
    for (const pattern of patterns) {
      if (lower.includes(pattern)) {
        return type;
      }
    }
  }

  return 'other';
}

// ============================================================================
// Smartsheet API Functions
// ============================================================================

async function fetchAllAttachments(): Promise<SmartsheetAttachment[]> {
  const token = getSmartsheetToken();
  const allAttachments: SmartsheetAttachment[] = [];
  let page = 1;
  const pageSize = 100;

  while (true) {
    const response = await fetch(
      `${SMARTSHEET_API_BASE}/sheets/${SHEET_ID}/attachments?page=${page}&pageSize=${pageSize}`,
      {
        headers: { 'Authorization': `Bearer ${token}` },
      }
    );

    if (!response.ok) {
      throw new Error(`Smartsheet API error: ${response.status}`);
    }

    const data = await response.json();
    allAttachments.push(...data.data);

    if (data.data.length < pageSize) {
      break;
    }
    page++;
  }

  return allAttachments;
}

async function getAttachmentDownloadUrl(attachmentId: number): Promise<string> {
  const token = getSmartsheetToken();

  const response = await fetch(
    `${SMARTSHEET_API_BASE}/sheets/${SHEET_ID}/attachments/${attachmentId}`,
    {
      headers: { 'Authorization': `Bearer ${token}` },
    }
  );

  if (!response.ok) {
    throw new Error(`Failed to get attachment URL: ${response.status}`);
  }

  const data = await response.json();
  return data.url;
}

// ============================================================================
// Storage Functions
// ============================================================================

async function uploadToStorage(
  projectId: string,
  filename: string,
  fileBuffer: Buffer,
  mimeType: string
): Promise<{ url: string; path: string }> {
  // Create multipart boundary
  const boundary = `----WebKitFormBoundary${Date.now().toString(16)}`;

  // Build multipart form data manually
  const header = Buffer.from(
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
    `Content-Type: ${mimeType}\r\n\r\n`
  );
  const footer = Buffer.from(`\r\n--${boundary}--\r\n`);
  const body = Buffer.concat([header, fileBuffer, footer]);

  const response = await fetch(
    `${VF_STORAGE_URL}/upload/pipeline/${projectId}`,
    {
      method: 'POST',
      body: body,
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': body.length.toString(),
      },
    }
  );

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Storage upload failed: ${error}`);
  }

  const result = await response.json() as { url: string; path: string };

  // Build public HTTPS URL from storage path
  // Public URLs need /storage/ prefix (nginx proxy routes /storage/ → port 8091)
  const storagePath = result.path || result.url?.replace(/^https?:\/\/[^/]+\//, '');
  const url = `https://app.fibreflow.app/storage/${storagePath}`;

  return {
    url,
    path: result.path,
  };
}

// ============================================================================
// Main Sync Function
// ============================================================================

export async function syncDocumentsFromSmartsheet(
  options: {
    limit?: number;
    skipExisting?: boolean;
  } = {}
): Promise<DocumentSyncResult> {
  const startTime = Date.now();
  const errors: Array<{ attachmentId: number; name: string; error: string }> = [];
  let downloaded = 0;
  let uploaded = 0;
  let linked = 0;
  let skipped = 0;

  try {
    // 1. Fetch all attachments from Smartsheet
    log.debug('pipelineDocumentSyncService', { action: 'fetchingAttachments' });
    const attachments = await fetchAllAttachments();
    log.debug('pipelineDocumentSyncService', { action: 'attachmentsFound', count: attachments.length });

    // Apply limit if specified
    const toProcess = options.limit ? attachments.slice(0, options.limit) : attachments;

    // 2. Get project mapping (smartsheet_row_id -> project_id)
    const projects = (await sql`
      SELECT id, smartsheet_id FROM pipeline_projects WHERE smartsheet_id IS NOT NULL
    `) as { id: string; smartsheet_id: string }[];

    const projectMap = new Map(projects.map(p => [p.smartsheet_id, p.id]));
    log.debug('pipelineDocumentSyncService', { action: 'projectsLoaded', count: projects.length });

    // 3. Get approval types mapping
    const approvalTypes = (await sql`
      SELECT id, code FROM pipeline_approval_types WHERE is_active = true
    `) as { id: string; code: string }[];

    const approvalTypeMap = new Map(approvalTypes.map(t => [t.code, t.id]));

    // 4. Get existing documents to skip
    const existingDocs = options.skipExisting
      ? new Set(
          ((await sql`
            SELECT smartsheet_attachment_id FROM pipeline_approval_documents
            WHERE smartsheet_attachment_id IS NOT NULL
          `) as { smartsheet_attachment_id: string }[]).map(d => d.smartsheet_attachment_id)
        )
      : new Set<string>();

    // 5. Process each attachment
    for (const attachment of toProcess) {
      const attachmentIdStr = String(attachment.id);

      // Skip if already synced
      if (existingDocs.has(attachmentIdStr)) {
        skipped++;
        continue;
      }

      // Skip non-row attachments
      if (attachment.parentType !== 'ROW') {
        skipped++;
        continue;
      }

      const rowId = String(attachment.parentId);
      const projectId = projectMap.get(rowId);

      if (!projectId) {
        skipped++;
        continue;
      }

      try {
        // Get download URL
        const downloadUrl = await getAttachmentDownloadUrl(attachment.id);

        // Download file
        const fileResponse = await fetch(downloadUrl);
        if (!fileResponse.ok) {
          throw new Error(`Download failed: ${fileResponse.status}`);
        }

        const fileBuffer = Buffer.from(await fileResponse.arrayBuffer());
        downloaded++;

        // Upload to storage
        const { url, path } = await uploadToStorage(
          projectId,
          attachment.name,
          fileBuffer,
          attachment.mimeType
        );
        uploaded++;

        // Parse stakeholder and doc type from filename
        const stakeholderCode = parseStakeholderFromFilename(attachment.name);
        const docType = parseDocTypeFromFilename(attachment.name);

        // Find or create approval for this stakeholder
        let approvalId: string | null = null;

        if (stakeholderCode) {
          const approvalTypeId = approvalTypeMap.get(stakeholderCode);

          if (approvalTypeId) {
            // Check if approval exists
            const existingApproval = (await sql`
              SELECT id FROM pipeline_project_approvals
              WHERE pipeline_project_id = ${projectId}
              AND approval_type_id = ${approvalTypeId}
            `) as { id: string }[];

            if (existingApproval.length > 0) {
              approvalId = existingApproval[0]!.id;
            } else {
              // Create approval
              const newApproval = (await sql`
                INSERT INTO pipeline_project_approvals (
                  pipeline_project_id, approval_type_id, status
                ) VALUES (
                  ${projectId}, ${approvalTypeId}, 'approved'
                )
                RETURNING id
              `) as { id: string }[];
              approvalId = newApproval[0]!.id;
            }
          }
        }

        // Create document record - document_name is required
        const documentName = attachment.name.replace(/\.[^/.]+$/, ''); // Remove extension

        await sql`
          INSERT INTO pipeline_approval_documents (
            pipeline_project_id,
            approval_id,
            document_type,
            document_name,
            file_name,
            file_url,
            file_path,
            file_size,
            mime_type,
            smartsheet_attachment_id,
            created_at
          ) VALUES (
            ${projectId},
            ${approvalId || null},
            ${docType},
            ${documentName},
            ${attachment.name},
            ${url},
            ${path},
            ${attachment.sizeInKb * 1024},
            ${attachment.mimeType},
            ${attachmentIdStr},
            NOW()
          )
        `;
        linked++;

        // Rate limit to avoid overwhelming APIs
        await new Promise(resolve => setTimeout(resolve, 100));

      } catch (error) {
        errors.push({
          attachmentId: attachment.id,
          name: attachment.name,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return {
      success: errors.length === 0,
      totalAttachments: attachments.length,
      downloaded,
      uploaded,
      linked,
      skipped,
      errors,
      duration_ms: Date.now() - startTime,
    };

  } catch (error) {
    return {
      success: false,
      totalAttachments: 0,
      downloaded,
      uploaded,
      linked,
      skipped,
      errors: [{
        attachmentId: 0,
        name: 'global',
        error: error instanceof Error ? error.message : String(error),
      }],
      duration_ms: Date.now() - startTime,
    };
  }
}

// ============================================================================
// Export Service
// ============================================================================

export const pipelineDocumentSyncService = {
  syncDocumentsFromSmartsheet,
  fetchAllAttachments,
};
