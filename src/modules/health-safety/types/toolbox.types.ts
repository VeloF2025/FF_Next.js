/**
 * H&S Toolbox Talk / DSTI types
 */

export type ToolboxTalkType = 'daily_dsti' | 'weekly' | 'toolbox';

export const TOOLBOX_TALK_TYPES: { value: ToolboxTalkType; label: string }[] = [
  { value: 'daily_dsti', label: 'Daily DSTI' },
  { value: 'weekly', label: 'Weekly toolbox talk' },
  { value: 'toolbox', label: 'Toolbox talk' },
];

export interface ToolboxTalk {
  id: string;
  project_id: string | null;
  topic: string;
  talk_type: ToolboxTalkType;
  talk_date: string;
  presenter_name: string | null;
  presenter_staff_id: string | null;
  location: string | null;
  notes: string | null;
  photo_urls: string[];
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface ToolboxAttendance {
  id: string;
  talk_id: string;
  staff_id: string | null;
  team_member_id: string | null;
  worker_name: string;
  signature_name: string | null;
  signed_at: string | null;
  signed_by: string | null;
  signed_ip: string | null;
  created_at: string;
}
