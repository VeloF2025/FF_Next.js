/**
 * POST /api/construction-qa/push-qfield-comment
 *
 * Pushes QA decision notes back to QFieldCloud as a delta update
 * on the "Q/A Civil Comments" column of the project's GPKG.
 *
 * Called automatically after a REWORK/FAIL decision is recorded.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { withAuth, withPermission } from '@/lib/auth/middleware';
import { exec } from 'child_process';
import { promisify } from 'util';

const sql = neon(process.env.DATABASE_URL!);
const execAsync = promisify(exec);

const QFCLOUD_TOKEN = process.env.QFCLOUD_API_TOKEN || 'y1S3bv0yBHAvAKhjpHWy1Wigg8IDqBeWiTdlRkiYBjEoFbcq8h62ZIjaeberPGooAFVMoq6xo6PeNhgSPJycVcpvqLZDErcViskP';
// Use docker internal network (nginx → app) since host port may be flaky
const QFCLOUD_URL = 'http://localhost:8082/api/v1';

/** Project config: QFieldCloud project → GPKG details for comment push */
const PROJECT_CONFIG: Record<string, {
  qfProjectId: string;
  tableName: string;
  labelCol: string;
  commentCol: string;
  statusCol: string;
  qaDateCol: string;
  sourceLayerId: string;
}> = {
  '4eb13426-b2a1-472d-9b3c-277082ae9b55': { // Lawley
    qfProjectId: '2e988631-462b-448f-ae15-bb693a68cd55',
    tableName: 'LAWPoles',
    labelCol: 'label',
    commentCol: 'Q/A Civil Comments',
    statusCol: 'Status',
    qaDateCol: 'Q/A Date',
    sourceLayerId: '', // resolved dynamically
  },
  'bf9a90db-e758-4c05-b999-694cd63c451f': { // Mohadin
    qfProjectId: 'bec5f353-2e83-4f6b-989a-fca83ad94e16',
    tableName: 'MOAPoles',
    labelCol: 'label',
    commentCol: 'QA Civil Comments',
    statusCol: 'Status',
    qaDateCol: 'QA Date',
    sourceLayerId: '',
  },
  '7003dc06-9af7-4a7c-bc6c-a177d77784f2': { // Mamelodi
    qfProjectId: '2ce80264-170c-4f05-ada1-68220d7e5885',
    tableName: 'MAMPoles',
    labelCol: 'label',
    commentCol: 'Q/A Civil Comments',
    statusCol: 'Status',
    qaDateCol: 'Q/A Date',
    sourceLayerId: '',
  },
  'ce3bf310-d6ba-4ede-ab36-a8c902a5efc6': { // Tonga
    qfProjectId: '7fe59cdc-b1d5-475d-8448-5cf2e9f7175b',
    tableName: 'civil_audit',
    labelCol: 'Pole Label',
    commentCol: 'Q/A Civil Comments',
    statusCol: 'Status',
    qaDateCol: 'Q/A Date',
    sourceLayerId: '',
  },
};

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method || 'unknown', ['POST']);
  }

  try {
    const { reviewId } = req.body;
    if (!reviewId) {
      return apiResponse.badRequest(res, 'reviewId is required');
    }

    // Get review details
    const reviews = await sql`
      SELECT r.id, r.project_id, r.feature_id, r.qa_decision, r.qa_notes,
             r.qa_reason_code, r.qa_decision_by, r.qa_decision_at, r.discipline
      FROM construction_qa_reviews r
      WHERE r.id = ${reviewId}::uuid
    `;

    if (reviews.length === 0) {
      return apiResponse.notFound(res, 'Review', reviewId);
    }

    const review = reviews[0]!;
    const projectId = review.project_id as string;
    const config = PROJECT_CONFIG[projectId];

    if (!config) {
      return apiResponse.success(res, {
        reviewId,
        pushed: false,
        reason: 'Project not configured for QField push-back',
      });
    }

    // Only push for civil discipline
    if (review.discipline !== 'civil') {
      return apiResponse.success(res, {
        reviewId,
        pushed: false,
        reason: 'QField push-back only supported for civil discipline',
      });
    }

    const featureId = review.feature_id as string;
    const decision = review.qa_decision as string;
    const notes = review.qa_notes as string || '';
    const decidedBy = review.qa_decision_by as string || 'QA';
    const decisionDate = new Date().toISOString().replace('T', ' ').slice(0, 19);

    // Build the comment text
    const decisionLabel = decision === 'FAIL' ? 'REJECTED' : decision === 'REWORK_NEEDED' ? 'REWORK' : 'APPROVED';
    const comment = `[${decisionLabel}] ${decisionDate} by ${decidedBy}: ${notes}`.slice(0, 1000);

    // Find the feature's fid in the GPKG by looking it up
    const fid = await resolveFeatureFid(config.qfProjectId, config.tableName, config.labelCol, featureId);
    if (fid === null) {
      log.warn('QField push-back: feature not found in GPKG', {
        module: 'cqa-qfield-push',
        featureId,
        project: config.qfProjectId,
      });
      return apiResponse.success(res, {
        reviewId,
        pushed: false,
        reason: `Feature ${featureId} not found in GPKG`,
      });
    }

    // Resolve the sourceLayerId from an existing delta
    const layerId = await resolveLayerId(config.qfProjectId, config.tableName);
    if (!layerId) {
      return apiResponse.success(res, {
        reviewId,
        pushed: false,
        reason: 'Could not resolve QFieldCloud layer ID',
      });
    }

    // Create the delta
    const deltaContent = {
      uuid: crypto.randomUUID(),
      clientId: crypto.randomUUID(),
      exportId: crypto.randomUUID(),
      localPk: String(fid),
      sourcePk: String(fid),
      localLayerId: layerId,
      sourceLayerId: layerId,
      localLayerName: config.tableName,
      localLayerCrs: 'EPSG:4326',
      method: 'patch',
      old: {
        attributes: { [config.commentCol]: null },
        is_snapshot: true,
      },
      new: {
        attributes: {
          [config.commentCol]: comment,
          [config.statusCol]: decisionLabel === 'APPROVED' ? 'QA Approved' : `QA ${decisionLabel}`,
          [config.qaDateCol]: new Date().toISOString(),
        },
        is_snapshot: false,
      },
    };

    // Push delta via QFieldCloud API
    const pushed = await pushDelta(config.qfProjectId, deltaContent);

    if (pushed) {
      log.info('QField comment pushed', {
        module: 'cqa-qfield-push',
        reviewId,
        featureId,
        decision,
      });
    }

    return apiResponse.success(res, {
      reviewId,
      pushed,
      featureId,
      comment: comment.slice(0, 100),
    });
  } catch (error) {
    log.error('QField push-back error', {
      module: 'cqa-qfield-push',
      error: (error as Error).message,
    });
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(withPermission('construction-qa.qa-centre')(handler));

/** Look up the fid of a feature in the GPKG by its label column value. */
async function resolveFeatureFid(
  qfProjectId: string,
  tableName: string,
  labelCol: string,
  featureId: string,
): Promise<number | null> {
  try {
    // Download latest GPKG version and query it
    const { stdout: lsOut } = await execAsync(
      `docker exec qfieldcloud-minio-1 mc ls "local/qfieldcloud-prod/projects/${qfProjectId}/files/" 2>/dev/null | grep gpkg`,
      { encoding: 'utf-8' },
    );

    // Find the GPKG file
    const gpkgDirs = lsOut.trim().split('\n').filter(Boolean);
    let gpkgName = '';
    for (const line of gpkgDirs) {
      const parts = line.trim().split(/\s+/);
      const name = parts[parts.length - 1]?.replace(/\/$/, '') || '';
      if (name.toLowerCase().includes(tableName.toLowerCase()) || name.toLowerCase().includes('audit') || name.toLowerCase().includes('poles')) {
        gpkgName = name;
        break;
      }
    }

    if (!gpkgName) return null;

    // Get latest version
    const { stdout: verOut } = await execAsync(
      `docker exec qfieldcloud-minio-1 mc ls "local/qfieldcloud-prod/projects/${qfProjectId}/files/${gpkgName}/" 2>/dev/null | tail -1`,
      { encoding: 'utf-8' },
    );
    const verParts = verOut.trim().split(/\s+/);
    const version = verParts[verParts.length - 1];
    if (!version || !version.startsWith('v')) return null;

    // Download and query
    const tmpPath = `/tmp/qf-push-${qfProjectId.slice(0, 8)}.gpkg`;
    await execAsync(
      `docker exec qfieldcloud-minio-1 mc cat "local/qfieldcloud-prod/projects/${qfProjectId}/files/${gpkgName}/${version}" > ${tmpPath}`,
      { maxBuffer: 50 * 1024 * 1024 },
    );

    // Use Python sqlite3 to query
    const { stdout: fidOut } = await execAsync(
      `python3 -c "
import sqlite3, sys
db = sqlite3.connect('${tmpPath}')
cur = db.execute('SELECT fid FROM ${tableName} WHERE \\\"${labelCol}\\\" = ?', ('${featureId.replace(/'/g, "''")}',))
row = cur.fetchone()
print(row[0] if row else '')
db.close()
"`,
      { encoding: 'utf-8' },
    );

    const fid = fidOut.trim();
    return fid ? Number(fid) : null;
  } catch {
    return null;
  }
}

/** Resolve the QFieldCloud sourceLayerId from an existing delta. */
async function resolveLayerId(qfProjectId: string, tableName: string): Promise<string | null> {
  try {
    const { stdout } = await execAsync(
      `docker exec qfieldcloud-app-1 python manage.py shell -c "
from qfieldcloud.core.models import Delta
d = Delta.objects.filter(project_id='${qfProjectId}').order_by('-created_at').first()
print(d.content.get('sourceLayerId', '') if d else '')
" 2>/dev/null`,
      { encoding: 'utf-8' },
    );
    const layerId = stdout.trim().split('\n').pop()?.trim() || '';
    return layerId || null;
  } catch {
    return null;
  }
}

/** Push a delta to QFieldCloud via the REST API (through docker internal network). */
async function pushDelta(
  qfProjectId: string,
  deltaContent: Record<string, unknown>,
): Promise<boolean> {
  try {
    // QFieldCloud deltafile format requires a wrapper object
    const deltaFileContent = {
      version: '1.0',
      project: qfProjectId,
      id: crypto.randomUUID(),
      deltas: [deltaContent],
      files: [],
    };
    const tmpDelta = `/tmp/qf-delta-${Date.now()}.json`;

    // Write delta file to host filesystem
    const { writeFileSync, unlinkSync } = await import('fs');
    writeFileSync(tmpDelta, JSON.stringify(deltaFileContent));

    // Copy delta file into nginx container, then POST from inside the container
    await execAsync(`docker cp ${tmpDelta} qfieldcloud-nginx-1:/tmp/delta.json`);

    const curlCmd = `docker exec qfieldcloud-nginx-1 curl -s -X POST "http://app:8000/api/v1/deltas/${qfProjectId}/" ` +
      `-H "Authorization: Token ${QFCLOUD_TOKEN}" ` +
      `-F "file=@/tmp/delta.json;type=application/json"`;

    const { stdout } = await execAsync(curlCmd, { encoding: 'utf-8', timeout: 30000 });

    // Clean up
    try { unlinkSync(tmpDelta); } catch { /* ignore */ }
    try { await execAsync('docker exec qfieldcloud-nginx-1 rm -f /tmp/delta.json'); } catch { /* ignore */ }

    if (stdout.includes('error') || stdout.includes('permission_denied')) {
      log.error('QField delta push rejected', { module: 'cqa-qfield-push', response: stdout.slice(0, 300) });
      return false;
    }

    log.info('QField delta uploaded', { module: 'cqa-qfield-push', response: stdout.slice(0, 200) });

    // Trigger delta apply
    const applyCmd = `docker exec qfieldcloud-nginx-1 curl -s -X POST "http://app:8000/api/v1/deltas/apply/${qfProjectId}/" ` +
      `-H "Authorization: Token ${QFCLOUD_TOKEN}" ` +
      `-H "Content-Type: application/json"`;

    await execAsync(applyCmd, { encoding: 'utf-8', timeout: 30000 });

    return true;
  } catch (error) {
    log.error('QField delta push error', {
      module: 'cqa-qfield-push',
      error: (error as Error).message,
    });
    return false;
  }
}
