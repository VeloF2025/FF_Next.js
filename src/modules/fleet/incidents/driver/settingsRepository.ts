/**
 * Effective-dated driver-input configuration: response window, post-closure
 * policy, recent/history visibility limits, evidence allowlist, and the two
 * notification events' channel defaults (migration 506,
 * `fleet_incident_driver_input_settings`). Mirrors
 * `../settingsRepository.ts`'s `versionIncidentRule`: lock the currently
 * open row, close it at the new activation instant, and insert
 * `version + 1` in one transaction — the table's
 * `ux_fleet_incident_driver_input_settings_open` partial unique index is
 * the concurrency backstop for "only one open version at a time".
 */
import { SIGNATURE_REGISTERED_TYPES } from '@/lib/vfStorageUpload';
import { queryOne, transaction } from '@/lib/db-pool';
import { parseStrictIsoInstant } from '../../operations/instantValidation';
import type { DriverConcernCategory, DriverInputSettings } from './types';

export class DriverInputSettingsValidationError extends Error {
  constructor(message: string) { super(message); this.name = 'DriverInputSettingsValidationError'; }
}

const SETTINGS_COLUMNS = `version, effective_from, effective_to, response_window_workdays,
  post_closure_response_enabled, post_closure_response_window_days, recent_window_days, history_window_days,
  enabled_concern_categories, evidence_allowed_mime_types, evidence_max_bytes,
  driver_input_requested_in_app, driver_input_requested_email, driver_input_requested_whatsapp,
  driver_response_received_in_app, driver_response_received_email, driver_response_received_whatsapp`;

interface SettingsRow extends Record<string, unknown> {
  version: number; effective_from: string | Date; effective_to: string | Date | null;
  response_window_workdays: number; post_closure_response_enabled: boolean; post_closure_response_window_days: number;
  recent_window_days: number; history_window_days: number; enabled_concern_categories: DriverConcernCategory[];
  evidence_allowed_mime_types: string[]; evidence_max_bytes: number;
  driver_input_requested_in_app: boolean; driver_input_requested_email: boolean; driver_input_requested_whatsapp: boolean;
  driver_response_received_in_app: boolean; driver_response_received_email: boolean; driver_response_received_whatsapp: boolean;
}

function iso(value: string | Date): string { return value instanceof Date ? value.toISOString() : value; }

function mapSettings(row: SettingsRow): DriverInputSettings {
  return {
    version: row.version, effectiveFrom: iso(row.effective_from), effectiveTo: row.effective_to ? iso(row.effective_to) : null,
    responseWindowWorkdays: row.response_window_workdays,
    postClosureResponseEnabled: row.post_closure_response_enabled,
    postClosureResponseWindowDays: row.post_closure_response_window_days,
    recentWindowDays: row.recent_window_days, historyWindowDays: row.history_window_days,
    enabledConcernCategories: row.enabled_concern_categories,
    evidenceAllowedMimeTypes: row.evidence_allowed_mime_types, evidenceMaxBytes: row.evidence_max_bytes,
    driverInputRequestedChannels: {
      inApp: row.driver_input_requested_in_app, email: row.driver_input_requested_email, whatsapp: row.driver_input_requested_whatsapp,
    },
    driverResponseReceivedChannels: {
      inApp: row.driver_response_received_in_app, email: row.driver_response_received_email, whatsapp: row.driver_response_received_whatsapp,
    },
  };
}

/** The settings version whose effective interval covers `at` (ISO instant). Throws rather than silently falling back — the seed row (version 1, `effective_from = now()` at migration time) always covers "now" in practice. */
export async function getEffectiveDriverInputSettings(at: string): Promise<DriverInputSettings> {
  const row = await queryOne<SettingsRow>(
    `SELECT ${SETTINGS_COLUMNS} FROM fleet_incident_driver_input_settings
     WHERE effective_from <= $1::timestamptz AND (effective_to IS NULL OR effective_to > $1::timestamptz)
     ORDER BY version DESC LIMIT 1`,
    [at],
  );
  if (!row) throw new Error(`No driver-input settings interval covers ${at}`);
  return mapSettings(row);
}

const CONCERN_CATEGORIES: readonly DriverConcernCategory[] = ['assignment_error', 'site_error', 'vehicle_error', 'geofence_error', 'other'];

export interface DriverInputSettingsChangeRequest {
  responseWindowWorkdays: number;
  postClosureResponseEnabled: boolean;
  postClosureResponseWindowDays: number;
  recentWindowDays: number;
  historyWindowDays: number;
  enabledConcernCategories: DriverConcernCategory[];
  evidenceAllowedMimeTypes: string[];
  evidenceMaxBytes: number;
  driverInputRequestedChannels: { inApp: boolean; email: boolean; whatsapp: boolean };
  driverResponseReceivedChannels: { inApp: boolean; email: boolean; whatsapp: boolean };
  effectiveFrom: string;
  changeReason?: string | null;
}

function validateChangeRequest(request: DriverInputSettingsChangeRequest): { effectiveFrom: string; reason: string | null } {
  const effectiveMs = parseStrictIsoInstant(request.effectiveFrom);
  if (effectiveMs === null) throw new DriverInputSettingsValidationError('effectiveFrom must be a valid ISO instant');
  if (!Number.isInteger(request.responseWindowWorkdays) || request.responseWindowWorkdays <= 0) {
    throw new DriverInputSettingsValidationError('responseWindowWorkdays must be a positive integer');
  }
  if (request.postClosureResponseEnabled) {
    if (!Number.isInteger(request.postClosureResponseWindowDays) || request.postClosureResponseWindowDays <= 0) {
      throw new DriverInputSettingsValidationError('postClosureResponseWindowDays must be a positive integer when post-closure response is enabled');
    }
  } else if (request.postClosureResponseWindowDays !== 0) {
    throw new DriverInputSettingsValidationError('postClosureResponseWindowDays must be 0 when post-closure response is disabled');
  }
  if (!Number.isInteger(request.recentWindowDays) || request.recentWindowDays <= 0
    || !Number.isInteger(request.historyWindowDays) || request.historyWindowDays <= 0) {
    throw new DriverInputSettingsValidationError('recentWindowDays and historyWindowDays must be positive integers');
  }
  if (request.historyWindowDays < request.recentWindowDays) {
    throw new DriverInputSettingsValidationError('historyWindowDays must be at least recentWindowDays');
  }
  if (request.enabledConcernCategories.length === 0
    || request.enabledConcernCategories.some((category) => !CONCERN_CATEGORIES.includes(category))) {
    throw new DriverInputSettingsValidationError('enabledConcernCategories must be a non-empty subset of the known categories');
  }
  if (request.evidenceAllowedMimeTypes.length === 0) {
    throw new DriverInputSettingsValidationError('evidenceAllowedMimeTypes must not be empty');
  }
  // Content verification fails closed: uploadCategorizedFile rejects any MIME type it has no
  // byte signature for. Allowing a type here without a registered signature would therefore
  // break every upload of it at runtime, with nothing tying the generic 'content does not
  // match the declared type' error back to the misconfiguration. Reject it at the point of
  // change instead, while an operator is present to read the message.
  const unverifiable = request.evidenceAllowedMimeTypes.filter((mimeType) => !SIGNATURE_REGISTERED_TYPES.includes(mimeType));
  if (unverifiable.length > 0) {
    throw new DriverInputSettingsValidationError(
      `evidenceAllowedMimeTypes contains types with no content signature, so uploads of them would always be rejected: ${unverifiable.join(', ')}`,
    );
  }
  if (!Number.isInteger(request.evidenceMaxBytes) || request.evidenceMaxBytes <= 0) {
    throw new DriverInputSettingsValidationError('evidenceMaxBytes must be a positive integer');
  }
  const reason = request.changeReason?.trim() || null;
  return { effectiveFrom: new Date(effectiveMs).toISOString(), reason };
}

export async function versionDriverInputSettings(
  request: DriverInputSettingsChangeRequest, actorUserId: string,
): Promise<DriverInputSettings> {
  const normalized = validateChangeRequest(request);
  return transaction(async (txn) => {
    const current = await txn.queryOne<SettingsRow>(
      `SELECT ${SETTINGS_COLUMNS} FROM fleet_incident_driver_input_settings WHERE effective_to IS NULL ORDER BY version DESC LIMIT 1 FOR UPDATE`,
    );
    if (!current) throw new DriverInputSettingsValidationError('No open driver-input settings version exists');
    if (new Date(normalized.effectiveFrom).getTime() <= new Date(iso(current.effective_from)).getTime()) {
      throw new DriverInputSettingsValidationError('effectiveFrom must be after the current version activation');
    }
    await txn.query(
      `UPDATE fleet_incident_driver_input_settings SET effective_to = $1::timestamptz WHERE version = $2`,
      [normalized.effectiveFrom, current.version],
    );
    const created = await txn.queryOne<SettingsRow>(
      `INSERT INTO fleet_incident_driver_input_settings
        (version, effective_from, response_window_workdays, post_closure_response_enabled, post_closure_response_window_days,
         recent_window_days, history_window_days, enabled_concern_categories, evidence_allowed_mime_types, evidence_max_bytes,
         driver_input_requested_in_app, driver_input_requested_email, driver_input_requested_whatsapp,
         driver_response_received_in_app, driver_response_received_email, driver_response_received_whatsapp,
         created_by, change_reason)
       VALUES ($1,$2::timestamptz,$3,$4,$5,$6,$7,$8::text[],$9::text[],$10,$11,$12,$13,$14,$15,$16,$17::uuid,$18)
       RETURNING ${SETTINGS_COLUMNS}`,
      [
        current.version + 1, normalized.effectiveFrom, request.responseWindowWorkdays,
        request.postClosureResponseEnabled, request.postClosureResponseWindowDays,
        request.recentWindowDays, request.historyWindowDays, request.enabledConcernCategories,
        request.evidenceAllowedMimeTypes, request.evidenceMaxBytes,
        request.driverInputRequestedChannels.inApp, request.driverInputRequestedChannels.email, request.driverInputRequestedChannels.whatsapp,
        request.driverResponseReceivedChannels.inApp, request.driverResponseReceivedChannels.email, request.driverResponseReceivedChannels.whatsapp,
        actorUserId, normalized.reason,
      ],
    );
    if (!created) throw new Error('Driver-input settings insert returned no row');
    return mapSettings(created);
  });
}
