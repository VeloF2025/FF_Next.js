/**
 * SP Tracker Sync Types
 */

export interface SpTrackerConfig {
  id: string;
  project_id: string;
  project_name: string;
  drive_id: string;
  item_id: string;
  sheet_name: string;
}

export interface SpPonRow {
  zone_no: number;
  hld_pon: number;
  z_pon: number | null;
  olt_port: string | null;
  scope_poles: number | null;
  scope_drops: number | null;
  scope_string: number | null;
  pole_perm: number | null;
  poles_planted: number | null;
  sign_ups: number | null;
  cwc_poles_date: string | null;
  cwc_stringing_date: string | null;
  ready_for_optical_date: string | null;
  cwc_qa_approved: number;
  optical_splicing_date: string | null;
  optical_submitted_date: string | null;
  optical_activated_date: string | null;
  atp_qa_approved: number;
  homes_po: number | null;
  homes_recon: number | null;
  activated: number | null;
  available: number | null;
  pon_age_days: number | null;
  pct_original: number | null;
  pct_recon: number | null;
  blockage: string | null;
}

export interface ProjectSummary {
  permissions_scope: number;
  permissions_complete: number;
  pct_permissions: number;
  poles_scope: number;
  poles_complete: number;
  pct_poles: number;
  signups_scope: number;
  signups_complete: number;
  pct_signups: number;
  cwc_scope: number;
  cwc_complete: number;
  pct_cwc: number;
  optical_scope: number;
  optical_complete: number;
  pct_optical: number;
  connected_scope: number;
  connected_complete: number;
  pct_connected: number;
}
