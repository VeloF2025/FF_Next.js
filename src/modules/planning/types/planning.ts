export type PlanningStage =
  | 'intake'
  | 'hld'
  | 'lld'
  | 'splice'
  | 'change_control'
  | 'as_built'
  | 'on_hold'
  | 'cancelled';

export type BoardStage = Exclude<PlanningStage, 'on_hold' | 'cancelled'>;
export type PlanningPriority = 'low' | 'normal' | 'high' | 'urgent';
export type PlanningSource = 'pipeline_auto' | 'manual';

export interface ChecklistItem {
  id: string;
  label: string;
  kind: 'activity' | 'output' | 'gate';
  done: boolean;
}

export type StageChecklists = Record<BoardStage, ChecklistItem[]>;

export interface PlanningItem {
  id: string;
  item_uid: string;
  project_id: string;
  title: string;
  description: string | null;
  scope_area: string | null;
  stage: PlanningStage;
  assigned_to: string | null;
  priority: PlanningPriority;
  source: PlanningSource;
  stage_checklists: StageChecklists;
  pipeline_project_id: string | null;
  created_at: string;
  created_by: string | null;
  updated_at: string;
  closed_at: string | null;
}

export interface PlanningItemWithRelations extends PlanningItem {
  project_name?: string | null;
  project_code?: string | null;
  assigned_user?: { id: string; name: string; email: string } | null;
}

export interface CreatePlanningItemPayload {
  project_id: string;
  title: string;
  description?: string | null;
  scope_area?: string | null;
  stage?: PlanningStage;
  assigned_to?: string | null;
  priority?: PlanningPriority;
  source?: PlanningSource;
  pipeline_project_id?: string | null;
  created_by?: string | null;
}

export interface UpdatePlanningItemPayload {
  title?: string;
  description?: string | null;
  scope_area?: string | null;
  stage?: PlanningStage;
  assigned_to?: string | null;
  priority?: PlanningPriority;
  stage_checklists?: StageChecklists;
}

export interface PlanningFilters {
  project_id?: string;
  stage?: PlanningStage;
  exclude_stage?: PlanningStage[];
  assigned_to?: string;
  search?: string;
  created_after?: Date;
  created_before?: Date;
  sort?: string;
  page?: number;
  pageSize?: number;
}

export interface PlanningListResponse {
  data: PlanningItemWithRelations[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
}
