/**
 * H&S Daily Site Check-In Types
 *
 * One declaration per person per day, captured from the /my portal:
 * fitness for duty, PPE, today's activities and any hazard seen.
 *
 * The check-in never blocks recording paid time — it blocks H&S *clearance*.
 * See migration 465 for why each invariant lives in the database too.
 */

/** How the declaration reached us. */
export type CheckinCaptureMode = 'self' | 'crew_lead';

/**
 * Where the worker declared they are working today. Office declarations skip
 * the site questions entirely — PPE and plant work are not desk risks — so
 * this drives both the question set and the clearance rules.
 */
export type CheckinWorkLocation = 'site' | 'office';

/** Mirrors the hs_daily_checkins.clearance DB CHECK — kept in sync by a ratchet test. */
export type CheckinClearance = 'cleared' | 'blocked' | 'cleared_by_override';

/**
 * What a worker declares they are doing today.
 *
 * The first five mirror `hs_permit_types.code` (seeded in migration 454) so a
 * declared activity can be reconciled against an actual permit. `plant_operation`
 * is check-in-only: operating mobile plant is a medical-relevant activity under
 * CR23 but is not currently a permit type, and adding one would change what the
 * permits module offers — a separate decision.
 */
export type CheckinActivity =
  | 'working_at_heights'
  | 'excavation'
  | 'confined_space'
  | 'electrical'
  | 'hot_work'
  | 'plant_operation';

/** The activity codes that also exist as `hs_permit_types.code`. */
export const PERMIT_BACKED_ACTIVITIES: CheckinActivity[] = [
  'working_at_heights',
  'excavation',
  'confined_space',
  'electrical',
  'hot_work',
];

/**
 * Activities that require a current Certificate of Fitness.
 *
 * Hein's decision (2026-07-28): the medical block applies to height/plant work
 * only, not to everyone. Interpreted as declared ACTIVITY rather than a static
 * role — `staff.role` has no height/plant concept, and a role flag is wrong on
 * exactly the occasional day someone works at height.
 *
 * Electrical and hot work are excluded deliberately: they carry their own
 * competency and permit controls, and a fitness certificate is not the control
 * that makes them safe.
 */
export const MEDICAL_REQUIRED_ACTIVITIES: CheckinActivity[] = [
  'working_at_heights',
  'confined_space',
  'plant_operation',
];

export interface CheckinActivityConfig {
  value: CheckinActivity;
  label: string;
  /** true = declaring this requires a current medical (see above) */
  requires_medical: boolean;
  /** true = this code also exists as an hs_permit_types.code */
  permit_backed: boolean;
}

export const CHECKIN_ACTIVITIES: Record<CheckinActivity, CheckinActivityConfig> = {
  working_at_heights: {
    value: 'working_at_heights',
    label: 'Working at heights',
    requires_medical: true,
    permit_backed: true,
  },
  confined_space: {
    value: 'confined_space',
    label: 'Confined space entry',
    requires_medical: true,
    permit_backed: true,
  },
  plant_operation: {
    value: 'plant_operation',
    label: 'Operating mobile plant',
    requires_medical: true,
    permit_backed: false,
  },
  excavation: {
    value: 'excavation',
    label: 'Excavation / trenching',
    requires_medical: false,
    permit_backed: true,
  },
  electrical: {
    value: 'electrical',
    label: 'Electrical work',
    requires_medical: false,
    permit_backed: true,
  },
  hot_work: {
    value: 'hot_work',
    label: 'Hot work',
    requires_medical: false,
    permit_backed: true,
  },
};

/**
 * Why a check-in was blocked. Stored as an array — a worker can trip more than
 * one, and the H&S officer needs all of them to clear the person properly.
 */
export type CheckinBlockReason = 'self_declared_unfit' | 'medical_not_current';

/**
 * Non-blocking findings surfaced alongside a cleared check-in. These are the
 * "alert, do not block" half of the graduated model.
 */
export type CheckinWarning =
  | 'ppe_incomplete'
  | 'hazard_reported'
  | 'medical_unverifiable'
  | 'activity_without_permit'
  | 'contractor_link_unverified';

export const CHECKIN_BLOCK_REASON_LABELS: Record<CheckinBlockReason, string> = {
  self_declared_unfit: 'Declared not fit for duty',
  medical_not_current: 'No current Certificate of Fitness for declared height/plant work',
};

export const CHECKIN_WARNING_LABELS: Record<CheckinWarning, string> = {
  ppe_incomplete: 'PPE incomplete',
  hazard_reported: 'Hazard reported',
  // An unregistered crew worker has no staff/team_member id, so their medical
  // cannot be looked up. We surface this rather than block: blocking would
  // punish the identity gap, not the risk — but it must stay visible, or a
  // contractor could dodge the medical gate simply by not registering anyone.
  medical_unverifiable: 'Height/plant work declared by an unregistered worker — medical could not be verified',
  activity_without_permit: 'Declared an activity with no matching permit open today',
  // The compensating control for accepting a worker whose employer is not
  // recorded. Without it, "we accepted this on trust" would be invisible, and
  // the decision to accept unlinked workers would rest on nothing.
  contractor_link_unverified:
    'Worker is not recorded against this contractor — attribution unproven',
};

export interface HSDailyCheckin {
  id: string;
  checkin_date: string;
  /**
   * Null for an office declaration. Migration 504 dropped the NOT NULL and
   * replaced it with hs_daily_checkins_site_needs_project, which requires a
   * project only when work_location is 'site'.
   */
  project_id: string | null;
  work_location: CheckinWorkLocation;
  contractor_id: string | null;
  staff_id: string | null;
  team_member_id: string | null;
  worker_name: string;
  capture_mode: CheckinCaptureMode;
  submission_id: string;
  submitted_by_staff_id: string | null;
  signature_name: string | null;
  signed_at: string | null;
  fit_for_duty: boolean;
  ppe_complete: boolean;
  declared_activities: CheckinActivity[];
  hazard_reported: string | null;
  clearance: CheckinClearance;
  blocked_reasons: CheckinBlockReason[];
  cleared_by: string | null;
  cleared_at: string | null;
  clearance_note: string | null;
  gps_lat: number | null;
  gps_lon: number | null;
  site_match_id: string | null;
  attendance_entry_id: string | null;
  risk_register_id: string | null;
  created_at: string;
  updated_at: string;
}

/** A check-in joined with display context for the today board. */
export interface HSDailyCheckinView extends HSDailyCheckin {
  project_name: string | null;
  contractor_name: string | null;
  warnings: CheckinWarning[];
}

/**
 * Per-contractor rollup for the compliance gate, scoped to one day.
 *
 * Counted over that contractor's check-in rows for the date — the same
 * "contractor_id is the assertion that this is evidence for that contractor"
 * rule the medical and training rollups follow.
 */
export interface ContractorCheckinSummary {
  contractor_id: string;
  checkin_date: string;
  workers_checked_in: number;
  cleared: number;
  blocked: number;
  overridden: number;
  hazards_reported: number;
  medical_unverifiable: number;
}
