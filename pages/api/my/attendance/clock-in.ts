/**
 * POST /api/my/attendance/clock-in
 *
 * Opens a new attendance entry for the authenticated staff member. Expects:
 *   {
 *     lat:                 number,
 *     lon:                 number,
 *     accuracy_m?:         number,
 *     client_occurred_at:  ISO string — when the device says the clock happened,
 *     selfie_base64:       string,    — data-URL or raw base64 of a JPEG/PNG,
 *     device_fingerprint?: string,
 *     notes?:              string
 *   }
 *
 * Behaviour:
 *   - Rejects if selfie consent has not been captured (POPIA s26).
 *   - Rejects if |client_occurred_at − server_now| > 2 min → clock_skew exception logged server-side, 400 to client.
 *   - Rejects with 409 `{ reason: 'open_entry', openEntryId }` if an open entry already exists.
 *   - Resolves the nearest active site geofence; logs a `geofence_mismatch` exception when GPS isn't inside any radius but does NOT block the clock-in (field staff at unmapped sites must still be able to work).
 *   - Snapshots the active vehicle_assignment if any.
 *   - Uploads the resized selfie to VF Storage before the DB INSERT so a mid-flow failure doesn't leave a half-open entry referencing a missing image.
 */

import { apiResponse, ErrorCode } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { sql } from '@/lib/db-pool';
import { isValidLatLon } from '@/lib/geo';
import { VFStorageService } from '@/services/vfStorageAdapter';
import { withMySession } from '@/modules/attendance/portal/authMiddleware';
import { matchGeofence } from '@/modules/attendance/portal/geofenceUtils';
import { storeSelfie } from '@/modules/attendance/portal/selfieUtils';
import {
  findOpenEntry,
  findActiveVehicleAssignment,
  getSelfieConsentState,
  captureRateAtClockIn,
  insertClockIn,
  insertException,
  sastWorkDate,
} from '@/modules/attendance/portal/clockUtils';

export const config = {
  api: {
    bodyParser: { sizeLimit: '12mb' }, // headroom for a 10 MB raw phone selfie
  },
};

const CLOCK_SKEW_MAX_MS = 2 * 60 * 1000;
/**
 * Accuracy threshold above which we log a `low_accuracy` exception. 100 m
 * is loose enough to avoid noise from normal phone GPS in urban canyons,
 * tight enough to flag basement / cell-tower-only readings that are
 * effectively unusable for geofence enforcement.
 */
const LOW_ACCURACY_M = 100;

interface ClockInBody {
  lat?: number;
  lon?: number;
  accuracy_m?: number;
  client_occurred_at?: string;
  selfie_base64?: string;
  device_fingerprint?: string;
  notes?: string;
}

export default withMySession(async (req, res, session) => {
  if (req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method ?? 'UNKNOWN', ['POST']);
  }

  const body = (req.body ?? {}) as ClockInBody;
  if (!isValidLatLon({ lat: body.lat, lon: body.lon })) {
    return apiResponse.badRequest(res, 'lat and lon are required and must be valid coordinates');
  }
  if (typeof body.client_occurred_at !== 'string' || Number.isNaN(Date.parse(body.client_occurred_at))) {
    return apiResponse.badRequest(res, 'client_occurred_at must be a valid ISO timestamp');
  }
  if (typeof body.selfie_base64 !== 'string' || body.selfie_base64.length < 100) {
    return apiResponse.badRequest(res, 'selfie_base64 is required');
  }

  const lat = body.lat as number;
  const lon = body.lon as number;
  const accuracyM =
    typeof body.accuracy_m === 'number' && Number.isFinite(body.accuracy_m)
      ? body.accuracy_m
      : null;
  const clientOccurredAt = new Date(body.client_occurred_at);
  const deviceFingerprint =
    typeof body.device_fingerprint === 'string' ? body.device_fingerprint.slice(0, 256) : null;

  let stage = 'init';
  let uploadedSelfiePath: string | null = null;
  try {
    // Cheapest check first — no DB round-trip needed.
    const serverNow = new Date();
    const skewMs = Math.abs(clientOccurredAt.getTime() - serverNow.getTime());
    if (skewMs > CLOCK_SKEW_MAX_MS) {
      log.info('[my-clock-in] rejected: clock skew', { staffId: session.staffId, skewMs });
      return apiResponse.badRequest(
        res,
        'Device clock is out of sync. Please check your phone time and try again.',
        { reason: 'clock_skew', skewMs }
      );
    }

    // POPIA consent gate. Distinguish "missing" (never onboarded) from
    // "revoked" (previously granted, now rescinded) so the error message
    // is honest to the user and onboarding gaps are visible to ops.
    stage = 'consent_check';
    const consent = await getSelfieConsentState(session.staffId);
    if (consent !== 'granted') {
      log.info('[my-clock-in] rejected: no selfie consent', {
        staffId: session.staffId,
        consentState: consent,
      });
      return apiResponse.error(
        res,
        ErrorCode.FORBIDDEN,
        consent === 'missing'
          ? 'Your account is not set up for the /my portal yet. Please contact HR.'
          : 'Selfie consent is required before clocking in. Please complete the consent screen.',
        { reason: 'consent_required', consentState: consent }
      );
    }

    // Open-entry check — prevents double clock-in and surfaces "forgot to
    // clock out yesterday" to the UI. Advisory only; the partial-unique
    // index on attendance_entries is the authoritative gate (see 23505
    // handling below).
    stage = 'open_entry_check';
    const existing = await findOpenEntry(session.staffId);
    if (existing) {
      log.info('[my-clock-in] rejected: existing open entry', {
        staffId: session.staffId,
        openEntryId: existing.id,
      });
      return apiResponse.error(
        res,
        ErrorCode.CONFLICT,
        'You already have an open attendance entry. Close it before clocking in again.',
        { reason: 'open_entry', openEntryId: existing.id, openedAt: existing.clock_in_at }
      );
    }

    // Resolve all three side-channels in parallel.
    stage = 'parallel_lookups';
    const [homeSiteId, vehicleAssignment] = await Promise.all([
      getHomeSiteId(session.staffId),
      findActiveVehicleAssignment(session.staffId),
    ]);
    const geofence = await matchGeofence({ device: { lat, lon }, homeSiteId });

    // Upload selfie BEFORE the INSERT. Failure mode: upload throws →
    // clock-in fails cleanly, no DB row left with a null selfie URL.
    // Race mode: upload succeeds but INSERT fails with unique-violation
    // (23505) because a concurrent request opened an entry first — in
    // that case we best-effort-delete the orphan file below.
    stage = 'selfie_upload';
    const workDate = sastWorkDate(serverNow);
    const selfie = await storeSelfie({
      base64: body.selfie_base64 as string,
      staffId: session.staffId,
      workDate,
      kind: 'in',
    });
    uploadedSelfiePath = selfie.path;

    stage = 'insert_entry';
    const entry = await insertClockIn({
      staffId: session.staffId,
      clockInAt: serverNow,
      clientOccurredAt,
      workDate,
      lat,
      lon,
      accuracyM,
      selfieInUrl: selfie.url,
      vehicleAssignmentId: vehicleAssignment?.id ?? null,
      siteGeofenceId: geofence.siteId,
      deviceFingerprint,
      deviceUserAgent: req.headers['user-agent']?.slice(0, 512) ?? null,
    });

    // Post-INSERT hourly-rate snapshot (migration 325). Best-effort:
    // a failure logs and the reconcile cron falls back to reading the
    // current staff.hourly_rate at compute time (PR #1406 behaviour).
    stage = 'rate_snapshot';
    await captureRateAtClockIn(entry.id, session.staffId);

    // Post-INSERT exception logging — non-blocking (insertException
    // swallows its own errors to a log.error, see clockUtils.ts).
    stage = 'post_insert_exceptions';
    if (!geofence.inside) {
      // Fallback-to-home is still a geofence mismatch for supervisor
      // review — use 'warning', not 'info', so the supervisor queue sees it.
      await insertException({
        entryId: entry.id,
        kind: 'geofence_mismatch',
        severity: 'warning',
        details: {
          lat,
          lon,
          matched_site_id: geofence.siteId,
          fallback_to_home: geofence.fallback,
          distance_m: geofence.distanceM,
        },
      });
    }
    // Low-accuracy readings (GPS lock loss, basement Wi-Fi positioning)
    // produce clock-ins with meaningless coordinates — flag them.
    if (accuracyM != null && accuracyM > LOW_ACCURACY_M) {
      await insertException({
        entryId: entry.id,
        kind: 'geofence_mismatch',
        severity: 'info',
        details: { reason: 'low_accuracy', accuracy_m: accuracyM },
      });
    }

    log.info('[my-clock-in] success', {
      staffId: session.staffId,
      entryId: entry.id,
      workDate,
      siteId: geofence.siteId,
      insideSite: geofence.inside,
      hasVehicle: vehicleAssignment != null,
    });

    return apiResponse.success(res, {
      entryId: entry.id,
      workDate: entry.work_date,
      clockInAt: entry.clock_in_at,
      siteId: geofence.siteId,
      siteName: geofence.siteName,
      insideSite: geofence.inside,
      vehicleAssignmentId: vehicleAssignment?.id ?? null,
      selfieUrl: selfie.url,
    });
  } catch (err) {
    // Race: another request opened the entry between findOpenEntry and
    // INSERT. Postgres 23505 on the partial-unique index. Return a clean
    // 409 with the same reason code as the pre-INSERT advisory check
    // (plus `raced: true` so the client / Sentry can tell them apart),
    // and best-effort delete the orphan selfie we uploaded.
    const pgCode = (err as { code?: string } | null)?.code;
    if (pgCode === '23505' && stage === 'insert_entry') {
      log.info('[my-clock-in] lost race on open-entry unique index', {
        staffId: session.staffId,
        uploadedSelfiePath,
      });
      if (uploadedSelfiePath) {
        await cleanupOrphanSelfie(session.staffId, uploadedSelfiePath).catch((cleanupErr) => {
          // Best-effort cleanup — the selfie is orphaned on failure but the
          // user's clock-in already won the race, so we just warn.
          log.warn('[my-clock-in] orphan selfie cleanup failed', {
            staffId: session.staffId,
            uploadedSelfiePath,
            error: cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr),
          });
        });
      }
      // Look up the winning entry so the UI can show the user they're
      // already clocked in.
      const winner = await findOpenEntry(session.staffId).catch(() => null);
      return apiResponse.error(
        res,
        ErrorCode.CONFLICT,
        'You already have an open attendance entry.',
        {
          reason: 'open_entry',
          raced: true,
          openEntryId: winner?.id ?? null,
          openedAt: winner?.clock_in_at ?? null,
        }
      );
    }

    // See #1434 rationale — @/lib/logger is in-memory in prod. Mirror to
    // stderr so the next 500 lands in the systemd journal for ops.
    const errMsg = err instanceof Error ? err.message : String(err);
    const errStack = err instanceof Error ? err.stack : undefined;
    log.error('[my-clock-in] unexpected error', {
      staffId: session.staffId,
      stage,
      uploadedSelfiePath,
      error: errMsg,
      stack: errStack,
    });
    process.stderr.write(
      JSON.stringify({
        level: 'ERROR',
        component: 'attendance-clock-in',
        event: 'unexpected_error',
        staffId: session.staffId,
        stage,
        uploadedSelfiePath,
        error: errMsg,
        stack: errStack,
        timestamp: new Date().toISOString(),
      }) + '\n'
    );
    return apiResponse.internalError(res, err);
  }
});

/**
 * Best-effort delete of an already-uploaded selfie when the subsequent
 * INSERT failed. Never throws — if cleanup fails, the file will be
 * swept by the POPIA 90-day retention cron.
 */
async function cleanupOrphanSelfie(staffId: string, fullPath: string): Promise<void> {
  try {
    // path shape: attendance/<staffId>/<workDate>/<fileName>
    const trimmed = fullPath.replace(/^\/+/, '').replace(/^attendance\//, '');
    const [workDate, ...rest] = trimmed.split('/').slice(1);
    const fileName = rest.join('/');
    if (!workDate || !fileName) return;
    const category = `${staffId}/${workDate}`;
    // VFStorageService.deleteFile(type, category, fileName) — best effort.
    const storage = new VFStorageService();
    const del = (storage as unknown as {
      deleteFile?: (t: string, c: string, f: string) => Promise<unknown>;
    }).deleteFile;
    if (typeof del === 'function') {
      await del.call(storage, 'attendance', category, fileName);
    }
    log.info('[my-clock-in] orphan selfie cleaned up', { staffId, path: fullPath });
  } catch (err) {
    log.warn('[my-clock-in] orphan selfie cleanup failed — retention cron will sweep it', {
      staffId,
      path: fullPath,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

async function getHomeSiteId(staffId: string): Promise<string | null> {
  const rows = await sql<{ home_site_id: string | null }>`
    SELECT home_site_id FROM staff WHERE id = ${staffId} LIMIT 1
  `;
  return rows[0]?.home_site_id ?? null;
}
