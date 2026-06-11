export type Discipline = 'civil' | 'dome' | 'main_joint';

export interface SlotMeta {
  key: string;
  dbColumn: string;
  label: string;
  discipline: Discipline;
  stepNumber: number;
  vlmCheck: string;
}

export const DISCIPLINE_LABELS: Record<Discipline, string> = {
  civil: 'Civil',
  dome: 'Dome',
  main_joint: 'Main Joint',
};

export const SLOT_META: SlotMeta[] = [
  // Civil
  { key: 'civil_01', dbColumn: 'civil_step_01_key', label: 'Before Photo',       discipline: 'civil', stepNumber: 1, vlmCheck: 'Undisturbed ground with chalk/spray paint markings. NO hole visible yet.' },
  { key: 'civil_02', dbColumn: 'civil_step_02_key', label: 'During Photo',        discipline: 'civil', stepNumber: 2, vlmCheck: 'Active excavation in progress: open hole, workers digging. NO pole installed yet.' },
  { key: 'civil_03', dbColumn: 'civil_step_03_key', label: 'Depth Photo',         discipline: 'civil', stepNumber: 3, vlmCheck: 'Measuring tape or ruler in hole showing depth measurement.' },
  { key: 'civil_04', dbColumn: 'civil_step_04_key', label: 'End Plates',          discipline: 'civil', stepNumber: 4, vlmCheck: 'Close-up of metal end-plates, HDPE strapping, or brackets on the pole.' },
  { key: 'civil_05', dbColumn: 'civil_step_05_key', label: 'Compaction/Backfill', discipline: 'civil', stepNumber: 5, vlmCheck: 'Pole STANDING, hole FILLED and packed with sand+cement. Compacted surface.' },
  { key: 'civil_06', dbColumn: 'civil_step_06_key', label: 'Level Check',         discipline: 'civil', stepNumber: 6, vlmCheck: 'Spirit level (yellow/green bubble level tool) held against an upright pole.' },
  { key: 'civil_07', dbColumn: 'civil_step_07_key', label: 'After Photo',         discipline: 'civil', stepNumber: 7, vlmCheck: 'Full pole standing upright, wide shot from distance.' },
  { key: 'civil_08', dbColumn: 'civil_step_08_key', label: 'Pole Label',          discipline: 'civil', stepNumber: 8, vlmCheck: 'Pole ID label/tag readable on the installed pole.' },
  // Dome
  { key: 'dome_01', dbColumn: 'optical_dome_01_key', label: 'Dome on Pole',       discipline: 'dome', stepNumber: 1, vlmCheck: 'Wide shot of splice dome installed on pole.' },
  { key: 'dome_02', dbColumn: 'optical_dome_02_key', label: 'Dome Label',         discipline: 'dome', stepNumber: 2, vlmCheck: 'Dome label with Pole ID / Fibre ID clearly readable.' },
  { key: 'dome_03', dbColumn: 'optical_dome_03_key', label: 'Open Dome',          discipline: 'dome', stepNumber: 3, vlmCheck: 'Fibre routing and tray layout visible inside open dome.' },
  { key: 'dome_04', dbColumn: 'optical_dome_04_key', label: 'Splice Protectors',  discipline: 'dome', stepNumber: 4, vlmCheck: 'Splice protectors fitted correctly over fibre splices.' },
  { key: 'dome_05', dbColumn: 'optical_dome_05_key', label: 'Slack Management',   discipline: 'dome', stepNumber: 5, vlmCheck: 'Neat fibre loops and cable organization within dome.' },
  { key: 'dome_06', dbColumn: 'optical_dome_06_key', label: 'Strength Members',   discipline: 'dome', stepNumber: 6, vlmCheck: 'Strength members (aramid/steel) secured inside dome.' },
  { key: 'dome_07', dbColumn: 'optical_dome_07_key', label: 'Seals & Dust Caps',  discipline: 'dome', stepNumber: 7, vlmCheck: 'Dome seals tightened, dust caps on unused ports.' },
  { key: 'dome_08', dbColumn: 'optical_dome_08_key', label: 'Pole ID',            discipline: 'dome', stepNumber: 8, vlmCheck: 'Pole ID label/tag attached to pole near dome.' },
  // Main Joint
  { key: 'main_joint_11', dbColumn: 'main_joint_11_key', label: 'Cable Entries',     discipline: 'main_joint', stepNumber: 11, vlmCheck: 'Labelled cable entries into main joint closure.' },
  { key: 'main_joint_12', dbColumn: 'main_joint_12_key', label: 'Strength Members',  discipline: 'main_joint', stepNumber: 12, vlmCheck: 'Strength members properly secured within closure.' },
  { key: 'main_joint_13', dbColumn: 'main_joint_13_key', label: 'Tube Routing',      discipline: 'main_joint', stepNumber: 13, vlmCheck: 'Fibre tubes routed neatly from entry to splice tray.' },
  { key: 'main_joint_14', dbColumn: 'main_joint_14_key', label: 'Tray Entries',      discipline: 'main_joint', stepNumber: 14, vlmCheck: 'Fibre entering splice trays in organised manner.' },
  { key: 'main_joint_15', dbColumn: 'main_joint_15_key', label: 'Coiling & Protectors', discipline: 'main_joint', stepNumber: 15, vlmCheck: 'Fibre coiling loops and visible splice protectors.' },
  { key: 'main_joint_16', dbColumn: 'main_joint_16_key', label: 'Readable Labels',   discipline: 'main_joint', stepNumber: 16, vlmCheck: 'Clear readable labels on cables, tubes, or closure.' },
];

export const SLOT_KEYS = SLOT_META.map(s => s.key);

export function getSlotMeta(key: string): SlotMeta | undefined {
  return SLOT_META.find(s => s.key === key);
}

export function getDbColumn(key: string): string {
  const meta = getSlotMeta(key);
  if (!meta) throw new Error(`Unknown slot key: ${key}`);
  return meta.dbColumn;
}
