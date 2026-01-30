/**
 * API Route: /api/activate/process-new-dr
 *
 * Purpose: Webhook endpoint for automatic photo fetch + VLM categorization
 * Method: POST
 *
 * Called by WA Monitor Python service after creating a new DR record.
 * This enables automatic processing so photos are ready when user opens UI.
 *
 * Flow:
 * 1. WA Monitor detects new DR in WhatsApp
 * 2. WA Monitor creates record in dr_photo_unified_reviews
 * 3. WA Monitor calls this webhook
 * 4. This endpoint fetches photos from OneMap + runs VLM categorization
 * 5. User opens UI and sees photos already categorized
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { Pool } from 'pg';

import { apiResponse, ErrorCode } from '@/lib/apiResponse';
// NOTE: No withAuth - this endpoint is called by Go WhatsApp Bridge without credentials
import { log } from '@/lib/logger';
import {
  categorizePhotos,
  PhotoInput,
} from '@/modules/activate/services/categorizationVlmService';
import { fetchPhotosWithRetry } from '@/modules/activate/services/photoFetchService';
import {
  isSharePointDrSyncEnabled,
  getSharePointDrConfig,
  getAccessToken,
  createDrFolderHierarchy,
  getOrCreateSyncRecord,
  updateSyncRecordFolder,
} from '@/lib/sharepointDrSyncService';
import type { DrFolderInfo } from '@/modules/activate/types/sharepoint.types';

// BOSS API (1Map data cached on dr-photo-api service)
const BOSS_API_HOST = 'http://100.96.203.105:8003';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

interface ProcessNewDrRequest {
  dropNumber: string;
  project?: string;
  submittedDate?: string; // Date when DR was submitted (YYYY-MM-DD), defaults to today
  skipCategorization?: boolean; // Optional: only fetch photos, don't categorize
  senderPhone?: string; // Phone number of sender (from WA Monitor)
  // WhatsApp message context for reply threading
  waMessageId?: string; // Original WhatsApp message ID (stanza ID)
  waSenderJid?: string; // Sender JID (may be LID format)
  waOriginalText?: string; // Original message text
  waGroupJid?: string; // WhatsApp group JID
}

interface PreviousSubmission {
  submission_number: number;
  snapshot_at: string;
  photo_count: number;
  photos_metadata: any[];
  vlm_categorization_status: string | null;
  vlm_categorization_results: any[];
  feedback_sent: boolean;
  feedback_sent_at: string | null;
  step_completion: Record<string, boolean>;
}

interface ProcessNewDrResponse {
  dropNumber: string;
  photosDownloaded: number;
  categorizationStatus: string;
  processingTimeMs: number;
  isResubmission?: boolean;
  submissionCount?: number;
  previousSubmission?: PreviousSubmission | null;
  dropsTableMatch?: boolean;
  projectMismatch?: boolean;
  expectedProject?: string | null;
}

interface DropsTableRecord {
  id: string;
  drop_number: string;
  project_id: string;
  project_name: string;
}

/**
 * Contact info from BOSS API (1Map data)
 * UNIFIED ARCHITECTURE: This is fetched once during processing and stored in unified table
 */
interface SubscriberContact {
  subscriber_name: string | null;
  subscriber_phone: string | null;
  subscriber_email: string | null;
  subscriber_language: string | null;
  signup_agent: string | null;
  installer_name: string | null;
}

/**
 * Contact info from maintenance_tickets (QContact data)
 * UNIFIED ARCHITECTURE: This is fetched once during processing and stored in unified table
 */
interface QContactInfo {
  qcontact_name: string | null;
  qcontact_phone: string | null;
  qcontact_email: string | null;
}

/**
 * Fetch subscriber contact info from BOSS API (1Map data)
 * Returns contact fields to be stored in unified table during processing
 */
async function fetchSubscriberContact(dropNumber: string): Promise<SubscriberContact | null> {
  try {
    const response = await fetch(`${BOSS_API_HOST}/api/record/${dropNumber}`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(5000), // 5s timeout
    });

    if (!response.ok) {
      log.warn('ProcessNewDr', `BOSS API returned ${response.status} for ${dropNumber}`);
      return null;
    }

    const data = await response.json();

    // Build full name from first + last
    const firstName = data.contact_person_name || data.contact_name || '';
    const lastName = data.contact_person_surname || data.contact_surname || '';
    const fullName = [firstName, lastName].filter(Boolean).join(' ').trim() || null;

    return {
      subscriber_name: fullName,
      subscriber_phone: data.contact_number || data.contact_phone || null,
      subscriber_email: data.email_address || data.contact_email || null,
      subscriber_language: data.language || null,
      signup_agent: data.signup_agent || null,
      installer_name: data.installer_name || null,
    };
  } catch (error) {
    log.warn('ProcessNewDr', `BOSS API fetch failed for ${dropNumber}`, error);
    return null;
  }
}

/**
 * Fetch QContact info from maintenance_tickets table
 * Returns contact fields to be stored in unified table during processing
 */
async function fetchQContactInfo(dropNumber: string): Promise<QContactInfo | null> {
  try {
    const result = await pool.query(
      `SELECT client_name, client_contact, client_email
       FROM maintenance_tickets
       WHERE dr_number = $1
       ORDER BY created_at DESC
       LIMIT 1`,
      [dropNumber]
    );

    if (result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0];
    return {
      qcontact_name: row.client_name || null,
      qcontact_phone: row.client_contact || null,
      qcontact_email: row.client_email || null,
    };
  } catch (error) {
    log.warn('ProcessNewDr', `QContact fetch failed for ${dropNumber}`, error);
    return null;
  }
}

/**
 * Check if DR exists in the drops table and get project info
 * Returns null if not found, or the record with project name
 */
async function checkDropsTable(dropNumber: string): Promise<DropsTableRecord | null> {
  const result = await pool.query(
    `SELECT d.id, d.drop_number, d.project_id, p.project_name
     FROM drops d
     LEFT JOIN projects p ON d.project_id = p.id
     WHERE d.drop_number = $1`,
    [dropNumber]
  );
  return result.rows.length > 0 ? result.rows[0] : null;
}

/**
 * Mark DR as site submitted in the drops table
 */
async function markSiteSubmitted(
  dropNumber: string,
  senderPhone: string | null,
  waProject: string
): Promise<void> {
  await pool.query(
    `UPDATE drops
     SET
       site_submitted = true,
       site_submitted_at = NOW(),
       site_submitted_by = $1,
       site_submitted_project = $2
     WHERE drop_number = $3`,
    [senderPhone, waProject, dropNumber]
  );
}


/**
 * Check if DR exists in dr_photo_unified_reviews table
 * Returns full record if exists for history preservation
 */
async function checkExistingUnifiedRecord(dropNumber: string): Promise<any | null> {
  const result = await pool.query(
    `SELECT
       id, drop_number, project, photo_count, photos_metadata,
       vlm_categorization_status, vlm_categorization_results, vlm_categorized_at,
       feedback_sent, feedback_sent_at, submission_count, submission_history,
       step_01_house_photo, step_02_cable_from_pole, step_03_entry_outside,
       step_04_entry_inside, step_05_wall, step_06_ont_back,
       step_07_power_meter, step_08_final_installation, step_09_green_lights,
       step_10_signature, submitted_date, created_at
     FROM dr_photo_unified_reviews
     WHERE drop_number = $1`,
    [dropNumber]
  );
  return result.rows.length > 0 ? result.rows[0] : null;
}

/**
 * Check if DR exists in qa_photo_reviews table (WA Monitor table)
 * Used for cross-table duplicate detection
 * Also retrieves whatsapp_message_date for accurate submission date tracking
 */
async function checkExistingQARecord(dropNumber: string, project?: string): Promise<any | null> {
  // Check across shared projects (Lawley, Mohadin, Mamelodi) or just the specific project
  const sharedProjects = ['Lawley', 'Mohadin', 'Mamelodi'];
  const projectsToCheck = project && sharedProjects.includes(project)
    ? sharedProjects
    : project ? [project] : sharedProjects;

  const placeholders = projectsToCheck.map((_, i) => `$${i + 2}`).join(',');
  const result = await pool.query(
    `SELECT id, drop_number, project, feedback_sent, created_at, whatsapp_message_date, sender_phone
     FROM qa_photo_reviews
     WHERE drop_number = $1 AND project IN (${placeholders})`,
    [dropNumber, ...projectsToCheck]
  );
  return result.rows.length > 0 ? result.rows[0] : null;
}

/**
 * Create a snapshot of the current submission for history
 */
function createSubmissionSnapshot(record: any, submissionNumber: number): PreviousSubmission & { submitted_date?: string } {
  return {
    submission_number: submissionNumber,
    snapshot_at: new Date().toISOString(),
    submitted_date: record.submitted_date || null, // Track when this submission was dated
    photo_count: record.photo_count || 0,
    photos_metadata: record.photos_metadata || [],
    vlm_categorization_status: record.vlm_categorization_status,
    vlm_categorization_results: record.vlm_categorization_results || [],
    feedback_sent: record.feedback_sent || false,
    feedback_sent_at: record.feedback_sent_at || null,
    step_completion: {
      step_01_house_photo: record.step_01_house_photo || false,
      step_02_cable_from_pole: record.step_02_cable_from_pole || false,
      step_03_entry_outside: record.step_03_entry_outside || false,
      step_04_entry_inside: record.step_04_entry_inside || false,
      step_05_wall: record.step_05_wall || false,
      step_06_ont_back: record.step_06_ont_back || false,
      step_07_power_meter: record.step_07_power_meter || false,
      step_08_final_installation: record.step_08_final_installation || false,
      step_09_green_lights: record.step_09_green_lights || false,
      step_10_signature: record.step_10_signature || false,
    },
  };
}

/**
 * POST /api/activate/process-new-dr
 *
 * Webhook for automatic processing of new DRs.
 * Called by WA Monitor after creating a DR record, or via Manual Entry.
 *
 * Duplicate Detection:
 * - Checks dr_photo_unified_reviews (unified table)
 * - Checks qa_photo_reviews (WA Monitor table) for cross-reference
 * - Preserves submission history when resubmitting
 */
async function handlePost(req: NextApiRequest, res: NextApiResponse): Promise<void> {
  const startTime = Date.now();

  try {
    const {
      dropNumber,
      project,
      submittedDate,
      skipCategorization,
      senderPhone,
      waMessageId,
      waSenderJid,
      waOriginalText,
      waGroupJid,
    } = req.body as ProcessNewDrRequest;

    // Parse submitted date or default to today
    const submittedDateValue = submittedDate ? new Date(submittedDate) : new Date();
    const submittedDateStr = submittedDateValue.toISOString().split('T')[0]; // YYYY-MM-DD

    if (!dropNumber) {
      return apiResponse.error(res, ErrorCode.BAD_REQUEST, 'dropNumber is required');
    }

    log.info('ProcessNewDr', `Processing DR: ${dropNumber}`, { project, submittedDate: submittedDateStr, skipCategorization, senderPhone });

    // === SITE SUBMISSION TRACKING ===
    // Check if DR exists in drops table and validate project ownership
    const dropsRecord = await checkDropsTable(dropNumber);
    let dropsTableMatch = false;
    let projectMismatch = false;
    let expectedProject: string | null = null;

    if (dropsRecord) {
      dropsTableMatch = true;
      expectedProject = dropsRecord.project_name;

      // Validate project ownership if project is provided (from WA Monitor)
      if (project && expectedProject && project.toLowerCase() !== expectedProject.toLowerCase()) {
        projectMismatch = true;
        log.warn('ProcessNewDr', `Project mismatch for ${dropNumber}`, {
          expectedProject,
          submittedTo: project,
          senderPhone,
        });

        // BLOCK: Return error - DR submitted to wrong WhatsApp group
        return res.status(400).json({
          success: false,
          error: 'PROJECT_MISMATCH',
          message: `${dropNumber} belongs to ${expectedProject}, not ${project}. Please resubmit to the correct group.`,
          dropNumber,
          expectedProject,
          submittedTo: project,
          notifyUser: true,
        });
      }

      // Mark as site submitted in drops table
      await markSiteSubmitted(dropNumber, senderPhone || null, project || expectedProject);
      log.info('ProcessNewDr', `Marked ${dropNumber} as site submitted`, { expectedProject });

      // === SHAREPOINT FOLDER CREATION (Non-blocking) ===
      // Create folder hierarchy in SharePoint when DR is submitted via WhatsApp
      if (isSharePointDrSyncEnabled()) {
        // Fire-and-forget: don't block the main flow
        (async () => {
          try {
            const config = getSharePointDrConfig();
            if (!config) {
              log.debug('ProcessNewDr', 'SharePoint not configured, skipping folder creation');
              return;
            }

            // Get or create sync record
            const syncRecord = await getOrCreateSyncRecord(dropNumber, 'whatsapp');
            if (!syncRecord) {
              log.warn('SharePointSync', `Could not create sync record for ${dropNumber}`);
              return;
            }

            // Skip if folder already exists
            if (syncRecord.folder_created && syncRecord.folder_id) {
              log.debug('SharePointSync', `Folder already exists for ${dropNumber}`);
              return;
            }

            // Build folder info from drops table data
            const folderInfo: DrFolderInfo = {
              dropNumber,
              project: syncRecord.project || expectedProject || 'Unknown',
              zoneNo: syncRecord.zone_no,
              ponNo: syncRecord.pon_no,
              poleNumber: syncRecord.pole_number,
            };

            // Get access token and create folder hierarchy
            const accessToken = await getAccessToken(config);
            const result = await createDrFolderHierarchy(accessToken, config, folderInfo);

            if (result.success && result.folderId && result.parentFolderIds) {
              await updateSyncRecordFolder(
                dropNumber,
                result.folderId,
                result.folderPath || '',
                result.parentFolderIds
              );
              log.info('SharePointSync', `Created folder for ${dropNumber}`, {
                folderPath: result.folderPath,
              });
            } else {
              log.warn('SharePointSync', `Failed to create folder for ${dropNumber}`, {
                error: result.error,
              });
            }
          } catch (spError) {
            // Non-blocking: log error but don't fail the main request
            log.error('SharePointSync', `Error creating folder for ${dropNumber}`, spError);
          }
        })();
      }
    } else {
      // STRICT MODE: Block DRs not found in drops table
      log.warn('ProcessNewDr', `DR ${dropNumber} not found in drops table - REJECTING`, {
        submittedTo: project,
        senderPhone,
      });

      return res.status(400).json({
        success: false,
        error: 'DR_NOT_FOUND',
        message: `${dropNumber} not found in ${project || 'system'}. Please verify the DR number is correct.`,
        dropNumber,
        submittedTo: project,
        notifyUser: true,
      });
    }

    // Check for existing records in both tables
    const existingUnified = await checkExistingUnifiedRecord(dropNumber);
    const existingQA = await checkExistingQARecord(dropNumber, project);

    // Resolve sender_phone: body > qa_photo_reviews > wa_monitor_drops
    let resolvedSenderPhone = senderPhone || existingQA?.sender_phone || null;
    if (!resolvedSenderPhone) {
      const waDropResult = await pool.query(
        `SELECT sender_phone FROM wa_monitor_drops WHERE drop_number = $1 AND sender_phone IS NOT NULL ORDER BY created_at DESC LIMIT 1`,
        [dropNumber]
      );
      if (waDropResult.rows[0]?.sender_phone) {
        resolvedSenderPhone = waDropResult.rows[0].sender_phone;
        log.info('ProcessNewDr', `Resolved sender_phone from wa_monitor_drops for ${dropNumber}: ${resolvedSenderPhone}`);
      }
    }

    let isResubmission = false;
    let submissionCount = 1;
    let previousSubmission: PreviousSubmission | null = null;

    // === FETCH CONTACT INFO (UNIFIED ARCHITECTURE) ===
    // Fetch contact data ONCE during processing and store in unified table
    // This avoids runtime queries to BOSS API and maintenance_tickets on every page view
    const [subscriberContact, qContactInfo] = await Promise.all([
      fetchSubscriberContact(dropNumber),
      fetchQContactInfo(dropNumber),
    ]);

    log.info('ProcessNewDr', `Contact info for ${dropNumber}`, {
      hasSubscriberContact: !!subscriberContact,
      hasQContactInfo: !!qContactInfo,
      subscriberName: subscriberContact?.subscriber_name || null,
      qcontactName: qContactInfo?.qcontact_name || null,
    });

    if (existingUnified) {
      // DR exists in unified table - this is a resubmission
      isResubmission = true;
      submissionCount = (existingUnified.submission_count || 1) + 1;

      // Create snapshot of current state before overwriting
      previousSubmission = createSubmissionSnapshot(existingUnified, existingUnified.submission_count || 1);

      // Append to submission history
      const currentHistory = existingUnified.submission_history || [];
      const updatedHistory = [...currentHistory, previousSubmission];

      // Update record with new submission info and preserved history
      // Note: submitted_date is preserved from original submission, not overwritten
      // WhatsApp context is updated for resubmission to enable reply threading on new feedback
      // Clear is_oes_only flag since this is now a real submission
      // UNIFIED ARCHITECTURE: Store contact info during processing
      await pool.query(
        `UPDATE dr_photo_unified_reviews
         SET
           submission_count = $1,
           submission_history = $2,
           last_resubmitted_at = NOW(),
           resubmitted_by = 'manual_entry',
           project = COALESCE($3, project),
           wa_message_id = COALESCE($5, wa_message_id),
           wa_sender_jid = COALESCE($6, wa_sender_jid),
           wa_original_text = COALESCE($7, wa_original_text),
           wa_group_jid = COALESCE($8, wa_group_jid),
           wa_received_at = CASE WHEN $5 IS NOT NULL THEN NOW() ELSE wa_received_at END,
           is_oes_only = FALSE,
           sender_phone = COALESCE($18, sender_phone),
           -- Contact info from BOSS API (1Map)
           subscriber_name = COALESCE($9, subscriber_name),
           subscriber_phone = COALESCE($10, subscriber_phone),
           subscriber_email = COALESCE($11, subscriber_email),
           subscriber_language = COALESCE($12, subscriber_language),
           signup_agent = COALESCE($13, signup_agent),
           installer_name = COALESCE($14, installer_name),
           -- Contact info from QContact/maintenance_tickets
           qcontact_name = COALESCE($15, qcontact_name),
           qcontact_phone = COALESCE($16, qcontact_phone),
           qcontact_email = COALESCE($17, qcontact_email),
           updated_at = NOW()
         WHERE drop_number = $4`,
        [
          submissionCount,
          JSON.stringify(updatedHistory),
          project,
          dropNumber,
          waMessageId || null,
          waSenderJid || null,
          waOriginalText || null,
          waGroupJid || null,
          subscriberContact?.subscriber_name || null,
          subscriberContact?.subscriber_phone || null,
          subscriberContact?.subscriber_email || null,
          subscriberContact?.subscriber_language || null,
          subscriberContact?.signup_agent || null,
          subscriberContact?.installer_name || null,
          qContactInfo?.qcontact_name || null,
          qContactInfo?.qcontact_phone || null,
          qContactInfo?.qcontact_email || null,
          resolvedSenderPhone,
        ]
      );

      log.info('ProcessNewDr', `Resubmission detected for ${dropNumber}`, {
        submissionCount,
        previousPhotoCount: previousSubmission.photo_count,
        hadFeedback: previousSubmission.feedback_sent,
      });
    } else if (existingQA) {
      // DR exists in QA table but not unified - create unified record noting the QA reference
      // Use whatsapp_message_date if available (actual WhatsApp submission time)
      const qaSubmittedDate = existingQA.whatsapp_message_date || existingQA.created_at;
      const qaSubmittedDateStr = new Date(qaSubmittedDate).toISOString().split('T')[0];
      // Preserve original created_at timestamp from qa_photo_reviews
      const originalCreatedAt = existingQA.created_at;

      log.info('ProcessNewDr', `Found existing QA record for ${dropNumber} in ${existingQA.project}`, {
        whatsapp_message_date: existingQA.whatsapp_message_date,
        using_date: qaSubmittedDateStr,
        original_created_at: originalCreatedAt,
      });

      // UNIFIED ARCHITECTURE: Store contact info during processing
      await pool.query(
        `INSERT INTO dr_photo_unified_reviews (
           drop_number, project, submission_count, submitted_date, sender_phone,
           wa_message_id, wa_sender_jid, wa_original_text, wa_group_jid, wa_received_at,
           created_at, updated_at, submission_history, is_oes_only,
           subscriber_name, subscriber_phone, subscriber_email, subscriber_language,
           signup_agent, installer_name,
           qcontact_name, qcontact_phone, qcontact_email
         ) VALUES ($1, $2, 1, $3, $4, $5, $6, $7, $8, NOW(), $9, $9, $10, FALSE,
           $11, $12, $13, $14, $15, $16, $17, $18, $19)`,
        [
          dropNumber,
          project || existingQA.project,
          qaSubmittedDateStr, // Use WhatsApp message date instead of user-provided date
          resolvedSenderPhone, // Resolved from body > qa_photo_reviews > wa_monitor_drops
          waMessageId || null, // WhatsApp message context for reply threading
          waSenderJid || null,
          waOriginalText || null,
          waGroupJid || null,
          originalCreatedAt, // Preserve original timestamp from qa_photo_reviews
          JSON.stringify([{
            submission_number: 0,
            snapshot_at: existingQA.created_at,
            whatsapp_message_date: existingQA.whatsapp_message_date,
            sender_phone: resolvedSenderPhone,
            photo_count: 0,
            photos_metadata: [],
            vlm_categorization_status: null,
            vlm_categorization_results: [],
            feedback_sent: existingQA.feedback_sent || false,
            feedback_sent_at: null,
            step_completion: {},
            note: `Originally submitted via WhatsApp to ${existingQA.project}`,
          }]),
          // Contact info from BOSS API (1Map)
          subscriberContact?.subscriber_name || null,
          subscriberContact?.subscriber_phone || null,
          subscriberContact?.subscriber_email || null,
          subscriberContact?.subscriber_language || null,
          subscriberContact?.signup_agent || null,
          subscriberContact?.installer_name || null,
          // Contact info from QContact/maintenance_tickets
          qContactInfo?.qcontact_name || null,
          qContactInfo?.qcontact_phone || null,
          qContactInfo?.qcontact_email || null,
        ]
      );

      isResubmission = true;
      submissionCount = 1;
    } else {
      // Brand new DR - create fresh record with WhatsApp message context for reply threading
      // UNIFIED ARCHITECTURE: Store contact info during processing
      await pool.query(
        `INSERT INTO dr_photo_unified_reviews (
           drop_number, project, submission_count, submitted_date,
           wa_message_id, wa_sender_jid, wa_original_text, wa_group_jid, wa_received_at,
           created_at, updated_at, is_oes_only,
           subscriber_name, subscriber_phone, subscriber_email, subscriber_language,
           signup_agent, installer_name,
           qcontact_name, qcontact_phone, qcontact_email
         )
         VALUES ($1, $2, 1, $3, $4, $5, $6, $7, NOW(), NOW(), NOW(), FALSE,
           $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
        [
          dropNumber,
          project || null,
          submittedDateStr,
          waMessageId || null,
          waSenderJid || null,
          waOriginalText || null,
          waGroupJid || null,
          // Contact info from BOSS API (1Map)
          subscriberContact?.subscriber_name || null,
          subscriberContact?.subscriber_phone || null,
          subscriberContact?.subscriber_email || null,
          subscriberContact?.subscriber_language || null,
          subscriberContact?.signup_agent || null,
          subscriberContact?.installer_name || null,
          // Contact info from QContact/maintenance_tickets
          qContactInfo?.qcontact_name || null,
          qContactInfo?.qcontact_phone || null,
          qContactInfo?.qcontact_email || null,
        ]
      );
      log.info('ProcessNewDr', `Created new record for ${dropNumber}`, {
        hasWaContext: !!(waMessageId && waSenderJid),
        hasContactInfo: !!(subscriberContact || qContactInfo),
      });
    }

    // Fetch photos from OneMap with robust retry logic
    log.info('ProcessNewDr', `Fetching photos for ${dropNumber} with retry`);
    const fetchResult = await fetchPhotosWithRetry(dropNumber, {
      maxRetries: 5,
      initialDelayMs: 2000,
      onStatusUpdate: (status) => {
        log.debug('ProcessNewDr', `Photo fetch status: ${status.message}`, {
          dropNumber,
          attempt: status.attempt,
          status: status.status,
        });
      },
    });

    const { photos, ont_barcode, ups_serial, fetchAttempts, downloadTriggered, totalWaitTimeMs } = fetchResult;

    log.info('ProcessNewDr', `Photo fetch complete for ${dropNumber}`, {
      photoCount: photos.length,
      fetchAttempts,
      downloadTriggered,
      totalWaitTimeMs,
    });

    if (photos.length === 0) {
      log.warn('ProcessNewDr', `No photos found for ${dropNumber}`);

      // Still capture serials from 1Map even when no photos found
      await pool.query(
        `UPDATE dr_photo_unified_reviews
         SET photo_count = 0,
             photo_source = 'onemap',
             ont_serial_scanned = COALESCE($2, ont_serial_scanned),
             ups_serial_scanned = COALESCE($3, ups_serial_scanned),
             updated_at = NOW()
         WHERE drop_number = $1`,
        [dropNumber, ont_barcode, ups_serial]
      );

      return apiResponse.success(res, {
        dropNumber,
        photosDownloaded: 0,
        categorizationStatus: 'no_photos',
        processingTimeMs: Date.now() - startTime,
        isResubmission,
        submissionCount,
        previousSubmission,
        dropsTableMatch,
        projectMismatch,
        expectedProject,
      } as ProcessNewDrResponse);
    }

    log.info('ProcessNewDr', `Found ${photos.length} photos for ${dropNumber}`);

    // Store photo metadata
    const photosMetadata = photos.map((p) => ({
      filename: p.filename,
      url: p.url,
      step: null, // Will be set after categorization
      original_type: p.original_type,
    }));

    await pool.query(
      `UPDATE dr_photo_unified_reviews
       SET
         photo_source = 'onemap',
         photo_count = $1,
         photos_metadata = $2,
         ont_serial_scanned = COALESCE($3, ont_serial_scanned),
         ups_serial_scanned = COALESCE($4, ups_serial_scanned),
         updated_at = NOW()
       WHERE drop_number = $5`,
      [photos.length, JSON.stringify(photosMetadata), ont_barcode, ups_serial, dropNumber]
    );

    // Skip categorization if requested (useful for testing)
    if (skipCategorization) {
      log.info('ProcessNewDr', `Skipping categorization for ${dropNumber} (requested)`);

      return apiResponse.success(res, {
        dropNumber,
        photosDownloaded: photos.length,
        categorizationStatus: 'skipped',
        processingTimeMs: Date.now() - startTime,
        isResubmission,
        submissionCount,
        previousSubmission,
        dropsTableMatch,
        projectMismatch,
        expectedProject,
      } as ProcessNewDrResponse);
    }

    // Run VLM categorization
    log.info('ProcessNewDr', `Running VLM categorization for ${dropNumber}`);

    await pool.query(
      `UPDATE dr_photo_unified_reviews
       SET vlm_categorization_status = 'processing', updated_at = NOW()
       WHERE drop_number = $1`,
      [dropNumber]
    );

    try {
      const categorizations = await categorizePhotos(dropNumber, photos);

      // Store categorization results
      await pool.query(
        `UPDATE dr_photo_unified_reviews
         SET
           vlm_categorization_status = 'categorized',
           vlm_categorization_results = $1,
           vlm_categorized_at = NOW(),
           updated_at = NOW()
         WHERE drop_number = $2`,
        [JSON.stringify(categorizations), dropNumber]
      );

      log.info('ProcessNewDr', `Categorization complete for ${dropNumber}`, {
        photoCount: categorizations.length,
        processingTimeMs: Date.now() - startTime,
      });

      return apiResponse.success(res, {
        dropNumber,
        photosDownloaded: photos.length,
        categorizationStatus: 'categorized',
        processingTimeMs: Date.now() - startTime,
        isResubmission,
        submissionCount,
        previousSubmission,
        dropsTableMatch,
        projectMismatch,
        expectedProject,
      } as ProcessNewDrResponse);
    } catch (catError) {
      log.error('ProcessNewDr', `Categorization failed for ${dropNumber}`, catError);

      // Store failure with retry tracking
      const errorMessage = catError instanceof Error ? catError.message : 'Unknown error';
      await pool.query(
        `UPDATE dr_photo_unified_reviews
         SET
           vlm_categorization_status = 'failed',
           vlm_retry_count = COALESCE(vlm_retry_count, 0) + 1,
           vlm_last_error = $1,
           vlm_next_retry_at = NOW() + INTERVAL '5 minutes',
           updated_at = NOW()
         WHERE drop_number = $2`,
        [errorMessage, dropNumber]
      );

      return apiResponse.success(res, {
        dropNumber,
        photosDownloaded: photos.length,
        categorizationStatus: 'failed',
        processingTimeMs: Date.now() - startTime,
        isResubmission,
        submissionCount,
        previousSubmission,
        dropsTableMatch,
        projectMismatch,
        expectedProject,
      } as ProcessNewDrResponse);
    }
  } catch (error) {
    log.error('ProcessNewDr', 'Error processing new DR', error);
    return apiResponse.internalError(res, error);
  }
}

/**
 * Main handler
 */
async function handler(
  req: NextApiRequest,
  res: NextApiResponse
): Promise<void> {
  if (req.method === 'POST') {
    return handlePost(req, res);
  } else {
    return apiResponse.error(res, ErrorCode.METHOD_NOT_ALLOWED, 'Method not allowed');
  }
}

// Public endpoint - called by Go WhatsApp Bridge
export default handler;
