export interface PonRow {
  id: string;
  zone_no: number | null;
  hld_pon: number | null;
  z_pon: number | null;
  olt_port: string;
  scope_poles: number | null;
  scope_drops: number | null;
  pole_permission: string;
  poles_planted: number | null;
  cwc_poles_date: string;
  cwc_stringing_date: string;
  ready_for_optical: string;
  cwc_qa: boolean;
  optical_splicing_date: string;
  optical_submitted_date: string;
  optical_activated_date: string;
  atp_qa: boolean;
  sign_ups: number | null;
  homes_po: number | null;
  homes_recon: number | null;
  activated: number | null;
  available: number | null;
  blockage: string;
}

export function emptyRow(): PonRow {
  return {
    id: crypto.randomUUID(),
    zone_no: null,
    hld_pon: null,
    z_pon: null,
    olt_port: '',
    scope_poles: null,
    scope_drops: null,
    pole_permission: '',
    poles_planted: null,
    cwc_poles_date: '',
    cwc_stringing_date: '',
    ready_for_optical: '',
    cwc_qa: false,
    optical_splicing_date: '',
    optical_submitted_date: '',
    optical_activated_date: '',
    atp_qa: false,
    sign_ups: null,
    homes_po: null,
    homes_recon: null,
    activated: null,
    available: null,
    blockage: '',
  };
}

export interface BuildRow {
  id: string;
  project_id: string;
  zone_no: number;
  pon_no: number;
  hld_pon: number | null;
  z_pon: number | null;
  olt_port: string | null;
  overall_stage: string;
  permissions_total: number; permissions_approved: number;
  poles_total: number; poles_planted: number;
  cwc_total: number; cwc_complete: number;
  cwc_target_date: string | null;
  optical_total: number; optical_complete: number;
  optical_target_date: string | null;
  atp_total: number; atp_passed: number;
  activation_total: number; activation_complete: number;
  activation_target_date: string | null;
  sign_ups: number | null;
  homes_po: number | null;
  homes_recon: number | null;
  available: number | null;
  scope_string: number | null;
  pct_original: number | null;
  pct_recon: number | null;
  auto_blockage: string | null;
  last_synced_at: string | null;
  sync_source: string;
  pm_blockage: string | null;
  civil_contractor: string | null;
  stringing_contractor: string | null;
  optical_contractor: string | null;
  optical_splitter: string | null;
  optical_type: string | null;
  atp_submitter_notes: string | null;
  override_notes: string | null;
  override_updated_by: string | null;
  override_updated_at: string | null;
}
