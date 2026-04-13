/**
 * SOW Data Validator - Main Validation Orchestrator
 * Coordinates validation of SOW data using validation rules
 */

import { NeonPoleData, NeonDropData, NeonFibreData } from '../../neonSOWService';
import { ValidationResult, CrossValidationResult } from './validator-types';
import { log } from '@/lib/logger';

/**
 * Main SOW data validator class
 */
export class SOWValidator {
  /**
   * Validate poles data - Minimal validation for import
   */
  static validatePoles(poles: NeonPoleData[]): ValidationResult<NeonPoleData> {
    const valid: NeonPoleData[] = [];
    const invalid: unknown[] = [];
    const errors: string[] = [];
    const seenPoleNumbers = new Set<string>();
    
    for (const pole of poles) {
      // Minimal validation - just check for pole number and duplicates
      if (!pole.pole_number || pole.pole_number.trim() === '') {
        invalid.push({ ...pole, errors: [{ 
          field: 'pole_number',
          value: pole.pole_number,
          message: 'Missing pole number',
          severity: 'error',
          code: 'MISSING_POLE_NUMBER'
        }] });
        errors.push(`Missing pole number in row`);
      } else if (seenPoleNumbers.has(pole.pole_number)) {
        invalid.push({ ...pole, errors: [{
          field: 'pole_number',
          value: pole.pole_number,
          message: `Duplicate pole number: ${pole.pole_number}`,
          severity: 'error',
          code: 'DUPLICATE_POLE_NUMBER'
        }] });
        errors.push(`Duplicate pole number: ${pole.pole_number}`);
      } else {
        // Accept the pole as valid - no strict format validation
        seenPoleNumbers.add(pole.pole_number);
        valid.push(pole);
      }
    }
    
    return { valid, invalid, errors };
  }

  /**
   * Validate drops data - Minimal validation for import
   */
  static validateDrops(drops: NeonDropData[]): ValidationResult<NeonDropData> {
    const valid: NeonDropData[] = [];
    const invalid: unknown[] = [];
    const errors: string[] = [];
    const seenDropNumbers = new Set<string>();
    
    for (const drop of drops) {
      // Minimal validation - just check for drop number and duplicates
      if (!drop.drop_number || drop.drop_number.trim() === '') {
        invalid.push({ ...drop, errors: [{ 
          field: 'drop_number',
          value: drop.drop_number,
          message: 'Missing drop number',
          severity: 'error',
          code: 'MISSING_DROP_NUMBER'
        }] });
        errors.push(`Missing drop number in row`);
      } else if (seenDropNumbers.has(drop.drop_number)) {
        invalid.push({ ...drop, errors: [{
          field: 'drop_number',
          value: drop.drop_number,
          message: `Duplicate drop number: ${drop.drop_number}`,
          severity: 'error',
          code: 'DUPLICATE_DROP_NUMBER'
        }] });
        errors.push(`Duplicate drop number: ${drop.drop_number}`);
      } else {
        // Accept the drop as valid - no strict format validation
        seenDropNumbers.add(drop.drop_number);
        valid.push(drop);
        
        // Log warning for missing pole assignment (not an error)
        if (!drop.pole_number) {
          log.warn(`Drop ${drop.drop_number} has no pole assignment`, undefined, 'sow-validator');
        }
      }
    }
    
    return { valid, invalid, errors };
  }

  /**
   * Validate fibre data - Minimal validation for import
   */
  static validateFibre(fibres: NeonFibreData[]): ValidationResult<NeonFibreData> {
    const valid: NeonFibreData[] = [];
    const invalid: unknown[] = [];
    const errors: string[] = [];
    const seenSegmentIds = new Set<string>();
    
    for (const fibre of fibres) {
      // Minimal validation - just check for segment ID and duplicates
      if (!fibre.segment_id || fibre.segment_id.trim() === '') {
        invalid.push({ ...fibre, errors: [{
          field: 'segment_id',
          value: fibre.segment_id,
          message: 'Missing segment ID',
          severity: 'error',
          code: 'MISSING_SEGMENT_ID'
        }] });
        errors.push(`Missing segment ID in row`);
      } else if (seenSegmentIds.has(fibre.segment_id)) {
        invalid.push({ ...fibre, errors: [{
          field: 'segment_id',
          value: fibre.segment_id,
          message: `Duplicate segment ID: ${fibre.segment_id}`,
          severity: 'error',
          code: 'DUPLICATE_SEGMENT_ID'
        }] });
        errors.push(`Duplicate segment ID: ${fibre.segment_id}`);
      } else {
        // Accept the fibre as valid - no strict format validation
        seenSegmentIds.add(fibre.segment_id);
        valid.push(fibre);
      }
    }
    
    return { valid, invalid, errors };
  }

  /**
   * Validate data based on type
   */
  static validateData(data: NeonPoleData[] | NeonDropData[] | NeonFibreData[], type: 'poles' | 'drops' | 'fibre'): ValidationResult<NeonPoleData | NeonDropData | NeonFibreData> {
    switch (type) {
      case 'poles':
        return this.validatePoles(data as NeonPoleData[]);
      case 'drops':
        return this.validateDrops(data as NeonDropData[]);
      case 'fibre':
        return this.validateFibre(data as NeonFibreData[]);
      default:
        throw new Error(`Unsupported data type: ${type}`);
    }
  }

  /**
   * Cross-validate data relationships
   */
  static crossValidateData(poles: NeonPoleData[], drops: NeonDropData[]): CrossValidationResult {
    const poleNumbers = new Set(poles.map(p => p.pole_number));
    const orphanedDrops: NeonDropData[] = [];
    const missingPoles: string[] = [];
    const inconsistentReferences: Array<{
      dropId: string;
      poleNumber: string;
      issue: string;
    }> = [];
    
    let validReferences = 0;
    let invalidReferences = 0;
    
    // Check for drops referencing non-existent poles
    for (const drop of drops) {
      if (drop.pole_number) {
        if (poleNumbers.has(drop.pole_number)) {
          validReferences++;
        } else {
          invalidReferences++;
          orphanedDrops.push(drop);
          if (!missingPoles.includes(drop.pole_number)) {
            missingPoles.push(drop.pole_number);
          }
          inconsistentReferences.push({
            dropId: drop.drop_number,
            poleNumber: drop.pole_number,
            issue: 'References non-existent pole'
          });
        }
      }
    }
    
    const summary = {
      totalDrops: drops.length,
      validReferences,
      invalidReferences
    };
    
    return {
      orphanedDrops,
      missingPoles,
      inconsistentReferences,
      summary
    };
  }
}