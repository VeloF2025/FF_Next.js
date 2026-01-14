import { describe, it, expect } from 'vitest';
import { photoTypeToStep, stepToPhotoTypes, PHOTO_TYPE_TO_STEP, STEP_TO_PHOTO_TYPES } from '@/modules/dr-photo-unified/utils/stepMapper';

/**
 * Test Suite: Step Mapping Utility
 *
 * Purpose: Bidirectional mapping between photo types (port 8003) and unified 12 steps
 * Status: RED phase - These tests should FAIL until implementation is complete
 *
 * Following TDD principles:
 * 1. RED: Write failing tests (this file)
 * 2. GREEN: Implement code to make tests pass
 * 3. REFACTOR: Improve code while keeping tests green
 */

describe('stepMapper', () => {
  describe('photoTypeToStep', () => {
    describe('TC1.1: Photo Type to Step Mapping (Basic)', () => {
      it('should map ph_prop to step 1 (House Photo)', () => {
        expect(photoTypeToStep('ph_prop')).toBe(1);
      });

      it('should map ph_sign1 to step 1 (House Photo alternate)', () => {
        expect(photoTypeToStep('ph_sign1')).toBe(1);
      });

      it('should map ph_pole to step 2 (Cable from Pole)', () => {
        expect(photoTypeToStep('ph_pole')).toBe(2);
      });

      it('should map ph_cbl_r to step 2 (Cable from Pole alternate)', () => {
        expect(photoTypeToStep('ph_cbl_r')).toBe(2);
      });

      it('should map ph_entry_out to step 3 (Entry Outside)', () => {
        expect(photoTypeToStep('ph_entry_out')).toBe(3);
      });

      it('should map ph_hm_ln to step 3 (Entry Outside alternate)', () => {
        expect(photoTypeToStep('ph_hm_ln')).toBe(3);
      });

      it('should map ph_entry_in to step 4 (Entry Inside)', () => {
        expect(photoTypeToStep('ph_entry_in')).toBe(4);
      });

      it('should map ph_hm_en to step 4 (Entry Inside alternate)', () => {
        expect(photoTypeToStep('ph_hm_en')).toBe(4);
      });

      it('should map ph_wall to step 5 (Wall)', () => {
        expect(photoTypeToStep('ph_wall')).toBe(5);
      });

      it('should map ph_ont to step 6 (ONT Back)', () => {
        expect(photoTypeToStep('ph_ont')).toBe(6);
      });

      it('should map ph_ont_back to step 6 (ONT Back alternate)', () => {
        expect(photoTypeToStep('ph_ont_back')).toBe(6);
      });

      it('should map ph_powm to step 7 (Power Meter)', () => {
        expect(photoTypeToStep('ph_powm')).toBe(7);
      });

      it('should map ph_powm2 to step 7 (Power Meter alternate)', () => {
        expect(photoTypeToStep('ph_powm2')).toBe(7);
      });

      it('should map ph_bl to step 8 (ONT Barcode)', () => {
        expect(photoTypeToStep('ph_bl')).toBe(8);
      });

      it('should map ph_barcode to step 8 (ONT Barcode alternate)', () => {
        expect(photoTypeToStep('ph_barcode')).toBe(8);
      });

      it('should map ph_ups to step 9 (UPS)', () => {
        expect(photoTypeToStep('ph_ups')).toBe(9);
      });

      it('should map ph_after to step 10 (Final)', () => {
        expect(photoTypeToStep('ph_after')).toBe(10);
      });

      it('should map ph_final to step 10 (Final alternate)', () => {
        expect(photoTypeToStep('ph_final')).toBe(10);
      });

      it('should map ph_lights to step 11 (Green Lights)', () => {
        expect(photoTypeToStep('ph_lights')).toBe(11);
      });

      it('should map ph_led to step 11 (Green Lights alternate)', () => {
        expect(photoTypeToStep('ph_led')).toBe(11);
      });
    });

    describe('TC1.2: Invalid Photo Type Handling', () => {
      it('should return null for invalid photo type', () => {
        expect(photoTypeToStep('invalid_type')).toBeNull();
      });

      it('should return null for unknown photo type', () => {
        expect(photoTypeToStep('ph_unknown')).toBeNull();
      });

      it('should return null for empty string', () => {
        expect(photoTypeToStep('')).toBeNull();
      });

      it('should return null for null input', () => {
        expect(photoTypeToStep(null as any)).toBeNull();
      });

      it('should return null for undefined input', () => {
        expect(photoTypeToStep(undefined as any)).toBeNull();
      });
    });

    describe('TC1.1: Case Sensitivity', () => {
      it('should be case-sensitive (PH_PROP should not match)', () => {
        expect(photoTypeToStep('PH_PROP')).toBeNull();
      });

      it('should be case-sensitive (Ph_Prop should not match)', () => {
        expect(photoTypeToStep('Ph_Prop')).toBeNull();
      });
    });
  });

  describe('stepToPhotoTypes', () => {
    describe('TC1.3: Step to Photo Types Mapping (Reverse)', () => {
      it('should map step 1 to house photo types', () => {
        expect(stepToPhotoTypes(1)).toEqual(['ph_prop', 'ph_sign1']);
      });

      it('should map step 2 to cable from pole photo types', () => {
        expect(stepToPhotoTypes(2)).toEqual(['ph_pole', 'ph_cbl_r']);
      });

      it('should map step 3 to entry outside photo types', () => {
        expect(stepToPhotoTypes(3)).toEqual(['ph_entry_out', 'ph_hm_ln']);
      });

      it('should map step 4 to entry inside photo types', () => {
        expect(stepToPhotoTypes(4)).toEqual(['ph_entry_in', 'ph_hm_en']);
      });

      it('should map step 5 to wall photo type', () => {
        expect(stepToPhotoTypes(5)).toEqual(['ph_wall']);
      });

      it('should map step 6 to ONT back photo types', () => {
        expect(stepToPhotoTypes(6)).toEqual(['ph_ont', 'ph_ont_back']);
      });

      it('should map step 7 to power meter photo types', () => {
        expect(stepToPhotoTypes(7)).toEqual(['ph_powm', 'ph_powm2']);
      });

      it('should map step 8 to ONT barcode photo types', () => {
        expect(stepToPhotoTypes(8)).toEqual(['ph_bl', 'ph_barcode']);
      });

      it('should map step 9 to UPS photo type', () => {
        expect(stepToPhotoTypes(9)).toEqual(['ph_ups']);
      });

      it('should map step 10 to final installation photo types', () => {
        expect(stepToPhotoTypes(10)).toEqual(['ph_after', 'ph_final']);
      });

      it('should map step 11 to green lights photo types', () => {
        expect(stepToPhotoTypes(11)).toEqual(['ph_lights', 'ph_led']);
      });

      it('should map step 12 to empty array (signature has no photo)', () => {
        expect(stepToPhotoTypes(12)).toEqual([]);
      });
    });

    describe('TC1.4: Invalid Step Handling', () => {
      it('should return empty array for step 0 (below range)', () => {
        expect(stepToPhotoTypes(0)).toEqual([]);
      });

      it('should return empty array for step 13 (above range)', () => {
        expect(stepToPhotoTypes(13)).toEqual([]);
      });

      it('should return empty array for negative step', () => {
        expect(stepToPhotoTypes(-1)).toEqual([]);
      });

      it('should return empty array for invalid step 999', () => {
        expect(stepToPhotoTypes(999)).toEqual([]);
      });

      it('should return empty array for null input', () => {
        expect(stepToPhotoTypes(null as any)).toEqual([]);
      });

      it('should return empty array for undefined input', () => {
        expect(stepToPhotoTypes(undefined as any)).toEqual([]);
      });
    });
  });

  describe('TC1.5: Bidirectional Consistency', () => {
    it('should maintain consistency when mapping ph_prop forward and backward', () => {
      const photoType = 'ph_prop';
      const step = photoTypeToStep(photoType);
      expect(step).toBe(1);

      const photoTypes = stepToPhotoTypes(step!);
      expect(photoTypes).toContain(photoType);
    });

    it('should maintain consistency when mapping ph_powm forward and backward', () => {
      const photoType = 'ph_powm';
      const step = photoTypeToStep(photoType);
      expect(step).toBe(7);

      const photoTypes = stepToPhotoTypes(step!);
      expect(photoTypes).toContain(photoType);
    });

    it('should maintain consistency when mapping ph_lights forward and backward', () => {
      const photoType = 'ph_lights';
      const step = photoTypeToStep(photoType);
      expect(step).toBe(11);

      const photoTypes = stepToPhotoTypes(step!);
      expect(photoTypes).toContain(photoType);
    });

    it('should maintain consistency for all photo types', () => {
      // Get all photo types from the mapping constant
      const allPhotoTypes = Object.keys(PHOTO_TYPE_TO_STEP);

      allPhotoTypes.forEach(photoType => {
        const step = photoTypeToStep(photoType);
        expect(step).not.toBeNull();

        const photoTypes = stepToPhotoTypes(step!);
        expect(photoTypes).toContain(photoType);
      });
    });

    it('should have no orphaned mappings', () => {
      // Verify every photo type in PHOTO_TYPE_TO_STEP has a reverse mapping
      Object.entries(PHOTO_TYPE_TO_STEP).forEach(([photoType, step]) => {
        const reversePhotoTypes = stepToPhotoTypes(step);
        expect(reversePhotoTypes).toContain(photoType);
      });
    });

    it('should have symmetrical relationship', () => {
      // Verify every step in STEP_TO_PHOTO_TYPES maps back correctly
      Object.entries(STEP_TO_PHOTO_TYPES).forEach(([stepStr, photoTypes]) => {
        const step = parseInt(stepStr);
        photoTypes.forEach(photoType => {
          const mappedStep = photoTypeToStep(photoType);
          expect(mappedStep).toBe(step);
        });
      });
    });
  });

  describe('Mapping Constants Export', () => {
    it('should export PHOTO_TYPE_TO_STEP constant', () => {
      expect(PHOTO_TYPE_TO_STEP).toBeDefined();
      expect(typeof PHOTO_TYPE_TO_STEP).toBe('object');
    });

    it('should export STEP_TO_PHOTO_TYPES constant', () => {
      expect(STEP_TO_PHOTO_TYPES).toBeDefined();
      expect(typeof STEP_TO_PHOTO_TYPES).toBe('object');
    });

    it('should have 20 photo type mappings', () => {
      expect(Object.keys(PHOTO_TYPE_TO_STEP)).toHaveLength(20);
    });

    it('should have 12 step mappings', () => {
      expect(Object.keys(STEP_TO_PHOTO_TYPES)).toHaveLength(12);
    });
  });
});
