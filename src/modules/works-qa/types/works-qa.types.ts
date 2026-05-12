export interface VlmSlotResult {
  valid: boolean;
  confidence: number;
  feedback: string;
  overridden_by?: string;
  override_reason?: string;
}

export interface PoleQaPhoto {
  id: string;
  project_id: string;
  pole_label: string;
  zone_no: number | null;
  pon_no: number | null;

  // Civil
  civil_step_01_key: string | null;
  civil_step_02_key: string | null;
  civil_step_03_key: string | null;
  civil_step_04_key: string | null;
  civil_step_05_key: string | null;
  civil_step_06_key: string | null;
  civil_step_07_key: string | null;

  // Optical Dome
  optical_dome_01_key: string | null;
  optical_dome_02_key: string | null;
  optical_dome_03_key: string | null;
  optical_dome_04_key: string | null;
  optical_dome_05_key: string | null;
  optical_dome_06_key: string | null;
  optical_dome_07_key: string | null;
  optical_dome_08_key: string | null;

  // Optical Joint
  optical_joint_11_key: string | null;
  optical_joint_12_key: string | null;
  optical_joint_13_key: string | null;
  optical_joint_14_key: string | null;
  optical_joint_15_key: string | null;
  optical_joint_16_key: string | null;

  optical_joint_tray_keys: string[];
  vlm_results: Record<string, VlmSlotResult>;

  civil_approved: boolean;
  dome_approved: boolean;
  joint_approved: boolean;
  approved_by: string | null;
  approved_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface PoleSummary {
  id: string;
  pole_label: string;
  zone_no: number | null;
  pon_no: number | null;
  civil_filled: number;     // 0-7
  dome_filled: number;      // 0-8
  joint_filled: number;     // 0-6
  tray_count: number;
  vlm_failures: number;
  status: 'empty' | 'in_progress' | 'ready' | 'approved';
  approved_at: string | null;
}

export type SlotKey =
  | 'civil_01' | 'civil_02' | 'civil_03' | 'civil_04' | 'civil_05' | 'civil_06' | 'civil_07'
  | 'dome_01' | 'dome_02' | 'dome_03' | 'dome_04' | 'dome_05' | 'dome_06' | 'dome_07' | 'dome_08'
  | 'joint_11' | 'joint_12' | 'joint_13' | 'joint_14' | 'joint_15' | 'joint_16'
  | 'tray_photos';
