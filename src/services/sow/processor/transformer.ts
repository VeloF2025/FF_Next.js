import { NeonPoleData, NeonDropData, NeonFibreData } from '../neonSOWService';
import { extractValue, extractNumber, extractDate, parseBoolean } from './parser';

/**
 * SOW Data Transformer
 * Transforms raw data into structured formats
 */

/**
 * Process Lawley-style poles data
 */
export function transformPoles(rawData: any[]): NeonPoleData[] {
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
 *
 * Column alias mappings support multiple export formats:
 * - PlanNet/Fibertime format: label (drop), strtfeat (Pole), dim2, cblcpty, etc.
 * - Standard format: drop_number, pole_number, cable_length, etc.
 */
export function transformDrops(rawData: any[]): NeonDropData[] {
  const processedDrops: NeonDropData[] = [];

  for (const row of rawData) {
    // Support both 'label (drop)' from PlanNet and standard column names
    const dropNumber = extractValue(row, [
      'label (drop)', 'label', 'drop_number', 'drop_id', 'drop_label', 'drop'
    ]);

    if (!dropNumber) continue;

    const drop: NeonDropData = {
      drop_number: dropNumber,
      // Support 'strtfeat (Pole)' from PlanNet exports
      pole_number: extractValue(row, [
        'strtfeat (Pole)', 'strtfeat', 'start_feature', 'pole_number', 'from_pole', 'pole'
      ]) || '',
      // 'subtyp' indicates cable type in PlanNet (e.g., 'Drop')
      cable_type: extractValue(row, ['subtyp', 'type', 'cable_type', 'subtype']),
      cable_spec: extractValue(row, ['spec', 'specification', 'cable_spec']),
      // 'dim2' contains cable length in PlanNet (e.g., '30m')
      cable_length: extractValue(row, ['dim2', 'length', 'cable_length', 'distance']),
      // 'cblcpty' is cable capacity in PlanNet (e.g., '1F')
      cable_capacity: extractValue(row, ['cblcpty', 'capacity', 'cable_capacity', 'fibre_count']),
      start_point: extractValue(row, ['strtfeat (Pole)', 'strtfeat', 'start_feature', 'from']),
      // 'endfeat' is the end point (usually ONT reference)
      end_point: extractValue(row, ['endfeat', 'end_feature', 'to', 'ont']),
      latitude: extractNumber(row, ['lat', 'latitude', 'y']),
      longitude: extractNumber(row, ['lon', 'longitude', 'lng', 'x']),
      address: extractValue(row, ['address', 'location', 'drop_address']),
      pon_no: extractNumber(row, ['pon_no', 'pon', 'pon_number']),
      zone_no: extractNumber(row, ['zone_no', 'zone', 'zone_number']),
      municipality: extractValue(row, ['mun', 'municipality', 'city']),
      // 'stackref (Project)' contains project reference in PlanNet
      project_ref: extractValue(row, ['stackref (Project)', 'stackref', 'project', 'project_code']),
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
export function transformFibre(rawData: any[]): NeonFibreData[] {
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

/**
 * Transform generic data based on type
 */
export function transformData(rawData: any[], type: 'poles' | 'drops' | 'fibre'): any[] {
  switch (type) {
    case 'poles':
      return transformPoles(rawData);
    case 'drops':
      return transformDrops(rawData);
    case 'fibre':
      return transformFibre(rawData);
    default:
      throw new Error(`Unsupported data type: ${type}`);
  }
}

/**
 * Get transformation statistics
 */
export function getTransformStats(originalData: any[], transformedData: any[]): {
  totalRows: number;
  transformedRows: number;
  skippedRows: number;
  successRate: number;
} {
  const totalRows = originalData.length;
  const transformedRows = transformedData.length;
  const skippedRows = totalRows - transformedRows;
  const successRate = totalRows > 0 ? (transformedRows / totalRows) * 100 : 0;

  return {
    totalRows,
    transformedRows,
    skippedRows,
    successRate: Math.round(successRate * 100) / 100
  };
}

/**
 * Enrich data with computed fields
 */
export function enrichTransformedData(data: any[], type: 'poles' | 'drops' | 'fibre'): any[] {
  return data.map(item => {
    const enriched = { ...item };
    
    // Add computed fields based on type
    switch (type) {
      case 'poles':
        enriched.has_coordinates = !!(item.latitude && item.longitude);
        enriched.is_complete = item.status === 'complete' || item.status === 'installed';
        break;
        
      case 'drops':
        enriched.has_coordinates = !!(item.latitude && item.longitude);
        enriched.has_pole_assignment = !!item.pole_number;
        enriched.cable_length_numeric = parseFloat(item.cable_length) || 0;
        break;
        
      case 'fibre':
        enriched.completion_percentage = item.string_completed && item.length ? 
          Math.min(100, (item.string_completed / item.length) * 100) : 0;
        enriched.is_fully_complete = item.completion_percentage >= 100;
        break;
    }
    
    // Add common fields
    enriched.processed_at = new Date().toISOString();
    enriched.data_quality_score = calculateDataQualityScore(item, type);
    
    return enriched;
  });
}

/**
 * Calculate data quality score based on completeness
 */
function calculateDataQualityScore(item: any, type: 'poles' | 'drops' | 'fibre'): number {
  let score = 0;
  let maxScore = 0;
  
  const requiredFields = getRequiredFields(type);
  const optionalFields = getOptionalFields(type);
  
  // Check required fields (weight: 2)
  for (const field of requiredFields) {
    maxScore += 2;
    if (item[field] !== undefined && item[field] !== null && item[field] !== '') {
      score += 2;
    }
  }
  
  // Check optional fields (weight: 1)
  for (const field of optionalFields) {
    maxScore += 1;
    if (item[field] !== undefined && item[field] !== null && item[field] !== '') {
      score += 1;
    }
  }
  
  return maxScore > 0 ? Math.round((score / maxScore) * 100) : 0;
}

function getRequiredFields(type: 'poles' | 'drops' | 'fibre'): string[] {
  switch (type) {
    case 'poles':
      return ['pole_number'];
    case 'drops':
      return ['drop_number'];
    case 'fibre':
      return ['segment_id'];
    default:
      return [];
  }
}

function getOptionalFields(type: 'poles' | 'drops' | 'fibre'): string[] {
  switch (type) {
    case 'poles':
      return ['latitude', 'longitude', 'status', 'pole_type', 'height', 'address'];
    case 'drops':
      return ['latitude', 'longitude', 'cable_type', 'cable_length', 'pole_number'];
    case 'fibre':
      return ['cable_size', 'length', 'contractor', 'is_complete'];
    default:
      return [];
  }
}