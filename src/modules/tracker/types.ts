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
