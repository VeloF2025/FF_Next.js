/**
 * POST /api/my/attendance/clock-out
 *
 * Closes the authenticated staff member's currently-open attendance entry.
 * Expects the same core shape as clock-in, minus site/vehicle resolution
 * (which are fixed at clock-in time and not re-snapshotted on clock-out):
 *   {
 *     lat: number,
 *     lon: number,
 *     accuracy_m?: number,
 *     client_occurred_at: ISO string,
 *     selfie_base64: string
 *   }
 *
 * Failure modes:
 *   - 404 if no open entry exists (user clicked clock-out without having clocked in)
 *   - 400 on clock skew > 2 min (same as clock-in — belt-and-braces)
 *   - 403 if selfie consent has been revoked since clock-in
 *
 * Unlike clock-in, clock-out does NOT re-check geofence; a staff member
 * can legitimately clock out from a slightly different spot (e.g. end of
 * day at the vehicle park vs morning at the site). Their device GPS is
 * still captured and stored for the record.
 */

import { apiResponse, ErrorCode } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { haversineDistanceM, isValidLatLon } from '@/lib/geo';
import { withMySession } from '@/modules/attendance/portal/authMiddleware';
import { storeSelfie } from '@/modules/attendance/portal/selfieUtils';
import {
  findOpenEntry,
  getSelfieConsentState,
  closeOpenEntry,
  insertException,
} from '@/modules/attendance/portal/clockUtils';
import { lookupActiveLock } from '@/modules/attendance/corrections/lockQueries';
import { isoWeekMonday } from '@/services/attendance/isoWeek';

export const config = {
  api: {
    bodyParser: { sizeLimit: '12mb' },
  },
};

const CLOCK_SKEW_MAX_MS = 2 * 60 * 1000;
/** Clock-out this far from clock-in is worth flagging (vehicle drove off
 *  with the phone, staff legitimately ended shift at depot, etc.). */
const LONG_DISTANCE_CLOCK_OUT_M = 50_000;

interface ClockOutBody {
  lat?: number;
  lon?: number;
  accuracy_m?: number;
  client_occurred_at?: string;
  selfie_base64?: string;
}

export default withMySession(async (req, res, session) => {
  if (req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method ?? 'UNKNOWN', ['POST']);
  }

  const body = (req.body ?? {}) as ClockOutBody;
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

  try {
    // Cheapest check first — skew doesn't need a DB round-trip.
    const serverNow = new Date();
    const skewMs = Math.abs(clientOccurredAt.getTime() - serverNow.getTime());
    if (skewMs > CLOCK_SKEW_MAX_MS) {
      log.info('[my-clock-out] rejected: clock skew', { staffId: session.staffId, skewMs });
      return apiResponse.badRequest(
        res,
        'Device clock is out of sync. Please check your phone time and try again.',
        { reason: 'clock_skew', skewMs }
      );
    }

    // Find the open entry BEFORE the consent check. If consent was revoked
    // mid-shift (HR action while the user is on site), the staff member
    // must still be able to close their already-opened entry — otherwise
    // they're stranded with a perpetually-open entry until the auto-close
    // cron fires, which warps the payroll day. POPIA s15(3)(a) allows
    // completing processing begun under prior consent.
    const open = await findOpenEntry(session.staffId);
    if (!open) {
      log.info('[my-clock-out] rejected: no open entry', { staffId: session.staffId });
      return apiResponse.error(
        res,
        ErrorCode.NOT_FOUND,
        'No open attendance entry to close. Clock in first.',
        { reason: 'no_open_entry' }
      );
    }

    // Lock guard: a staff member who clocked in before the week was
    // exported + auto-locked must NOT be able to close the entry via the
    // normal path — that would silently mutate a week that payroll has
    // already sealed. Route them to the corrections workflow instead, so
    // the clock-out change goes through supervisor review + unlock.
    const weekMonday = isoWeekMonday(open.work_date);
    const openWeekLock = await lookupActiveLock(weekMonday);
    if (openWeekLock) {
      log.warn('[my-clock-out] rejected: week is locked', {
        staffId: session.staffId,
        entryId: open.id,
        weekMonday,
      });
      return apiResponse.error(
        res,
        ErrorCode.CONFLICT,
        `Week ${weekMonday} has been locked for payroll. Ask your supervisor to submit a correction; your clock-out cannot be written directly.`,
        { reason: 'week_locked', weekMonday, entryId: open.id }
      );
    }

    const consent = await getSelfieConsentState(session.staffId);
    if (consent === 'missing') {
      // No credentials row at all — something's very wrong, can't proceed.
      log.error('[my-clock-out] missing credentials row on open entry — onboarding regression', {
        staffId: session.staffId,
        entryId: open.id,
      });
      return apiResponse.error(
        res,
        ErrorCode.FORBIDDEN,
        'Your account is not set up. Please contact HR to close this entry.',
        { reason: 'consent_required', consentState: consent }
      );
    }
    if (consent === 'revoked') {
      // Grandfather: allow close, log an exception so the supervisor
      // queue sees it, and continue. This preserves audit trail while
      // not stranding the user.
      log.info('[my-clock-out] grandfathering close on revoked consent', {
        staffId: session.staffId,
        entryId: open.id,
      });
      await insertException({
        entryId: open.id,
        kind: 'manual_override',
        severity: 'warning',
        details: { reason: 'consent_revoked_mid_shift' },
      });
    }

    // Upload selfie before the UPDATE so a failed upload can't leave an
    // already-closed entry with a null selfie_out_url.
    const selfie = await storeSelfie({
      base64: body.selfie_base64 as string,
      staffId: session.staffId,
      workDate: open.work_date,
      kind: 'out',
    });

    const closed = await closeOpenEntry({
      entryId: open.id,
      staffId: session.staffId,
      clockOutAt: serverNow,
      clientOccurredAt,
      lat,
      lon,
      accuracyM,
      selfieOutUrl: selfie.url,
    });

    if (!closed) {
      // Raced with another request that closed this entry, or the entry
      // changed hands somehow. The 409 is more honest than 500.
      log.warn('[my-clock-out] UPDATE affected 0 rows — entry changed under us', {
        staffId: session.staffId,
        entryId: open.id,
      });
      return apiResponse.error(
        res,
        ErrorCode.CONFLICT,
        'The attendance entry could not be closed. Please refresh and try again.',
        { reason: 'update_missed' }
      );
    }

    // Clock-out far from clock-in (vehicle drove off with the phone, etc.)
    // → log for supervisor review. Info severity: not abnormal for some
    // workflows (field staff ending shift at depot).
    if (open.clock_in_lat != null && open.clock_in_lon != null) {
      const inLat = Number(open.clock_in_lat);
      const inLon = Number(open.clock_in_lon);
      if (Number.isFinite(inLat) && Number.isFinite(inLon)) {
        const distanceM = haversineDistanceM({ lat, lon }, { lat: inLat, lon: inLon });
        if (distanceM > LONG_DISTANCE_CLOCK_OUT_M) {
          await insertException({
            entryId: closed.id,
            kind: 'vehicle_gps_mismatch',
            severity: 'info',
            details: { reason: 'clock_out_far_from_clock_in', distance_m: distanceM },
          });
        }
      }
    }

    const durationMs =
      new Date(closed.clock_out_at ?? serverNow).getTime() -
      new Date(closed.clock_in_at).getTime();

    log.info('[my-clock-out] success', {
      staffId: session.staffId,
      entryId: closed.id,
      durationMs,
      consentState: consent,
    });

    return apiResponse.success(res, {
      entryId: closed.id,
      clockInAt: closed.clock_in_at,
      clockOutAt: closed.clock_out_at,
      workDate: closed.work_date,
      durationMs,
      selfieUrl: selfie.url,
    });
  } catch (err) {
    log.error('[my-clock-out] unexpected error', {
      staffId: session.staffId,
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    return apiResponse.internalError(res, err);
  }
});
