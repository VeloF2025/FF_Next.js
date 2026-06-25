import type { BoardStage, ChecklistItem, PlanningStage, StageChecklists } from '../types/planning';

export const BOARD_STAGES: { key: BoardStage; label: string }[] = [
  { key: 'intake', label: 'Intake & Setup' },
  { key: 'hld', label: 'HLD' },
  { key: 'lld', label: 'LLD' },
  { key: 'splice', label: 'Splice & Fiber Allocation' },
  { key: 'change_control', label: 'Construction Change-Control' },
  { key: 'as_built', label: 'As-Built & Handover' },
];

export const STAGE_LABELS: Record<PlanningStage, string> = {
  intake: 'Intake & Setup',
  hld: 'HLD',
  lld: 'LLD',
  splice: 'Splice & Fiber Allocation',
  change_control: 'Construction Change-Control',
  as_built: 'As-Built & Handover',
  on_hold: 'On Hold',
  cancelled: 'Cancelled',
};

// Off-board stages (hidden from the main board, shown in a sub-tab)
export const PARKED_STAGES: PlanningStage[] = ['on_hold', 'cancelled'];

// Ordered flow used by quick-move chevrons
export const STAGE_FLOW: BoardStage[] = BOARD_STAGES.map(s => s.key);

type SeedItem = Omit<ChecklistItem, 'done'>;

// Content sourced verbatim from the Planning Workflow spreadsheet ("Detailed" sheet).
const TEMPLATE_SEED: Record<BoardStage, SeedItem[]> = {
  intake: [
    { id: 'intake-a1', kind: 'activity', label: 'Align planning assumptions' },
    { id: 'intake-a2', kind: 'activity', label: 'Validate base data quality' },
    { id: 'intake-a3', kind: 'activity', label: 'Confirm constraints and naming standards' },
    { id: 'intake-o1', kind: 'output', label: 'Approved design basis' },
    { id: 'intake-o2', kind: 'output', label: 'Assumptions register' },
    { id: 'intake-o3', kind: 'output', label: 'Project coding standard' },
    { id: 'intake-g1', kind: 'gate', label: 'Gate: design basis approved and baseline datasets accepted' },
  ],
  hld: [
    { id: 'hld-a1', kind: 'activity', label: 'Define PON/service areas' },
    { id: 'hld-a2', kind: 'activity', label: 'Define cabinet/FDH concepts and feeder corridors' },
    { id: 'hld-a3', kind: 'activity', label: 'High-level capacity and costing' },
    { id: 'hld-o1', kind: 'output', label: 'HLD map pack' },
    { id: 'hld-o2', kind: 'output', label: 'Preliminary BoQ' },
    { id: 'hld-o3', kind: 'output', label: 'Risk/dependency register' },
    { id: 'hld-g1', kind: 'gate', label: 'Gate: HLD baseline frozen and cost envelope accepted' },
  ],
  lld: [
    { id: 'lld-a1', kind: 'activity', label: 'Detailed feeder/distribution/drop routing' },
    { id: 'lld-a2', kind: 'activity', label: 'Node hierarchy and cable sizing' },
    { id: 'lld-a3', kind: 'activity', label: 'Route-level constructibility checks' },
    { id: 'lld-o1', kind: 'output', label: 'LLD design pack' },
    { id: 'lld-o2', kind: 'output', label: 'Construction-grade BoQ' },
    { id: 'lld-o3', kind: 'output', label: 'Rule-compliance log' },
    { id: 'lld-g1', kind: 'gate', label: 'Gate: constructibility accepted and engineering checks passed' },
  ],
  splice: [
    { id: 'splice-a1', kind: 'activity', label: 'Fiber allocation' },
    { id: 'splice-a2', kind: 'activity', label: 'Closure planning and port/tray assignment' },
    { id: 'splice-a3', kind: 'activity', label: 'Continuity validation' },
    { id: 'splice-o1', kind: 'output', label: 'Splice schedules' },
    { id: 'splice-o2', kind: 'output', label: 'Continuity table' },
    { id: 'splice-o3', kind: 'output', label: 'Closure and tray assignment sheets' },
    { id: 'splice-g1', kind: 'gate', label: 'Gate: end-to-end continuity validated and splice pack approved' },
  ],
  change_control: [
    { id: 'cc-a1', kind: 'activity', label: 'Capture field changes' },
    { id: 'cc-a2', kind: 'activity', label: 'Impact assess and approve/reject revisions' },
    { id: 'cc-a3', kind: 'activity', label: 'Reissue controlled packs' },
    { id: 'cc-o1', kind: 'output', label: 'Revision log' },
    { id: 'cc-o2', kind: 'output', label: 'Redline register' },
    { id: 'cc-o3', kind: 'output', label: 'Updated controlled drawings/schedules' },
    { id: 'cc-g1', kind: 'gate', label: 'Gate: redlines resolved/deferred and latest revision acknowledged' },
  ],
  as_built: [
    { id: 'ab-a1', kind: 'activity', label: 'Reconcile installed assets vs design' },
    { id: 'ab-a2', kind: 'activity', label: 'Finalize continuity and close deltas' },
    { id: 'ab-o1', kind: 'output', label: 'As-Built maps/register' },
    { id: 'ab-o2', kind: 'output', label: 'Final splice pack' },
    { id: 'ab-o3', kind: 'output', label: 'Planned-vs-as-built variance report' },
    { id: 'ab-o4', kind: 'output', label: 'Handover package' },
    { id: 'ab-g1', kind: 'gate', label: 'Gate: As-Built QA passed, handover signed, project closed' },
  ],
};

export const PLANNING_STAGE_TEMPLATE: StageChecklists = Object.fromEntries(
  Object.entries(TEMPLATE_SEED).map(([stage, items]) => [
    stage,
    items.map(i => ({ ...i, done: false })),
  ]),
) as StageChecklists;

export function buildInitialChecklists(): StageChecklists {
  return Object.fromEntries(
    Object.entries(TEMPLATE_SEED).map(([stage, items]) => [
      stage,
      items.map(i => ({ ...i, done: false })),
    ]),
  ) as StageChecklists;
}
