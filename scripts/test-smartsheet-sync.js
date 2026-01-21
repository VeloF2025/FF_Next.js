/**
 * Test Smartsheet sync manually
 */

const { neon } = require('@neondatabase/serverless');

const SMARTSHEET_API_BASE = 'https://api.smartsheet.com/2.0';
const SHEET_ID = '8735086443712388';

// Column IDs for Velocity_Master_Tracker
const COLS = {
  PROJECT_NAME: 339507666440068,
  REGION: 4843107293810564,
  AREA: 2591307480125316,
  ESTIMATE_COUNT: 7094907107495812,
  PO_STATUS: 7657857060917124,
  CUSTOMER: 5969007200653188,
  WAYLEAVE_APP_DATE: 8922719130963844,
  WAYLEAVE_STATUS: 3717207386967940,
  WAYLEAVE_EXPIRY: 902457619861380,
  STAKEHOLDER_RECEIVED: 4155114088255364,
  STAKEHOLDER_OUTSTANDING: 8658713715625860,
  WAYLEAVE_COMMENTS: 126626108755844,
  COMMENT_OTHER: 198770178084740,
  MH_COORDS: 8783756967759748,
  NETWORK_METHOD: 5406057247231876,
  MH_NAME: 4280157340389252,
  NEAREST_BH: 6531957154074500,
};

// Status mappings
const PO_STATUS_MAP = {
  'Received': 'ready_to_plan',
  'Quote Sent': 'po_pending',
  'Pending count': 'approvals_in_progress',
  'Cancelled': 'cancelled',
};

const WAYLEAVE_STATUS_MAP = {
  'Complete': 'approved',
  'In Progress': 'submitted',
  'Partially Complete': 'conditionally_approved',
  'Expired': 'expired',
  'On Hold': 'on_hold',
  'Cancelled': 'withdrawn',
};

// Stakeholder to code mapping
const STAKEHOLDER_TO_CODE = {
  'eskom': 'wayleave_eskom',
  'telkom': 'wayleave_telkom',
  'transnet': 'wayleave_transnet',
  'cell c': 'wayleave_cell_c',
  'dfa': 'wayleave_dfa',
  'frogfoot': 'wayleave_frogfoot',
  'liquid': 'wayleave_liquid',
  'metro fibre': 'wayleave_metro_fibre',
  'mtn': 'wayleave_mtn',
  'open serve': 'wayleave_open_serve',
  'vodacom': 'wayleave_vodacom',
  'vumatel': 'wayleave_vumatel',
  'rand water': 'wayleave_rand_water',
  'sasol': 'wayleave_sasol',
  'city power': 'wayleave_city_power',
  'city parks': 'wayleave_city_parks',
  'jra': 'municipal_jra',
  'ekurhuleni roads': 'municipal_ekurhuleni_roads',
  'ekurhuleni electricity': 'municipal_ekurhuleni_electricity',
  'ekurhuleni water': 'municipal_ekurhuleni_water',
  'ekurhuleni water & sewer': 'municipal_ekurhuleni_water',
};

function getCellValue(row, columnId) {
  const cell = row.cells.find(c => c.columnId === columnId);
  return cell?.value ?? null;
}

function parseStakeholderList(text) {
  if (!text) return [];

  const excludePatterns = [
    /^all /i, /^complete$/i, /services received/i, /services uploaded/i,
    /approval letter/i, /renewal/i, /ext \d/i, /winnie mandela/i,
    /^for /i, /uploaded/i, /received/i, /^to be/i,
  ];

  const parts = text.split(/[,&]/).map(s => s.trim()).filter(s => s.length > 2);
  const stakeholders = [];

  for (const part of parts) {
    const lower = part.toLowerCase();
    if (excludePatterns.some(p => p.test(part))) continue;

    if (STAKEHOLDER_TO_CODE[lower]) {
      stakeholders.push(lower);
    } else {
      for (const [name] of Object.entries(STAKEHOLDER_TO_CODE)) {
        if (lower.includes(name) || name.includes(lower)) {
          stakeholders.push(name);
          break;
        }
      }
    }
  }

  return [...new Set(stakeholders)];
}

async function runSync() {
  const token = process.env.SMARTSHEET_API_TOKEN;
  const dbUrl = process.env.DATABASE_URL;

  if (!token) {
    console.error('SMARTSHEET_API_TOKEN not set');
    process.exit(1);
  }

  const sql = neon(dbUrl);

  console.log('Fetching Smartsheet data...');

  // Fetch sheet
  const response = await fetch(`${SMARTSHEET_API_BASE}/sheets/${SHEET_ID}`, {
    headers: { 'Authorization': `Bearer ${token}` },
  });

  if (!response.ok) {
    throw new Error(`Smartsheet API error: ${response.status}`);
  }

  const sheet = await response.json();
  console.log(`Found ${sheet.rows.length} rows in ${sheet.name}`);

  // Get approval types lookup
  const approvalTypes = await sql`
    SELECT id, code, name FROM pipeline_approval_types WHERE is_active = true
  `;
  const approvalTypeMap = new Map(approvalTypes.map(t => [t.code, t.id]));
  console.log(`Loaded ${approvalTypes.length} approval types`);

  // Create sync config if needed
  let config = (await sql`
    SELECT id FROM smartsheet_sync_config WHERE sheet_id = ${SHEET_ID}
  `)[0];

  if (!config) {
    console.log('Creating sync config...');
    config = (await sql`
      INSERT INTO smartsheet_sync_config (sheet_id, sheet_name, column_mappings, status_mappings)
      VALUES (${SHEET_ID}, ${sheet.name}, '{}', '{}')
      RETURNING id
    `)[0];
  }

  // Create sync history
  const history = (await sql`
    INSERT INTO smartsheet_sync_history (config_id, triggered_by)
    VALUES (${config.id}, 'manual')
    RETURNING id
  `)[0];

  const stats = { processed: 0, created: 0, updated: 0, skipped: 0, errored: 0 };
  const errors = [];
  const startTime = Date.now();

  // Process rows
  for (const row of sheet.rows) {
    stats.processed++;
    const ssRowId = String(row.id);

    try {
      const projectName = getCellValue(row, COLS.PROJECT_NAME);
      if (!projectName) {
        stats.skipped++;
        continue;
      }

      const region = getCellValue(row, COLS.REGION);
      const area = getCellValue(row, COLS.AREA);
      const estimateCount = getCellValue(row, COLS.ESTIMATE_COUNT);
      const poStatus = getCellValue(row, COLS.PO_STATUS);
      const customer = getCellValue(row, COLS.CUSTOMER);
      const networkMethod = getCellValue(row, COLS.NETWORK_METHOD);
      const mhName = getCellValue(row, COLS.MH_NAME);
      const nearestBh = getCellValue(row, COLS.NEAREST_BH);
      const commentOther = getCellValue(row, COLS.COMMENT_OTHER);

      const wlAppDate = getCellValue(row, COLS.WAYLEAVE_APP_DATE);
      const wlStatus = getCellValue(row, COLS.WAYLEAVE_STATUS);
      const wlExpiry = getCellValue(row, COLS.WAYLEAVE_EXPIRY);
      const wlComments = getCellValue(row, COLS.WAYLEAVE_COMMENTS);

      const stakeholdersReceived = getCellValue(row, COLS.STAKEHOLDER_RECEIVED);

      const pipelineStatus = poStatus ? (PO_STATUS_MAP[poStatus] || 'approvals_in_progress') : 'new';

      // Check existing
      const existing = await sql`
        SELECT id FROM pipeline_projects
        WHERE smartsheet_id = ${ssRowId}
        OR (LOWER(project_name) = LOWER(${projectName}) AND province = ${region})
      `;

      let projectId;

      if (existing.length > 0) {
        projectId = existing[0].id;
        await sql`
          UPDATE pipeline_projects SET
            project_name = ${projectName},
            province = ${region},
            area = ${area},
            estimated_homes_passed = ${estimateCount || null},
            pipeline_status = ${pipelineStatus},
            notes = ${commentOther || null},
            custom_fields = ${JSON.stringify({ network_method: networkMethod, mh_name: mhName, nearest_bh: nearestBh, customer })},
            smartsheet_id = ${ssRowId},
            smartsheet_sheet_id = ${SHEET_ID},
            last_synced_at = NOW(),
            sync_status = 'synced'
          WHERE id = ${projectId}
        `;
        stats.updated++;
      } else {
        const newProject = await sql`
          INSERT INTO pipeline_projects (
            project_name, province, area, estimated_homes_passed,
            pipeline_status, notes, custom_fields,
            smartsheet_id, smartsheet_sheet_id, last_synced_at, sync_status
          ) VALUES (
            ${projectName}, ${region}, ${area}, ${estimateCount || null},
            ${pipelineStatus}, ${commentOther || null},
            ${JSON.stringify({ network_method: networkMethod, mh_name: mhName, nearest_bh: nearestBh, customer })},
            ${ssRowId}, ${SHEET_ID}, NOW(), 'synced'
          )
          RETURNING id
        `;
        projectId = newProject[0].id;
        stats.created++;
      }

      // Create approvals for received stakeholders
      const receivedStakeholders = parseStakeholderList(stakeholdersReceived);
      for (const stakeholder of receivedStakeholders) {
        const typeCode = STAKEHOLDER_TO_CODE[stakeholder];
        const typeId = approvalTypeMap.get(typeCode);

        if (typeId) {
          await sql`
            INSERT INTO pipeline_project_approvals (
              pipeline_project_id, approval_type_id, status,
              application_date, expiry_date, notes, last_synced_at
            ) VALUES (
              ${projectId}, ${typeId}, 'approved',
              ${wlAppDate || null}, ${wlExpiry || null},
              ${wlComments || null}, NOW()
            )
            ON CONFLICT (pipeline_project_id, approval_type_id)
            DO UPDATE SET
              status = 'approved',
              expiry_date = EXCLUDED.expiry_date,
              notes = EXCLUDED.notes,
              last_synced_at = NOW()
          `;
        }
      }

      // Create main wayleave if status exists
      if (wlStatus) {
        const mappedStatus = WAYLEAVE_STATUS_MAP[wlStatus] || 'submitted';
        const wayleaveTypeId = approvalTypeMap.get('wayleave_eskom');
        if (wayleaveTypeId) {
          await sql`
            INSERT INTO pipeline_project_approvals (
              pipeline_project_id, approval_type_id, status, is_required,
              application_date, expiry_date, notes, last_synced_at
            ) VALUES (
              ${projectId}, ${wayleaveTypeId}, ${mappedStatus}, true,
              ${wlAppDate || null}, ${wlExpiry || null},
              ${wlComments || null}, NOW()
            )
            ON CONFLICT (pipeline_project_id, approval_type_id)
            DO UPDATE SET
              status = ${mappedStatus},
              expiry_date = EXCLUDED.expiry_date,
              notes = EXCLUDED.notes,
              last_synced_at = NOW()
          `;
        }
      }

    } catch (e) {
      stats.errored++;
      errors.push({ ss_row_id: ssRowId, error: e.message });
      console.error(`Error on row ${ssRowId}:`, e.message);
    }
  }

  const durationMs = Date.now() - startTime;

  // Update history
  await sql`
    UPDATE smartsheet_sync_history SET
      sync_completed_at = NOW(),
      duration_ms = ${durationMs},
      status = ${errors.length > 0 ? 'partial' : 'completed'},
      rows_processed = ${stats.processed},
      rows_created = ${stats.created},
      rows_updated = ${stats.updated},
      rows_skipped = ${stats.skipped},
      rows_errored = ${stats.errored},
      error_details = ${JSON.stringify(errors)}
    WHERE id = ${history.id}
  `;

  // Update config
  await sql`
    UPDATE smartsheet_sync_config SET
      last_sync_at = NOW(),
      last_sync_status = ${errors.length > 0 ? 'partial' : 'completed'},
      last_sync_rows_processed = ${stats.processed}
    WHERE id = ${config.id}
  `;

  console.log('\n=== Sync Complete ===');
  console.log(`Duration: ${durationMs}ms`);
  console.log(`Processed: ${stats.processed}`);
  console.log(`Created: ${stats.created}`);
  console.log(`Updated: ${stats.updated}`);
  console.log(`Skipped: ${stats.skipped}`);
  console.log(`Errors: ${stats.errored}`);

  if (errors.length > 0) {
    console.log('\nFirst 5 errors:');
    errors.slice(0, 5).forEach(e => console.log(`  Row ${e.ss_row_id}: ${e.error}`));
  }
}

runSync().catch(console.error);
