import { NeonPoleData, NeonDropData, NeonFibreData } from '../../neonSOWService';
import { log } from '@/lib/logger';

type InvalidRecord<T> = T & { errors: string[] };

/**
 * Validate poles data
 */
export function validatePoles(poles: NeonPoleData[]): { valid: NeonPoleData[], invalid: InvalidRecord<NeonPoleData>[], errors: string[] } {
  const valid: NeonPoleData[] = [];
  const invalid: InvalidRecord<NeonPoleData>[] = [];
  const errors: string[] = [];
  const seenPoleNumbers = new Set<string>();
  
  for (const pole of poles) {
    const poleErrors: string[] = [];
    
    // Check required fields
    if (!pole.pole_number) {
      poleErrors.push('Missing pole number');
    } else if (seenPoleNumbers.has(pole.pole_number)) {
      poleErrors.push(`Duplicate pole number: ${pole.pole_number}`);
    } else {
      seenPoleNumbers.add(pole.pole_number);
    }
    
    // Validate coordinates
    if (pole.latitude !== undefined && (pole.latitude < -90 || pole.latitude > 90)) {
      poleErrors.push(`Invalid latitude: ${pole.latitude}`);
    }
    if (pole.longitude !== undefined && (pole.longitude < -180 || pole.longitude > 180)) {
      poleErrors.push(`Invalid longitude: ${pole.longitude}`);
    }
    
    if (poleErrors.length === 0) {
      valid.push(pole);
    } else {
      invalid.push({ ...pole, errors: poleErrors });
      errors.push(`Pole ${pole.pole_number}: ${poleErrors.join(', ')}`);
    }
  }
  
  return { valid, invalid, errors };
}

/**
 * Validate drops data
 */
export function validateDrops(drops: NeonDropData[]): { valid: NeonDropData[], invalid: InvalidRecord<NeonDropData>[], errors: string[] } {
  const valid: NeonDropData[] = [];
  const invalid: InvalidRecord<NeonDropData>[] = [];
  const errors: string[] = [];
  const seenDropNumbers = new Set<string>();
  
  for (const drop of drops) {
    const dropErrors: string[] = [];
    
    // Check required fields
    if (!drop.drop_number) {
      dropErrors.push('Missing drop number');
    } else if (seenDropNumbers.has(drop.drop_number)) {
      dropErrors.push(`Duplicate drop number: ${drop.drop_number}`);
    } else {
      seenDropNumbers.add(drop.drop_number);
    }
    
    // Warning for missing pole assignment (not an error)
    if (!drop.pole_number) {
      log.warn(`Drop ${drop.drop_number} has no pole assignment`, undefined, 'validators');
    }
    
    if (dropErrors.length === 0) {
      valid.push(drop);
    } else {
      invalid.push({ ...drop, errors: dropErrors });
      errors.push(`Drop ${drop.drop_number}: ${dropErrors.join(', ')}`);
    }
  }
  
  return { valid, invalid, errors };
}

/**
 * Validate fibre data
 */
export function validateFibre(fibres: NeonFibreData[]): { valid: NeonFibreData[], invalid: InvalidRecord<NeonFibreData>[], errors: string[] } {
  const valid: NeonFibreData[] = [];
  const invalid: InvalidRecord<NeonFibreData>[] = [];
  const errors: string[] = [];
  const seenSegmentIds = new Set<string>();
  
  for (const fibre of fibres) {
    const fibreErrors: string[] = [];
    
    // Check required fields
    if (!fibre.segment_id) {
      fibreErrors.push('Missing segment ID');
    } else if (seenSegmentIds.has(fibre.segment_id)) {
      fibreErrors.push(`Duplicate segment ID: ${fibre.segment_id}`);
    } else {
      seenSegmentIds.add(fibre.segment_id);
    }
    
    // Validate length
    if (fibre.length !== undefined && fibre.length < 0) {
      fibreErrors.push(`Invalid length: ${fibre.length}`);
    }
    
    if (fibreErrors.length === 0) {
      valid.push(fibre);
    } else {
      invalid.push({ ...fibre, errors: fibreErrors });
      errors.push(`Segment ${fibre.segment_id}: ${fibreErrors.join(', ')}`);
    }
  }
  
  return { valid, invalid, errors };
}