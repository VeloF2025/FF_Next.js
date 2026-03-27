export interface MasterRow {
  id: string;
  project_id: string;
  site?: string | null;
  phase?: number | null;
  dr?: string | null;
  zone_no?: number | null;
  hld_pon?: number | null;
  zone_pon?: number | null;
  pole_label?: string | null;
  unique_pole_label?: string | null;
  pole_scope?: string | null;
  pole_type?: string | null;
  pole_route_type?: string | null;
  pole_permission_date?: string | null;
  pole_install_date?: string | null;
  pole_cwc_date?: string | null;
  pole_contractor?: string | null;
  pole_rate?: number | null;
  pole_paid_date?: string | null;
  pole_invoice_no?: string | null;
  pole_comment?: string | null;
  civil_description?: string | null;
  civil_rate?: number | null;
  civil_qty?: number | null;
  civil_total?: number | null;
  civil_invoice_no?: string | null;
  civil_invoice_date?: string | null;
  civil_comment?: string | null;
  stringing_description?: string | null;
  stringing_rate?: number | null;
  stringing_qty?: number | null;
  stringing_total?: number | null;
  stringing_invoice_no?: string | null;
  stringing_date?: string | null;
  stringing_comment?: string | null;
  signup_date?: string | null;
  home_install_date?: string | null;
  home_contractor?: string | null;
  home_rate?: number | null;
  home_paid_date?: string | null;
  home_invoice_no?: string | null;
  activation_code?: string | null;
  activation_date?: string | null;
  activation_team?: string | null;
  activation_rate?: number | null;
  activation_paid_date?: string | null;
  activation_invoice_no?: string | null;
  remittance?: string | null;
  remittance_date?: string | null;
  cwc_pole_status?: string | null;
  cwc_stringing_status?: string | null;
  cwc_qa_submit_date?: string | null;
  cwc_qa_approved_date?: string | null;
  qa_home_recon_no?: string | null;
  exfo_exchange?: string | null;
  optical_contractor?: string | null;
  optical_type?: string | null;
  optical_splitter?: string | null;
  optical_prepping?: string | null;
  optical_splicing?: string | null;
  qa_photos_loaded?: boolean | null;
  atp_qa_submit_date?: string | null;
  atp_qa_approved_date?: string | null;
  testing_status?: string | null;
  test_submitted?: string | null;
  olt_port_activation?: string | null;
  olt_port_activated?: string | null;
  pon_status?: string | null;
  optical_rate?: number | null;
  optical_invoice_date?: string | null;
  optical_invoice_no?: string | null;
  created_at?: string;
  updated_at?: string;
}

export function emptyMasterRow(projectId: string): MasterRow {
  return {
    id: crypto.randomUUID(),
    project_id: projectId,
  };
}
