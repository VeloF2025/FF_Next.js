// ──────────────────────────────────────────────────────────────────
// Stock Implications: QField field events → material consumption
// ──────────────────────────────────────────────────────────────────

export type Confidence = 'exact' | 'estimated' | 'derived';

export interface MaterialItem {
  boqCategory: string;
  item: string;
  formula: string;
  uom: string;
  confidence: Confidence;
  notes?: string;
}

export interface StockImplication {
  id: string;
  layer: string;
  trigger: string;
  triggerCondition: string;
  qfieldAttributes: string[];
  materials: MaterialItem[];
}

export const stockImplications: StockImplication[] = [
  // ──────────────────────────────────────────────────────────────────
  // POLES — Pole Planted
  // ──────────────────────────────────────────────────────────────────
  {
    id: 'pole-planted',
    layer: 'Poles (Civil Audit)',
    trigger: 'Pole Planted',
    triggerCondition: 'pole_planted has a date value',
    qfieldAttributes: ['pole_planted', 'pole_type', 'height'],
    materials: [
      {
        boqCategory: 'POLES',
        item: 'Creosote pole',
        formula: '1 per pole',
        uom: 'EA',
        confidence: 'exact',
        notes: 'Type derived from pole_type attribute',
      },
      {
        boqCategory: 'HARDWARE',
        item: 'Tangent bracket (ADSS)',
        formula: '2 per pole',
        uom: 'EA',
        confidence: 'estimated',
        notes: 'Standard 2 tangents per pole for aerial cable support',
      },
      {
        boqCategory: 'HARDWARE',
        item: 'Slack bracket',
        formula: '1 per pole',
        uom: 'EA',
        confidence: 'estimated',
        notes: 'Slack management bracket for cable loops',
      },
      {
        boqCategory: 'HARDWARE',
        item: 'Coach screws',
        formula: '6 per pole',
        uom: 'EA',
        confidence: 'estimated',
        notes: '~3 per bracket x 2 brackets',
      },
      {
        boqCategory: 'HARDWARE',
        item: 'Steel strapping + buckle',
        formula: '2 per pole',
        uom: 'EA',
        confidence: 'estimated',
        notes: 'Strapping for bracket attachment on non-wooden poles',
      },
      {
        boqCategory: 'CIVIL',
        item: 'Cement bags',
        formula: 'ceil(height_meters / 3)',
        uom: 'BAG',
        confidence: 'derived',
        notes: 'Height from QField (currently a gap). ~1 bag per 3m pole height',
      },
    ],
  },
  {
    id: 'pole-stay-set',
    layer: 'Poles (Civil Audit)',
    trigger: 'Pole Requires Stay Set',
    triggerCondition: 'height > 9m (or pole_type indicates tall pole)',
    qfieldAttributes: ['height', 'pole_type'],
    materials: [
      {
        boqCategory: 'POLES',
        item: 'Stay set (guy wire + anchor)',
        formula: '1 per tall pole',
        uom: 'SET',
        confidence: 'derived',
        notes: 'Height attribute is a current gap — needs import to automate',
      },
    ],
  },

  // ──────────────────────────────────────────────────────────────────
  // POLES — Dome Joint Installed
  // ──────────────────────────────────────────────────────────────────
  {
    id: 'dome-joint',
    layer: 'Poles (Civil Audit)',
    trigger: 'Dome Joint Installed',
    triggerCondition: 'DomeJoint attribute has a value',
    qfieldAttributes: ['DomeJoint', 'JointType'],
    materials: [
      {
        boqCategory: 'ENCLOSURES',
        item: 'Splice closure (dome)',
        formula: '1 per pole with dome joint',
        uom: 'EA',
        confidence: 'exact',
      },
      {
        boqCategory: 'HARDWARE',
        item: 'Slack bracket (dome mount)',
        formula: '1 per dome joint',
        uom: 'EA',
        confidence: 'estimated',
        notes: 'Bracket to mount dome closure on pole',
      },
    ],
  },

  // ──────────────────────────────────────────────────────────────────
  // POLES — Splitter Installed
  // ──────────────────────────────────────────────────────────────────
  {
    id: 'splitter-installed',
    layer: 'Poles (Civil Audit)',
    trigger: 'Splitter Installed',
    triggerCondition: 'Splitter attribute has a value',
    qfieldAttributes: ['Splitter'],
    materials: [
      {
        boqCategory: 'SPLICING',
        item: 'Splitter (connectorised)',
        formula: '1 per pole with splitter',
        uom: 'EA',
        confidence: 'exact',
        notes: 'Ratio (1:8, 1:16, 1:32) derived from Splitter value',
      },
      {
        boqCategory: 'SPLICING',
        item: 'Pigtails (connectorised)',
        formula: 'splitter_ratio outputs (e.g. 8 for 1:8)',
        uom: 'EA',
        confidence: 'derived',
        notes: 'One pigtail per splitter output port',
      },
    ],
  },

  // ──────────────────────────────────────────────────────────────────
  // JOINTS — Splice Closure
  // ──────────────────────────────────────────────────────────────────
  {
    id: 'joint-spliced',
    layer: 'Joints',
    trigger: 'Joint Spliced',
    triggerCondition: 'joint record exists with cable_capacity',
    qfieldAttributes: ['joint_label', 'joint_type', 'cable_capacity'],
    materials: [
      {
        boqCategory: 'ENCLOSURES',
        item: 'Splice closure',
        formula: '1 per joint',
        uom: 'EA',
        confidence: 'exact',
        notes: 'Type from joint_type (dome, wall-mount, etc.)',
      },
      {
        boqCategory: 'SPLICING',
        item: 'Splice protectors',
        formula: 'parse fiber count from cable_capacity',
        uom: 'EA',
        confidence: 'derived',
        notes: 'e.g. cable_capacity "144F" → up to 144 splice protectors',
      },
      {
        boqCategory: 'CONSUMABLES',
        item: 'Heat shrink tubing',
        formula: 'same as splice protector count',
        uom: 'EA',
        confidence: 'derived',
      },
      {
        boqCategory: 'SPLICING',
        item: 'Midcoupler (flangeless)',
        formula: '2 per joint (input + output)',
        uom: 'EA',
        confidence: 'estimated',
        notes: 'For cable entry/exit from closure',
      },
    ],
  },

  // ──────────────────────────────────────────────────────────────────
  // CABLE SPANS — Cable Strung
  // ──────────────────────────────────────────────────────────────────
  {
    id: 'cable-strung',
    layer: 'Cable Spans',
    trigger: 'Cable Strung',
    triggerCondition: 'cable_span record exists with length_meters',
    qfieldAttributes: ['span_label', 'cable_size', 'length_meters'],
    materials: [
      {
        boqCategory: 'CABLES',
        item: 'Aerial cable (ADSS / Mini-ADSS)',
        formula: 'length_meters (from geometry or attribute)',
        uom: 'M',
        confidence: 'exact',
        notes: 'Cable type inferred from cable_size (e.g. 24F, 96F, 144F, 288F)',
      },
      {
        boqCategory: 'HARDWARE',
        item: 'Dead-end clamp (ADSS)',
        formula: '2 per span (start + end pole)',
        uom: 'EA',
        confidence: 'exact',
        notes: 'One at each anchor pole',
      },
      {
        boqCategory: 'HARDWARE',
        item: 'Cable ties',
        formula: 'ceil(length_meters / 0.5)',
        uom: 'EA',
        confidence: 'estimated',
        notes: 'Approximately 1 cable tie per 0.5m for securing cable',
      },
    ],
  },
  {
    id: 'cable-strung-labels',
    layer: 'Cable Spans',
    trigger: 'Cable Span Labelled',
    triggerCondition: 'span_label is populated',
    qfieldAttributes: ['span_label'],
    materials: [
      {
        boqCategory: 'CONSUMABLES',
        item: 'Brady / Chromadek labels',
        formula: '2 per span (each end)',
        uom: 'EA',
        confidence: 'estimated',
        notes: 'Span identification labels at start and end',
      },
    ],
  },

  // ──────────────────────────────────────────────────────────────────
  // DROPS — Drop Installed
  // ──────────────────────────────────────────────────────────────────
  {
    id: 'drop-installed',
    layer: 'Drops',
    trigger: 'Drop Installed',
    triggerCondition: 'drop exists with pole_number link (status gaps prevent automation today)',
    qfieldAttributes: ['drop_number', 'pole_number', 'cable_capacity', 'cable_length'],
    materials: [
      {
        boqCategory: 'CABLES',
        item: 'Drop cable (connectorised)',
        formula: 'cable_length (currently a gap — not imported)',
        uom: 'M',
        confidence: 'derived',
        notes: 'Cable length from QField is a gap. Can estimate from pole-to-customer GPS distance',
      },
      {
        boqCategory: 'SPLICING',
        item: 'SC/APC connector',
        formula: '2 per drop (pole-end + ONT-end)',
        uom: 'EA',
        confidence: 'exact',
      },
      {
        boqCategory: 'HARDWARE',
        item: 'Dead-end clamp (drop cable)',
        formula: '1 per drop',
        uom: 'EA',
        confidence: 'exact',
        notes: 'Anchor clamp at pole for drop cable',
      },
      {
        boqCategory: 'HARDWARE',
        item: 'Hook (pigtail / monopole bracket)',
        formula: '1 per drop',
        uom: 'EA',
        confidence: 'estimated',
        notes: 'Cable guide hook at pole',
      },
      {
        boqCategory: 'HOME_CONNECTION',
        item: 'Wall attachment (inspection box)',
        formula: '1 per drop',
        uom: 'EA',
        confidence: 'exact',
        notes: 'Customer premises cable entry point',
      },
    ],
  },
  {
    id: 'drop-ont-installed',
    layer: 'Drops',
    trigger: 'ONT Installed (Activation)',
    triggerCondition: 'drop activated — tracked via field-stock consumption (not QField)',
    qfieldAttributes: ['drop_number'],
    materials: [
      {
        boqCategory: 'HOME_CONNECTION',
        item: 'ONT (Huawei/ZTE)',
        formula: '1 per drop',
        uom: 'EA',
        confidence: 'exact',
        notes: 'Serial tracked — already recorded via field-stock module',
      },
      {
        boqCategory: 'HOME_CONNECTION',
        item: 'Mini UPS (Gizzu)',
        formula: '1 per drop',
        uom: 'EA',
        confidence: 'exact',
        notes: 'Serial tracked — already recorded via field-stock module',
      },
      {
        boqCategory: 'HOME_CONNECTION',
        item: 'Electrical (ONT power)',
        formula: '1 per drop',
        uom: 'EA',
        confidence: 'estimated',
        notes: 'Power cable kit for ONT installation',
      },
    ],
  },

  // ──────────────────────────────────────────────────────────────────
  // CABLE SPANS — Gaps that block automation
  // ──────────────────────────────────────────────────────────────────
  {
    id: 'cable-span-gaps',
    layer: 'Cable Spans',
    trigger: 'Start/End Feature (Gap)',
    triggerCondition: 'strtfeat and endfeat are NOT imported — blocks pole-to-span linking',
    qfieldAttributes: ['strtfeat (start feature)', 'endfeat (end feature)'],
    materials: [
      {
        boqCategory: 'HARDWARE',
        item: 'Tangent clamp (mid-span)',
        formula: 'Count of intermediate poles between start and end',
        uom: 'EA',
        confidence: 'derived',
        notes: 'Cannot calculate without strtfeat/endfeat import. Currently a gap.',
      },
    ],
  },

  // ──────────────────────────────────────────────────────────────────
  // OPTICAL AUDIT — Entire layer is a gap
  // ──────────────────────────────────────────────────────────────────
  {
    id: 'optical-audit-gap',
    layer: 'Optical Audit',
    trigger: 'Optical Audit Completed',
    triggerCondition: 'Entire Optical Audit layer is NOT imported — cannot trigger any automation',
    qfieldAttributes: ['Status', 'Sub Contractor Name', 'Q/A Date', 'Q/A Optical Comments'],
    materials: [
      {
        boqCategory: 'CONSUMABLES',
        item: 'Alcohol (aerosol) + Kim wipes',
        formula: '1 set per optical audit session',
        uom: 'SET',
        confidence: 'estimated',
        notes: 'Fiber cleaning consumables used during optical audit',
      },
    ],
  },
];

// ──────────────────────────────────────────────────────────────────
// Summary statistics
// ──────────────────────────────────────────────────────────────────
export interface ImplicationStats {
  totalImplications: number;
  totalMaterials: number;
  byConfidence: Record<Confidence, number>;
  byCategory: Record<string, number>;
  gapBlockers: number;
}

export function computeImplicationStats(data: StockImplication[]): ImplicationStats {
  const allMaterials = data.flatMap(d => d.materials);
  const byConfidence: Record<Confidence, number> = { exact: 0, estimated: 0, derived: 0 };
  const byCategory: Record<string, number> = {};

  for (const m of allMaterials) {
    byConfidence[m.confidence]++;
    byCategory[m.boqCategory] = (byCategory[m.boqCategory] || 0) + 1;
  }

  const gapBlockers = data.filter(d =>
    d.triggerCondition.toLowerCase().includes('gap') ||
    d.triggerCondition.toLowerCase().includes('not imported')
  ).length;

  return {
    totalImplications: data.length,
    totalMaterials: allMaterials.length,
    byConfidence,
    byCategory,
    gapBlockers,
  };
}
