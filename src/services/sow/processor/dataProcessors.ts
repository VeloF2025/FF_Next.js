import { NeonPoleData, NeonDropData, NeonFibreData } from '../../neonSOWService';
import { extractValue, extractNumber, extractDate, parseBoolean } from './helpers';

/**
 * Process Lawley-style poles data
 */
export function processPoles(rawData: Record<string, unknown>[]): NeonPoleData[] {
  const processedPoles: NeonPoleData[] = [];
  
  for (const row of rawData) {
    // Extract primary pole information from label_1
    const poleNumber = extractValue(row, ['label_1', 'label', 'pole_number', 'pole_id']);
    
    if (!poleNumber) continue;
    
    const pole: NeonPoleData = {
      pole_number: poleNumber,
      latitude: extractNumber(row, ['lat', 'latitude', 'y', 'coord_y']) || undefined,
      longitude: extractNumber(row, ['lon', 'longitude', 'lng', 'x', 'coord_x']) || undefined,
      status: extractValue(row, ['status', 'pole_status']) || 'planned',
      pole_type: extractValue(row, ['type_1', 'type', 'pole_type']),
      pole_spec: extractValue(row, ['spec_1', 'spec', 'specification']),
      height: extractValue(row, ['dim1', 'height', 'pole_height']),
      diameter: extractValue(row, ['dim2', 'diameter', 'pole_diameter']),
      owner: extractValue(row, ['cmpownr', 'owner', 'company_owner']),
      pon_no: extractNumber(row, ['pon_no', 'pon', 'pon_number']),
      zone_no: extractNumber(row, ['zone_no', 'zone', 'zone_number']),
      address: extractValue(row, ['address', 'location', 'pole_address']),
      municipality: extractValue(row, ['mun', 'municipality', 'city']),
      created_date: extractDate(row, ['datecrtd', 'created_date', 'date_created']),
      created_by: extractValue(row, ['crtdby', 'created_by', 'creator']),
      comments: extractValue(row, ['comments', 'notes', 'remarks']),
      raw_data: row // Store original data for reference
    };
    
    processedPoles.push(pole);
  }
  
  return processedPoles;
}

/**
 * Process Lawley-style drops data
 */
export function processDrops(rawData: Record<string, unknown>[]): NeonDropData[] {
  const processedDrops: NeonDropData[] = [];
  
  for (const row of rawData) {
    const dropNumber = extractValue(row, ['label', 'drop_number', 'drop_id', 'drop_label']);
    
    if (!dropNumber) continue;
    
    const drop: NeonDropData = {
      drop_number: dropNumber,
      pole_number: extractValue(row, ['strtfeat', 'start_feature', 'pole_number', 'from_pole']) || '',
      cable_type: extractValue(row, ['type', 'cable_type']),
      cable_spec: extractValue(row, ['spec', 'specification', 'cable_spec']),
      cable_length: extractValue(row, ['dim2', 'length', 'cable_length', 'distance']),
      cable_capacity: extractValue(row, ['cblcpty', 'capacity', 'cable_capacity']),
      start_point: extractValue(row, ['strtfeat', 'start_feature', 'from']),
      end_point: extractValue(row, ['endfeat', 'end_feature', 'to']),
      latitude: extractNumber(row, ['lat', 'latitude', 'y']),
      longitude: extractNumber(row, ['lon', 'longitude', 'lng', 'x']),
      address: extractValue(row, ['address', 'location', 'drop_address']),
      pon_no: extractNumber(row, ['pon_no', 'pon', 'pon_number']),
      zone_no: extractNumber(row, ['zone_no', 'zone', 'zone_number']),
      municipality: extractValue(row, ['mun', 'municipality', 'city']),
      created_date: extractDate(row, ['datecrtd', 'created_date', 'date_created']),
      created_by: extractValue(row, ['crtdby', 'created_by', 'creator']),
      raw_data: row
    };
    
    processedDrops.push(drop);
  }
  
  return processedDrops;
}

/**
 * Process Lawley-style fibre data
 */
export function processFibre(rawData: Record<string, unknown>[]): NeonFibreData[] {
  const processedFibre: NeonFibreData[] = [];
  
  for (const row of rawData) {
    const segmentId = extractValue(row, ['label', 'segment_id', 'fibre_id', 'cable_id']);
    
    if (!segmentId) continue;
    
    const fibre: NeonFibreData = {
      segment_id: segmentId,
      cable_size: extractValue(row, ['cable size', 'cable_size', 'size', 'capacity']) || '',
      layer: extractValue(row, ['layer', 'cable_layer', 'type']) || '',
      length: extractNumber(row, ['length', 'distance', 'cable_length']) || 0,
      pon_no: extractNumber(row, ['pon_no', 'pon', 'pon_number']),
      zone_no: extractNumber(row, ['zone_no', 'zone', 'zone_number']),
      string_completed: extractNumber(row, ['String Com', 'string_completed', 'completed_length']),
      date_completed: extractDate(row, ['Date Comp', 'date_completed', 'completion_date']),
      contractor: extractValue(row, ['Contractor', 'contractor', 'contractor_name']),
      is_complete: parseBoolean(row, ['Complete', 'is_complete', 'completed']),
      raw_data: row
    };
    
    processedFibre.push(fibre);
  }
  
  return processedFibre;
}