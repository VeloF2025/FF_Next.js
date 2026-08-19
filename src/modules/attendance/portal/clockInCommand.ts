import { log } from '@/lib/logger';
import { VFStorageService } from '@/services/vfStorageAdapter';
import { syncStaffProfilePhotoFromSelfie } from '@/services/staff/profilePhotoFromSelfie';
import { findRequiredAttendanceAction } from '@/modules/attendance/workflow/requiredActionQueries';
import { matchGeofence } from './geofenceUtils';
import { storeSelfie } from './selfieUtils';
import { finalizeClockIn } from './clockInFinalization';
import {
  captureRateAtClockIn,
  findActiveVehicleAssignment,
  findOpenEntry,
  getSelfieConsentState,
  insertException,
  sastWorkDate,
} from './clockUtils';

const CLOCK_SKEW_MAX_MS = 2 * 60 * 1000;
const LOW_ACCURACY_M = 100;

export interface ClockInCommandArgs {
  staffId: string;
  lat: number;
  lon: number;
  accuracyM: number | null;
  clientOccurredAt: Date;
  selfieBase64: string;
  deviceFingerprint: string | null;
  deviceUserAgent: string | null;
}

interface ClockInSuccessData {
  entryId: string;
  workDate: string;
  clockInAt: string;
  siteId: string | null;
  siteName: string | null;
  insideSite: boolean;
  vehicleAssignmentId: string | null;
  selfieUrl: string;
}

export type ClockInCommandResult =
  | { ok: true; data: ClockInSuccessData }
  | {
      ok: false;
      kind: 'bad_request' | 'forbidden' | 'conflict';
      message: string;
      details: Record<string, unknown>;
    };

export async function executeClockInCommand(
  args: ClockInCommandArgs,
): Promise<ClockInCommandResult> {
  let stage = 'init';
  let uploadedSelfiePath: string | null = null;
  try {
    const serverNow = new Date();
    const workDate = sastWorkDate(serverNow);
    const skewMs = Math.abs(args.clientOccurredAt.getTime() - serverNow.getTime());
    if (skewMs > CLOCK_SKEW_MAX_MS) {
      log.info('[my-clock-in] rejected: clock skew', { staffId: args.staffId, skewMs });
      return rejected(
        'bad_request',
        'Device clock is out of sync. Please check your phone time and try again.',
        { reason: 'clock_skew', skewMs },
      );
    }

    stage = 'consent_check';
    const consent = await getSelfieConsentState(args.staffId);
    if (consent !== 'granted') {
      log.info('[my-clock-in] rejected: no selfie consent', {
        staffId: args.staffId,
        consentState: consent,
      });
      return rejected(
        'forbidden',
        consent === 'missing'
          ? 'Your account is not set up for the /my portal yet. Please contact HR.'
          : 'Selfie consent is required before clocking in. Please complete the consent screen.',
        { reason: 'consent_required', consentState: consent },
      );
    }

    stage = 'open_entry_check';
    const existing = await findOpenEntry(args.staffId);
    if (existing) {
      log.info('[my-clock-in] rejected: existing open entry', {
        staffId: args.staffId,
        openEntryId: existing.id,
      });
      return rejected(
        'conflict',
        'You already have an open attendance entry. Close it before clocking in again.',
        { reason: 'open_entry', openEntryId: existing.id, openedAt: existing.clock_in_at },
      );
    }

    stage = 'required_action_check';
    const requiredAction = await findRequiredAttendanceAction(args.staffId, workDate);
    if (requiredAction) {
      log.info('[my-clock-in] rejected: prior correction required', {
        staffId: args.staffId,
        exceptionId: requiredAction.exceptionId,
      });
      return rejected(
        'conflict',
        'Submit the missing clock-out correction before clocking in.',
        { reason: 'prior_correction_required', ...requiredAction },
      );
    }

    stage = 'parallel_lookups';
    // Independent lookups — keep them parallel. A worker is standing there
    // waiting, and the selfie upload is still to come.
    //
    // Accuracy is passed to matchGeofence so a fix outside a hull by less
    // than the device's own error margin is not counted as a mismatch.
    const [vehicleAssignment, geofence] = await Promise.all([
      findActiveVehicleAssignment(args.staffId),
      matchGeofence({
        device: { lat: args.lat, lon: args.lon },
        accuracyM: args.accuracyM ?? null,
      }),
    ]);

    stage = 'selfie_upload';
    const selfie = await storeSelfie({
      base64: args.selfieBase64,
      staffId: args.staffId,
      workDate,
      kind: 'in',
    });
    uploadedSelfiePath = selfie.path;

    stage = 'finalize_entry';
    const finalized = await finalizeClockIn({
      staffId: args.staffId,
      clockInAt: serverNow,
      clientOccurredAt: args.clientOccurredAt,
      workDate,
      lat: args.lat,
      lon: args.lon,
      accuracyM: args.accuracyM,
      selfieInUrl: selfie.url,
      vehicleAssignmentId: vehicleAssignment?.id ?? null,
      siteGeofenceId: null,
      deviceFingerprint: args.deviceFingerprint,
      deviceUserAgent: args.deviceUserAgent,
    });
    if (!finalized.ok) {
      if (uploadedSelfiePath) await cleanupOrphanSelfie(args.staffId, uploadedSelfiePath);
      if (finalized.reason === 'open_entry') {
        return rejected('conflict', 'You already have an open attendance entry.', {
          reason: 'open_entry', raced: true,
          openEntryId: finalized.entry.id, openedAt: finalized.entry.clock_in_at,
        });
      }
      return rejected('conflict', 'Submit the missing clock-out correction before clocking in.', {
        reason: 'prior_correction_required', raced: true, ...finalized.action,
      });
    }
    const entry = finalized.entry;

    stage = 'rate_snapshot';
    await captureRateAtClockIn(entry.id, args.staffId);
    await syncProfilePhoto(args.staffId, entry.id, selfie.url);

    stage = 'post_insert_exceptions';
    // Only a real miss. `withinAccuracy` covers a fix outside the hull by
    // less than the device's reported error — indistinguishable from inside,
    // so flagging it would manufacture a violation the data cannot support.
    if (!geofence.inside && !geofence.withinAccuracy) {
      await insertException({
        entryId: entry.id,
        kind: 'geofence_mismatch',
        severity: 'warning',
        details: {
          lat: args.lat,
          lon: args.lon,
          nearest_project_id: geofence.projectId,
          nearest_project_name: geofence.projectName,
          distance_m: geofence.distanceM,
          accuracy_m: args.accuracyM ?? null,
          // Distinguishes "no AOIs loaded" (a refresh failure) from
          // "genuinely far from every site".
          no_aoi_available: geofence.projectId === null,
        },
      });
    }
    if (args.accuracyM != null && args.accuracyM > LOW_ACCURACY_M) {
      await insertException({
        entryId: entry.id,
        kind: 'low_accuracy',
        severity: 'info',
        details: { reason: 'low_accuracy', accuracy_m: args.accuracyM },
      });
    }

    log.info('[my-clock-in] success', {
      staffId: args.staffId,
      entryId: entry.id,
      workDate,
      siteId: geofence.projectId,
      insideSite: geofence.inside,
      hasVehicle: vehicleAssignment != null,
    });
    return {
      ok: true,
      data: {
        entryId: entry.id,
        workDate: entry.work_date,
        clockInAt: String(entry.clock_in_at),
        // NOTE: these two now carry PROJECT identity, not a
        // fleet_authorized_locations id. The names are kept because the /my
        // PWA reads them from a cached bundle (useClockSubmission renders
        // "Clocked in at {siteName}"), and renaming would break that message
        // for anyone on an old build. That message has in fact never
        // displayed until now — insideSite was always false.
        siteId: geofence.projectId,
        siteName: geofence.projectName,
        insideSite: geofence.inside,
        vehicleAssignmentId: vehicleAssignment?.id ?? null,
        selfieUrl: selfie.url,
      },
    };
  } catch (error) {
    const pgCode = (error as { code?: string } | null)?.code;
    if (pgCode === '23505' && stage === 'finalize_entry') {
      log.info('[my-clock-in] lost race on open-entry unique index', {
        staffId: args.staffId,
        uploadedSelfiePath,
      });
      if (uploadedSelfiePath) await cleanupOrphanSelfie(args.staffId, uploadedSelfiePath);
      const winner = await findOpenEntry(args.staffId).catch(() => null);
      return rejected('conflict', 'You already have an open attendance entry.', {
        reason: 'open_entry', raced: true,
        openEntryId: winner?.id ?? null, openedAt: winner?.clock_in_at ?? null,
      });
    }
    logUnexpected(error, args.staffId, stage, uploadedSelfiePath);
    throw error;
  }
}

function rejected(
  kind: 'bad_request' | 'forbidden' | 'conflict',
  message: string,
  details: Record<string, unknown>,
): ClockInCommandResult {
  return { ok: false, kind, message, details };
}

async function syncProfilePhoto(staffId: string, entryId: string, selfieUrl: string): Promise<void> {
  try {
    await syncStaffProfilePhotoFromSelfie(staffId, selfieUrl);
  } catch (error) {
    log.error('[my-clock-in] profile_photo_sync failed', {
      staffId, entryId, error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function cleanupOrphanSelfie(staffId: string, fullPath: string): Promise<void> {
  try {
    const trimmed = fullPath.replace(/^\/+/, '').replace(/^attendance\//, '');
    const [workDate, ...rest] = trimmed.split('/').slice(1);
    const fileName = rest.join('/');
    if (!workDate || !fileName) return;
    const storage = new VFStorageService();
    const del = (storage as unknown as {
      deleteFile?: (type: string, category: string, file: string) => Promise<unknown>;
    }).deleteFile;
    if (typeof del === 'function') {
      await del.call(storage, 'attendance', `${staffId}/${workDate}`, fileName);
    }
    log.info('[my-clock-in] orphan selfie cleaned up', { staffId, path: fullPath });
  } catch (error) {
    log.warn('[my-clock-in] orphan selfie cleanup failed — retention cron will sweep it', {
      staffId, path: fullPath,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}


function logUnexpected(
  error: unknown,
  staffId: string,
  stage: string,
  uploadedSelfiePath: string | null,
): void {
  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack : undefined;
  log.error('[my-clock-in] unexpected error', {
    staffId, stage, uploadedSelfiePath, error: message, stack,
  });
  process.stderr.write(JSON.stringify({
    level: 'ERROR', component: 'attendance-clock-in', event: 'unexpected_error',
    staffId, stage, uploadedSelfiePath, error: message, stack,
    timestamp: new Date().toISOString(),
  }) + '\n');
}
