/**
 * Field Mappings for Project Import
 * PRD-047: Excel column → Database field mappings
 *
 * Based on analysis of:
 * - docs/Uploads/Lawley/Drops_Lawley.xlsx
 * - docs/Uploads/Lawley/Fibre_Lawley.xlsx
 * - Existing data processors in src/services/sow/processor/dataProcessors.ts
 */

import { DataTypeMapping, FieldMapping } from './types';

/**
 * DROPS Field Mapping
 * Source: HLD_Home sheet from SOW/PlanNet exports
 * Target: public.drops table
 */
export const DROPS_MAPPING: DataTypeMapping = {
  dataType: 'drops',
  tableName: 'drops',
  primaryKey: 'id',
  uniqueConstraint: ['project_id', 'drop_number'],
  fields: [
    {
      excelHeaders: ['label', 'drop_number', 'drop_id', 'drop_label'],
      dbColumn: 'drop_number',
      type: 'string',
      required: true,
    },
    {
      excelHeaders: ['strtfeat', 'start_feature', 'pole_number', 'from_pole'],
      dbColumn: 'pole_number',
      type: 'string',
      required: false,
    },
    {
      excelHeaders: ['type', 'cable_type'],
      dbColumn: 'cable_type',
      type: 'string',
      required: false,
    },
    {
      excelHeaders: ['spec', 'specification', 'cable_spec'],
      dbColumn: 'cable_spec',
      type: 'string',
      required: false,
    },
    {
      excelHeaders: ['dim2', 'length', 'cable_length', 'distance'],
      dbColumn: 'cable_length',
      type: 'string',
      required: false,
    },
    {
      excelHeaders: ['cblcpty', 'capacity', 'cable_capacity', 'fibre_count'],
      dbColumn: 'cable_capacity',
      type: 'string',
      required: false,
    },
    {
      excelHeaders: ['strtfeat', 'start_feature', 'from'],
      dbColumn: 'start_point',
      type: 'string',
      required: false,
    },
    {
      excelHeaders: ['endfeat', 'end_feature', 'to', 'ont'],
      dbColumn: 'end_point',
      type: 'string',
      required: false,
    },
    {
      excelHeaders: ['lat', 'latitude', 'y', 'coord_y'],
      dbColumn: 'latitude',
      type: 'number',
      required: false,
    },
    {
      excelHeaders: ['lon', 'longitude', 'lng', 'x', 'coord_x'],
      dbColumn: 'longitude',
      type: 'number',
      required: false,
    },
    {
      excelHeaders: ['address', 'location', 'drop_address', 'street'],
      dbColumn: 'address',
      type: 'string',
      required: false,
    },
    {
      excelHeaders: ['pon_no', 'pon', 'pon_number'],
      dbColumn: 'pon_no',
      type: 'number',
      required: false,
    },
    {
      excelHeaders: ['zone_no', 'zone', 'zone_number'],
      dbColumn: 'zone_no',
      type: 'number',
      required: false,
    },
    {
      excelHeaders: ['mun', 'municipality', 'city', 'town'],
      dbColumn: 'municipality',
      type: 'string',
      required: false,
    },
    {
      excelHeaders: ['crtdby', 'created_by', 'creator', 'user'],
      dbColumn: 'created_by',
      type: 'string',
      required: false,
    },
    {
      excelHeaders: ['subtyp', 'subtype', 'type_indicator'],
      dbColumn: 'status',
      type: 'string',
      required: false,
      transform: (value) => value || 'planned',
    },
    {
      excelHeaders: ['comments', 'notes', 'remarks'],
      dbColumn: 'notes',
      type: 'string',
      required: false,
    },
  ],
};

/**
 * POLES Field Mapping
 * Source: HLD_Pole sheet from SOW/PlanNet exports
 * Target: public.poles table
 */
export const POLES_MAPPING: DataTypeMapping = {
  dataType: 'poles',
  tableName: 'poles',
  primaryKey: 'id',
  uniqueConstraint: ['project_id', 'pole_number'],
  fields: [
    {
      excelHeaders: ['label_1', 'label', 'pole_number', 'pole_id'],
      dbColumn: 'pole_number',
      type: 'string',
      required: true,
    },
    {
      excelHeaders: ['lat', 'latitude', 'y', 'coord_y'],
      dbColumn: 'latitude',
      type: 'number',
      required: false,
    },
    {
      excelHeaders: ['lon', 'longitude', 'lng', 'x', 'coord_x'],
      dbColumn: 'longitude',
      type: 'number',
      required: false,
    },
    {
      excelHeaders: ['type_1', 'type', 'pole_type'],
      dbColumn: 'pole_type',
      type: 'string',
      required: false,
    },
    {
      excelHeaders: ['spec_1', 'spec', 'specification', 'pole_spec'],
      dbColumn: 'pole_spec',
      type: 'string',
      required: false,
    },
    {
      excelHeaders: ['dim1', 'height', 'pole_height'],
      dbColumn: 'height',
      type: 'string',
      required: false,
    },
    {
      excelHeaders: ['dim2', 'diameter', 'pole_diameter'],
      dbColumn: 'diameter',
      type: 'string',
      required: false,
    },
    {
      excelHeaders: ['cmpownr', 'owner', 'company_owner'],
      dbColumn: 'owner',
      type: 'string',
      required: false,
    },
    {
      excelHeaders: ['pon_no', 'pon', 'pon_number'],
      dbColumn: 'pon_no',
      type: 'number',
      required: false,
    },
    {
      excelHeaders: ['zone_no', 'zone', 'zone_number'],
      dbColumn: 'zone_no',
      type: 'number',
      required: false,
    },
    {
      excelHeaders: ['address', 'location', 'pole_address'],
      dbColumn: 'address',
      type: 'string',
      required: false,
    },
    {
      excelHeaders: ['mun', 'municipality', 'city'],
      dbColumn: 'municipality',
      type: 'string',
      required: false,
    },
    {
      excelHeaders: ['crtdby', 'created_by', 'creator'],
      dbColumn: 'created_by',
      type: 'string',
      required: false,
    },
    {
      excelHeaders: ['comments', 'notes', 'remarks'],
      dbColumn: 'comments',
      type: 'string',
      required: false,
    },
    {
      excelHeaders: ['status', 'pole_status'],
      dbColumn: 'status',
      type: 'string',
      required: false,
      transform: (value) => value || 'planned',
    },
  ],
};

/**
 * FIBRE Field Mapping
 * Source: JDW_Exp sheet from SOW/PlanNet exports
 * Target: public.fibre_segments table
 */
export const FIBRE_MAPPING: DataTypeMapping = {
  dataType: 'fibre',
  tableName: 'fibre_segments',
  primaryKey: 'id',
  uniqueConstraint: ['project_id', 'segment_id'],
  fields: [
    {
      excelHeaders: ['label', 'segment_id', 'fibre_id', 'cable_id'],
      dbColumn: 'segment_id',
      type: 'string',
      required: true,
    },
    {
      excelHeaders: ['cable size', 'cable_size', 'size', 'capacity'],
      dbColumn: 'cable_size',
      type: 'string',
      required: false,
    },
    {
      excelHeaders: ['layer', 'cable_layer', 'type'],
      dbColumn: 'layer',
      type: 'string',
      required: false,
    },
    {
      excelHeaders: ['length', 'distance', 'cable_length'],
      dbColumn: 'length',
      type: 'number',
      required: false,
    },
    {
      excelHeaders: ['pon_no', 'pon', 'pon_number'],
      dbColumn: 'pon_no',
      type: 'number',
      required: false,
    },
    {
      excelHeaders: ['zone_no', 'zone', 'zone_number'],
      dbColumn: 'zone_no',
      type: 'number',
      required: false,
    },
    {
      excelHeaders: ['String Com', 'string_completed', 'completed_length', 'string_com'],
      dbColumn: 'string_completed',
      type: 'number',
      required: false,
    },
    {
      excelHeaders: ['Date Comp', 'date_completed', 'completion_date', 'date_comp'],
      dbColumn: 'date_completed',
      type: 'date',
      required: false,
    },
    {
      excelHeaders: ['Contractor', 'contractor', 'contractor_name'],
      dbColumn: 'contractor',
      type: 'string',
      required: false,
    },
    {
      excelHeaders: ['Complete', 'is_complete', 'completed'],
      dbColumn: 'is_complete',
      type: 'boolean',
      required: false,
    },
  ],
};

/**
 * Get mapping for a data type
 */
export function getMapping(dataType: string): DataTypeMapping | null {
  switch (dataType) {
    case 'drops':
      return DROPS_MAPPING;
    case 'poles':
      return POLES_MAPPING;
    case 'fibre':
      return FIBRE_MAPPING;
    default:
      return null;
  }
}

/**
 * Get all mappings
 */
export function getAllMappings(): DataTypeMapping[] {
  return [DROPS_MAPPING, POLES_MAPPING, FIBRE_MAPPING];
}

/**
 * Find matching DB column for an Excel header
 */
export function findDbColumn(
  mapping: DataTypeMapping,
  excelHeader: string
): FieldMapping | null {
  const normalizedHeader = excelHeader.toLowerCase().trim();

  for (const field of mapping.fields) {
    if (field.excelHeaders.some(h => h.toLowerCase() === normalizedHeader)) {
      return field;
    }
  }

  return null;
}

/**
 * Get required fields for a data type
 */
export function getRequiredFields(dataType: string): string[] {
  const mapping = getMapping(dataType);
  if (!mapping) return [];

  return mapping.fields
    .filter(f => f.required)
    .flatMap(f => f.excelHeaders);
}
