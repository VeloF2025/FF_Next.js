export interface QFieldMapping {
  layer: string;
  qfieldAttribute: string;
  ffTable: string;
  ffColumn: string;
  importPath: 'GPKG' | 'API Sync' | 'Both' | 'Config Only';
  transform: string;
  status: 'mapped' | 'gap' | 'planned';
}

export const qfieldMappings: QFieldMapping[] = [
  // ──────────────────────────────────────────────────────────────────
  // POLES — GPKG Import (Civil Audit / Pole Layers)
  // ──────────────────────────────────────────────────────────────────
  { layer: 'Poles (Civil Audit)', qfieldAttribute: 'Pole Label / pole_number', ffTable: 'poles', ffColumn: 'pole_number', importPath: 'Both', transform: 'required key', status: 'mapped' },
  { layer: 'Poles (Civil Audit)', qfieldAttribute: 'PoleType / type', ffTable: 'poles', ffColumn: 'pole_type', importPath: 'Both', transform: 'none', status: 'mapped' },
  { layer: 'Poles (Civil Audit)', qfieldAttribute: 'Lats / latitude', ffTable: 'poles', ffColumn: 'latitude', importPath: 'Both', transform: 'numeric', status: 'mapped' },
  { layer: 'Poles (Civil Audit)', qfieldAttribute: 'Longs / longitude', ffTable: 'poles', ffColumn: 'longitude', importPath: 'Both', transform: 'numeric', status: 'mapped' },
  { layer: 'Poles (Civil Audit)', qfieldAttribute: 'DomeJoint', ffTable: 'poles', ffColumn: 'dome_joint', importPath: 'GPKG', transform: 'trunc(50)', status: 'mapped' },
  { layer: 'Poles (Civil Audit)', qfieldAttribute: 'JointType / TypeofJoint', ffTable: 'poles', ffColumn: 'type_of_join', importPath: 'GPKG', transform: 'trunc(50)', status: 'mapped' },
  { layer: 'Poles (Civil Audit)', qfieldAttribute: 'Splitter', ffTable: 'poles', ffColumn: 'splitter', importPath: 'GPKG', transform: 'trunc(50)', status: 'mapped' },
  { layer: 'Poles (Civil Audit)', qfieldAttribute: 'SlackonPol / slack_on_pole', ffTable: 'poles', ffColumn: 'slack_on_pole', importPath: 'GPKG', transform: 'trunc(50)', status: 'mapped' },
  { layer: 'Poles (Civil Audit)', qfieldAttribute: 'FieldAgent / field_agent', ffTable: 'poles', ffColumn: 'field_agent', importPath: 'GPKG', transform: 'none', status: 'mapped' },
  { layer: 'Poles (Civil Audit)', qfieldAttribute: 'Pole Plant Date / pole_planted', ffTable: 'poles', ffColumn: 'pole_planted', importPath: 'GPKG', transform: 'varchar (not date!)', status: 'mapped' },
  { layer: 'Poles (Civil Audit)', qfieldAttribute: 'AuditDate / audit_complete', ffTable: 'poles', ffColumn: 'audit_complete', importPath: 'GPKG', transform: 'date', status: 'mapped' },
  { layer: 'Poles (Civil Audit)', qfieldAttribute: 'zone_no', ffTable: 'poles', ffColumn: 'zone_no', importPath: 'GPKG', transform: 'safeInt', status: 'mapped' },
  { layer: 'Poles (Civil Audit)', qfieldAttribute: 'pon_no', ffTable: 'poles', ffColumn: 'pon_no', importPath: 'GPKG', transform: 'safeInt', status: 'mapped' },

  // Poles — QFieldCloud API extras (queried but NOT imported by GPKG)
  { layer: 'Poles (Civil Audit)', qfieldAttribute: 'Status', ffTable: '—', ffColumn: '—', importPath: 'API Sync', transform: '—', status: 'gap' },
  { layer: 'Poles (Civil Audit)', qfieldAttribute: 'height', ffTable: '—', ffColumn: '—', importPath: 'API Sync', transform: '—', status: 'gap' },
  { layer: 'Poles (Civil Audit)', qfieldAttribute: 'material', ffTable: '—', ffColumn: '—', importPath: 'API Sync', transform: '—', status: 'gap' },
  { layer: 'Poles (Civil Audit)', qfieldAttribute: 'address', ffTable: '—', ffColumn: '—', importPath: 'API Sync', transform: '—', status: 'gap' },
  { layer: 'Poles (Civil Audit)', qfieldAttribute: 'notes', ffTable: '—', ffColumn: '—', importPath: 'API Sync', transform: '—', status: 'gap' },
  { layer: 'Poles (Civil Audit)', qfieldAttribute: 'photos (array)', ffTable: '—', ffColumn: '—', importPath: 'API Sync', transform: '—', status: 'gap' },
  { layer: 'Poles (Civil Audit)', qfieldAttribute: 'Q/A Date', ffTable: '—', ffColumn: '—', importPath: 'GPKG', transform: '—', status: 'gap' },
  { layer: 'Poles (Civil Audit)', qfieldAttribute: 'Q/A Civil Comments', ffTable: '—', ffColumn: '—', importPath: 'GPKG', transform: '—', status: 'gap' },
  { layer: 'Poles (Civil Audit)', qfieldAttribute: 'Q/A Pole Comments', ffTable: '—', ffColumn: '—', importPath: 'GPKG', transform: '—', status: 'gap' },
  { layer: 'Poles (Civil Audit)', qfieldAttribute: 'AG (code)', ffTable: '—', ffColumn: '—', importPath: 'GPKG', transform: '—', status: 'gap' },
  { layer: 'Poles (Civil Audit)', qfieldAttribute: 'BL (code)', ffTable: '—', ffColumn: '—', importPath: 'GPKG', transform: '—', status: 'gap' },
  { layer: 'Poles (Civil Audit)', qfieldAttribute: 'PhotoPole', ffTable: '—', ffColumn: '—', importPath: 'GPKG', transform: '—', status: 'gap' },
  { layer: 'Poles (Civil Audit)', qfieldAttribute: 'PhotoJoint', ffTable: '—', ffColumn: '—', importPath: 'GPKG', transform: '—', status: 'gap' },
  { layer: 'Poles (Civil Audit)', qfieldAttribute: 'PhotoLabel', ffTable: '—', ffColumn: '—', importPath: 'GPKG', transform: '—', status: 'gap' },
  { layer: 'Poles (Civil Audit)', qfieldAttribute: 'PhotoSlack', ffTable: '—', ffColumn: '—', importPath: 'GPKG', transform: '—', status: 'gap' },
  { layer: 'Poles (Civil Audit)', qfieldAttribute: 'FiberComment', ffTable: '—', ffColumn: '—', importPath: 'GPKG', transform: '—', status: 'gap' },
  { layer: 'Poles (Civil Audit)', qfieldAttribute: 'GeneralComment', ffTable: '—', ffColumn: '—', importPath: 'GPKG', transform: '—', status: 'gap' },
  { layer: 'Poles (Civil Audit)', qfieldAttribute: 'Photos 1-8 (DCIM paths)', ffTable: '—', ffColumn: '—', importPath: 'GPKG', transform: '—', status: 'gap' },

  // ──────────────────────────────────────────────────────────────────
  // DROPS
  // ──────────────────────────────────────────────────────────────────
  { layer: 'Drops', qfieldAttribute: 'drop_number', ffTable: 'drops', ffColumn: 'drop_number', importPath: 'Both', transform: 'required key', status: 'mapped' },
  { layer: 'Drops', qfieldAttribute: 'pole_number', ffTable: 'drops', ffColumn: 'pole_number', importPath: 'Both', transform: 'none', status: 'mapped' },
  { layer: 'Drops', qfieldAttribute: 'cable_capacity', ffTable: 'drops', ffColumn: 'cable_capacity', importPath: 'GPKG', transform: 'none', status: 'mapped' },
  { layer: 'Drops', qfieldAttribute: 'pon_no', ffTable: 'drops', ffColumn: 'pon_no', importPath: 'GPKG', transform: 'safeInt', status: 'mapped' },
  { layer: 'Drops', qfieldAttribute: 'zone_no', ffTable: 'drops', ffColumn: 'zone_no', importPath: 'GPKG', transform: 'safeInt', status: 'mapped' },
  { layer: 'Drops', qfieldAttribute: 'latitude', ffTable: 'drops', ffColumn: 'latitude', importPath: 'Both', transform: 'numeric / ST_Y', status: 'mapped' },
  { layer: 'Drops', qfieldAttribute: 'longitude', ffTable: 'drops', ffColumn: 'longitude', importPath: 'Both', transform: 'numeric / ST_X', status: 'mapped' },
  // Drops — gaps
  { layer: 'Drops', qfieldAttribute: 'address', ffTable: '—', ffColumn: '—', importPath: 'API Sync', transform: '—', status: 'gap' },
  { layer: 'Drops', qfieldAttribute: 'customer_name', ffTable: '—', ffColumn: '—', importPath: 'API Sync', transform: '—', status: 'gap' },
  { layer: 'Drops', qfieldAttribute: 'cable_length', ffTable: '—', ffColumn: '—', importPath: 'API Sync', transform: '—', status: 'gap' },
  { layer: 'Drops', qfieldAttribute: 'installation_date', ffTable: '—', ffColumn: '—', importPath: 'API Sync', transform: '—', status: 'gap' },
  { layer: 'Drops', qfieldAttribute: 'status', ffTable: '—', ffColumn: '—', importPath: 'API Sync', transform: '—', status: 'gap' },
  { layer: 'Drops', qfieldAttribute: 'qc_status', ffTable: '—', ffColumn: '—', importPath: 'API Sync', transform: '—', status: 'gap' },
  { layer: 'Drops', qfieldAttribute: 'notes', ffTable: '—', ffColumn: '—', importPath: 'API Sync', transform: '—', status: 'gap' },
  { layer: 'Drops', qfieldAttribute: 'photos', ffTable: '—', ffColumn: '—', importPath: 'API Sync', transform: '—', status: 'gap' },

  // ──────────────────────────────────────────────────────────────────
  // OPTICAL AUDIT
  // ──────────────────────────────────────────────────────────────────
  { layer: 'Optical Audit', qfieldAttribute: 'Status', ffTable: '—', ffColumn: '—', importPath: 'GPKG', transform: '—', status: 'gap' },
  { layer: 'Optical Audit', qfieldAttribute: 'Photo 1 (splice dome)', ffTable: '—', ffColumn: '—', importPath: 'GPKG', transform: '—', status: 'gap' },
  { layer: 'Optical Audit', qfieldAttribute: 'Photo 2 (dome label)', ffTable: '—', ffColumn: '—', importPath: 'GPKG', transform: '—', status: 'gap' },
  { layer: 'Optical Audit', qfieldAttribute: 'Photo 3 (open dome)', ffTable: '—', ffColumn: '—', importPath: 'GPKG', transform: '—', status: 'gap' },
  { layer: 'Optical Audit', qfieldAttribute: 'Photo 4 (splice protectors)', ffTable: '—', ffColumn: '—', importPath: 'GPKG', transform: '—', status: 'gap' },
  { layer: 'Optical Audit', qfieldAttribute: 'Photo 5 (slack management)', ffTable: '—', ffColumn: '—', importPath: 'GPKG', transform: '—', status: 'gap' },
  { layer: 'Optical Audit', qfieldAttribute: 'Photo 6 (strength members)', ffTable: '—', ffColumn: '—', importPath: 'GPKG', transform: '—', status: 'gap' },
  { layer: 'Optical Audit', qfieldAttribute: 'Photo 7 (seals)', ffTable: '—', ffColumn: '—', importPath: 'GPKG', transform: '—', status: 'gap' },
  { layer: 'Optical Audit', qfieldAttribute: 'Photo 8 (pole ID)', ffTable: '—', ffColumn: '—', importPath: 'GPKG', transform: '—', status: 'gap' },
  { layer: 'Optical Audit', qfieldAttribute: 'Q/A Optical Comments', ffTable: '—', ffColumn: '—', importPath: 'GPKG', transform: '—', status: 'gap' },
  { layer: 'Optical Audit', qfieldAttribute: 'Q/A Date', ffTable: '—', ffColumn: '—', importPath: 'GPKG', transform: '—', status: 'gap' },
  { layer: 'Optical Audit', qfieldAttribute: 'Sub Contractor Name', ffTable: '—', ffColumn: '—', importPath: 'GPKG', transform: '—', status: 'gap' },
  { layer: 'Optical Audit', qfieldAttribute: 'HLD reference fields', ffTable: '—', ffColumn: '—', importPath: 'GPKG', transform: '—', status: 'gap' },

  // ──────────────────────────────────────────────────────────────────
  // JOINTS (Dome Joints / Splice Closures / Splitters)
  // ──────────────────────────────────────────────────────────────────
  { layer: 'Joints', qfieldAttribute: 'joint_label', ffTable: 'joints', ffColumn: 'joint_label', importPath: 'GPKG', transform: 'required key', status: 'mapped' },
  { layer: 'Joints', qfieldAttribute: 'joint_type', ffTable: 'joints', ffColumn: 'joint_type', importPath: 'GPKG', transform: 'none', status: 'mapped' },
  { layer: 'Joints', qfieldAttribute: 'cable_capacity', ffTable: 'joints', ffColumn: 'cable_capacity', importPath: 'GPKG', transform: 'none', status: 'mapped' },
  { layer: 'Joints', qfieldAttribute: 'latitude', ffTable: 'joints', ffColumn: 'latitude', importPath: 'GPKG', transform: 'numeric', status: 'mapped' },
  { layer: 'Joints', qfieldAttribute: 'longitude', ffTable: 'joints', ffColumn: 'longitude', importPath: 'GPKG', transform: 'numeric', status: 'mapped' },
  { layer: 'Joints', qfieldAttribute: 'pon_no', ffTable: 'joints', ffColumn: 'pon_no', importPath: 'GPKG', transform: 'safeInt', status: 'mapped' },
  { layer: 'Joints', qfieldAttribute: 'zone_no', ffTable: 'joints', ffColumn: 'zone_no', importPath: 'GPKG', transform: 'safeInt', status: 'mapped' },

  // ──────────────────────────────────────────────────────────────────
  // CABLE SPANS
  // ──────────────────────────────────────────────────────────────────
  { layer: 'Cable Spans', qfieldAttribute: 'span_label / label', ffTable: 'cable_spans', ffColumn: 'span_label', importPath: 'GPKG', transform: 'required key', status: 'mapped' },
  { layer: 'Cable Spans', qfieldAttribute: 'cable_size / cblcpty', ffTable: 'cable_spans', ffColumn: 'cable_size', importPath: 'GPKG', transform: 'none', status: 'mapped' },
  { layer: 'Cable Spans', qfieldAttribute: 'span_type', ffTable: 'cable_spans', ffColumn: 'span_type', importPath: 'GPKG', transform: 'none', status: 'mapped' },
  { layer: 'Cable Spans', qfieldAttribute: 'pon_no', ffTable: 'cable_spans', ffColumn: 'pon_no', importPath: 'GPKG', transform: 'safeInt', status: 'mapped' },
  { layer: 'Cable Spans', qfieldAttribute: 'zone_no', ffTable: 'cable_spans', ffColumn: 'zone_no', importPath: 'GPKG', transform: 'safeInt', status: 'mapped' },
  { layer: 'Cable Spans', qfieldAttribute: 'Length / length_meters', ffTable: 'cable_spans', ffColumn: 'length_meters', importPath: 'GPKG', transform: 'numeric', status: 'mapped' },
  { layer: 'Cable Spans', qfieldAttribute: 'geometry (LineString)', ffTable: 'cable_spans', ffColumn: 'geojson', importPath: 'GPKG', transform: 'JSON.stringify', status: 'mapped' },
  // Cable Spans — gaps
  { layer: 'Cable Spans', qfieldAttribute: 'Status', ffTable: '—', ffColumn: '—', importPath: 'GPKG', transform: '—', status: 'gap' },
  { layer: 'Cable Spans', qfieldAttribute: 'strtfeat (start feature)', ffTable: '—', ffColumn: '—', importPath: 'GPKG', transform: '—', status: 'gap' },
  { layer: 'Cable Spans', qfieldAttribute: 'endfeat (end feature)', ffTable: '—', ffColumn: '—', importPath: 'GPKG', transform: '—', status: 'gap' },
  { layer: 'Cable Spans', qfieldAttribute: 'Test Photo', ffTable: '—', ffColumn: '—', importPath: 'GPKG', transform: '—', status: 'gap' },

  // ──────────────────────────────────────────────────────────────────
  // FIBER CABLES (QFieldCloud API Sync → sow_fibre)
  // ──────────────────────────────────────────────────────────────────
  { layer: 'Fiber Cables (API)', qfieldAttribute: 'cable_id / segment_id', ffTable: 'sow_fibre', ffColumn: 'cable_id', importPath: 'API Sync', transform: 'coalesce', status: 'mapped' },
  { layer: 'Fiber Cables (API)', qfieldAttribute: 'cable_type', ffTable: 'sow_fibre', ffColumn: 'cable_type', importPath: 'API Sync', transform: 'uppercase', status: 'mapped' },
  { layer: 'Fiber Cables (API)', qfieldAttribute: 'cable_size', ffTable: 'sow_fibre', ffColumn: 'cable_size', importPath: 'API Sync', transform: 'number', status: 'mapped' },
  { layer: 'Fiber Cables (API)', qfieldAttribute: 'from_chamber / from_point', ffTable: 'sow_fibre', ffColumn: 'start_location', importPath: 'API Sync', transform: 'coalesce', status: 'mapped' },
  { layer: 'Fiber Cables (API)', qfieldAttribute: 'to_chamber / to_point', ffTable: 'sow_fibre', ffColumn: 'end_location', importPath: 'API Sync', transform: 'coalesce', status: 'mapped' },
  { layer: 'Fiber Cables (API)', qfieldAttribute: 'length / distance', ffTable: 'sow_fibre', ffColumn: 'length', importPath: 'API Sync', transform: 'float', status: 'mapped' },
  { layer: 'Fiber Cables (API)', qfieldAttribute: 'installation_date', ffTable: 'sow_fibre', ffColumn: 'installation_date', importPath: 'API Sync', transform: 'date', status: 'mapped' },
  { layer: 'Fiber Cables (API)', qfieldAttribute: 'installation_status / status', ffTable: 'sow_fibre', ffColumn: 'status', importPath: 'API Sync', transform: 'status map', status: 'mapped' },
  { layer: 'Fiber Cables (API)', qfieldAttribute: 'contractor', ffTable: 'sow_fibre', ffColumn: 'contractor', importPath: 'API Sync', transform: 'none', status: 'mapped' },
  { layer: 'Fiber Cables (API)', qfieldAttribute: 'geometry (LineString)', ffTable: 'sow_fibre', ffColumn: 'route_map', importPath: 'API Sync', transform: 'ST_AsGeoJSON', status: 'mapped' },

  // ──────────────────────────────────────────────────────────────────
  // ZONE BOUNDARIES
  // ──────────────────────────────────────────────────────────────────
  { layer: 'Zone Boundaries', qfieldAttribute: 'zone_no', ffTable: 'zone_boundaries', ffColumn: 'zone_no', importPath: 'GPKG', transform: 'safeInt, required', status: 'mapped' },
  { layer: 'Zone Boundaries', qfieldAttribute: 'geometry (Polygon)', ffTable: 'zone_boundaries', ffColumn: 'geojson', importPath: 'GPKG', transform: 'JSON.stringify', status: 'mapped' },

  // ──────────────────────────────────────────────────────────────────
  // PON BOUNDARIES
  // ──────────────────────────────────────────────────────────────────
  { layer: 'PON Boundaries', qfieldAttribute: 'pon_no', ffTable: 'pon_boundaries', ffColumn: 'pon_no', importPath: 'GPKG', transform: 'safeInt, required', status: 'mapped' },
  { layer: 'PON Boundaries', qfieldAttribute: 'zone_no', ffTable: 'pon_boundaries', ffColumn: 'zone_no', importPath: 'GPKG', transform: 'safeInt', status: 'mapped' },
  { layer: 'PON Boundaries', qfieldAttribute: 'pon_label', ffTable: 'pon_boundaries', ffColumn: 'pon_label', importPath: 'GPKG', transform: 'none', status: 'mapped' },
  { layer: 'PON Boundaries', qfieldAttribute: 'geometry (Polygon)', ffTable: 'pon_boundaries', ffColumn: 'geojson', importPath: 'GPKG', transform: 'JSON.stringify', status: 'mapped' },

  // ──────────────────────────────────────────────────────────────────
  // POPs (Points of Presence)
  // ──────────────────────────────────────────────────────────────────
  { layer: 'POPs', qfieldAttribute: 'pop_label', ffTable: 'pops', ffColumn: 'pop_label', importPath: 'GPKG', transform: 'none', status: 'mapped' },
  { layer: 'POPs', qfieldAttribute: 'geometry (Point)', ffTable: 'pops', ffColumn: 'geojson', importPath: 'GPKG', transform: 'JSON.stringify', status: 'mapped' },

  // ──────────────────────────────────────────────────────────────────
  // PON PROGRESS
  // ──────────────────────────────────────────────────────────────────
  { layer: 'PON Progress', qfieldAttribute: 'status', ffTable: '—', ffColumn: '—', importPath: 'GPKG', transform: '—', status: 'gap' },
  { layer: 'PON Progress', qfieldAttribute: 'comments', ffTable: '—', ffColumn: '—', importPath: 'GPKG', transform: '—', status: 'gap' },

  // ──────────────────────────────────────────────────────────────────
  // SPLICE CLOSURES (config-defined, NOT implemented)
  // ──────────────────────────────────────────────────────────────────
  { layer: 'Splice Closures', qfieldAttribute: 'closure_id', ffTable: '—', ffColumn: '—', importPath: 'Config Only', transform: '—', status: 'planned' },
  { layer: 'Splice Closures', qfieldAttribute: 'type', ffTable: '—', ffColumn: '—', importPath: 'Config Only', transform: '—', status: 'planned' },
  { layer: 'Splice Closures', qfieldAttribute: 'cable_id', ffTable: '—', ffColumn: '—', importPath: 'Config Only', transform: '—', status: 'planned' },
  { layer: 'Splice Closures', qfieldAttribute: 'latitude', ffTable: '—', ffColumn: '—', importPath: 'Config Only', transform: '—', status: 'planned' },
  { layer: 'Splice Closures', qfieldAttribute: 'longitude', ffTable: '—', ffColumn: '—', importPath: 'Config Only', transform: '—', status: 'planned' },
  { layer: 'Splice Closures', qfieldAttribute: 'splice_date', ffTable: '—', ffColumn: '—', importPath: 'Config Only', transform: '—', status: 'planned' },
  { layer: 'Splice Closures', qfieldAttribute: 'technician', ffTable: '—', ffColumn: '—', importPath: 'Config Only', transform: '—', status: 'planned' },
];

// ──────────────────────────────────────────────────────────────────
// Duplicate / overlapping table analysis
// ──────────────────────────────────────────────────────────────────
export interface TableOverlap {
  concept: string;
  tables: string[];
  issue: string;
  recommendation: string;
}

export const tableOverlaps: TableOverlap[] = [
  {
    concept: 'Poles',
    tables: ['poles', 'sow_poles'],
    issue: 'QField imports to "poles", SOW imports to "sow_poles". Two tables for the same entity.',
    recommendation: 'Consolidate into "poles" with source tracking. Migrate sow_poles data.',
  },
  {
    concept: 'Drops',
    tables: ['drops', 'sow_drops'],
    issue: 'QField imports to "drops", SOW imports to "sow_drops". Two tables for the same entity.',
    recommendation: 'Consolidate into "drops" with source tracking. Migrate sow_drops data.',
  },
  {
    concept: 'Fiber / Cables',
    tables: ['sow_fibre', 'cable_spans'],
    issue: 'API sync targets "sow_fibre", GPKG import creates "cable_spans". Different schema for cable data.',
    recommendation: 'Consolidate into "cable_spans" (has geometry). Migrate sow_fibre references.',
  },
  {
    concept: 'Joints vs Splice Closures',
    tables: ['joints'],
    issue: 'GPKG imports "joints" (dome joints, splitters). Config defines "splice_closures" separately but never implemented.',
    recommendation: 'Keep "joints" table. Drop splice_closures config or alias it to joints.',
  },
  {
    concept: 'Optical Audit',
    tables: [],
    issue: 'Entire Optical Audit layer from QField is NOT imported into FF at all.',
    recommendation: 'Create pole_checklist_steps table to capture optical audit data per pole.',
  },
  {
    concept: 'Civil Audit Photos',
    tables: [],
    issue: 'Civil Audit has 8 numbered photo DCIM paths + per-component photos (PhotoPole, PhotoJoint, PhotoLabel, PhotoSlack). None imported.',
    recommendation: 'Import into pole_checklist_steps with photo_key per step.',
  },
  {
    concept: 'QA Comments',
    tables: [],
    issue: 'Q/A Date, Q/A Civil Comments, Q/A Pole Comments, Q/A Optical Comments — none imported.',
    recommendation: 'Import into pole_checklist_steps QA fields.',
  },
];
