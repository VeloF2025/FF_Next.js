/**
 * Type-only definitions for the DR-history AI summary feature.
 * Split out of drHistoryService.ts to keep each file under the 300-line
 * project limit (CLAUDE.md Zero Tolerance).
 */

export interface DrFacts {
  drop_number: string;
  ont_serial: string | null;
  drop: {
    project_id: string | null;
    pole_number: string | null;
    installation_date: string | null;
    status: string | null;
    qc_status: string | null;
    ont_serial: string | null;
    mini_ups_serial: string | null;
  } | null;
  qa_photos: Array<{
    review_date: string | null;
    user_name: string | null;
    completed: boolean | null;
    completed_photos: number | null;
    outstanding_photos: number | null;
    project: string | null;
  }>;
  oes_activation: {
    activation_date: string | null;
    activation_datetime: string | null;
    serial_number: string | null;
    team: string | null;
    status: string | null;
  } | null;
  serial_changes: Array<{
    change_type: string | null;
    old_value: string | null;
    new_value: string | null;
    change_source: string | null;
    change_reason: string | null;
    actor: string | null;
    detected_at: string | null;
  }>;
  olt_mismatch: {
    fix_status: string | null;
    olt_serial: string | null;
    wrong_onemap_serial: string | null;
    fix_attempted_at: string | null;
    fix_result: string | null;
    has_ups_swap: boolean | null;
  } | null;
  onemap_props: Array<{
    property_id: string | null;
    status: string | null;
    pole_permission_status: string | null;
  }>;
  prior_tickets: Array<{
    ticket_uid: string;
    title: string | null;
    status: string | null;
    ticket_category: string | null;
    created_at: string | null;
  }>;
  offline_devices: Array<{
    serial_number: string | null;
    last_inform_date: string | null;
    days_since_last_inform: number | null;
    offline_bucket: string | null;
    last_down_reason: string | null;
  }>;
}

export type DrDrop = NonNullable<DrFacts['drop']>;
export type DrQaPhoto = DrFacts['qa_photos'][number];
export type DrOesActivation = NonNullable<DrFacts['oes_activation']>;
export type DrSerialChange = DrFacts['serial_changes'][number];
export type DrOltMismatch = NonNullable<DrFacts['olt_mismatch']>;
export type DrOnemapProp = DrFacts['onemap_props'][number];
export type DrPriorTicket = DrFacts['prior_tickets'][number];
export type DrOfflineDevice = DrFacts['offline_devices'][number];
