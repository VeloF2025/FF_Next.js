/**
 * QA Readiness Validator Tests - TDD
 * 🟢 WORKING: Comprehensive tests for QA readiness validation utility
 *
 * Tests WRITTEN FIRST following TDD methodology.
 * These tests validate all 9 QA readiness checks before ticket can enter QA.
 */

import { describe, it, expect } from 'vitest';
import { validateQAReadiness, type QAReadinessValidationInput } from '../../utils/qaReadinessValidator';
import type { QAReadinessFailedCheck } from '../../types/verification';

describe('QA Readiness Validator (TDD)', () => {
  /**
   * Helper function to create mock ticket data
   */
  const createMockTicket = (overrides: Partial<QAReadinessValidationInput> = {}): QAReadinessValidationInput => ({
    ticket_id: 'test-ticket-123',
    photos_count: 5,
    photos_required_count: 5,
    dr_number: 'DR-12345',
    pole_number: 'POLE-001',
    pon_number: 'PON-123',
    zone_id: 'zone-uuid-123',
    ont_serial: 'ONT-SERIAL-12345',
    ont_rx_level: -18.5,
    platforms_data: {
      sp_dr_number: 'DR-12345',
      sp_pole_number: 'POLE-001',
      sp_pon_number: 'PON-123',
      sow_dr_number: 'DR-12345',
      sow_pole_number: 'POLE-001',
      tracker_dr_number: 'DR-12345',
    },
    ...overrides,
  });

  describe('Photo Validation', () => {
    it('should pass when photo count equals required count', () => {
      const input = createMockTicket({
        photos_count: 5,
        photos_required_count: 5,
      });

      const result = validateQAReadiness(input);

      expect(result.photos_exist).toBe(true);
      expect(result.passed).toBe(true);
      expect(result.failed_checks).not.toContainEqual(
        expect.objectContaining({ check_name: 'photos_exist' })
      );
    });

    it('should pass when photo count exceeds required count', () => {
      const input = createMockTicket({
        photos_count: 8,
        photos_required_count: 5,
      });

      const result = validateQAReadiness(input);

      expect(result.photos_exist).toBe(true);
      expect(result.passed).toBe(true);
    });

    it('should fail when photo count is less than required count', () => {
      const input = createMockTicket({
        photos_count: 3,
        photos_required_count: 5,
      });

      const result = validateQAReadiness(input);

      expect(result.photos_exist).toBe(false);
      expect(result.passed).toBe(false);
      expect(result.failed_checks).toContainEqual({
        check_name: 'photos_exist',
        reason: 'Insufficient photos uploaded',
        expected: 5,
        actual: 3,
      });
    });

    it('should fail when no photos uploaded but required', () => {
      const input = createMockTicket({
        photos_count: 0,
        photos_required_count: 5,
      });

      const result = validateQAReadiness(input);

      expect(result.photos_exist).toBe(false);
      expect(result.passed).toBe(false);
      expect(result.failed_checks).toContainEqual({
        check_name: 'photos_exist',
        reason: 'Insufficient photos uploaded',
        expected: 5,
        actual: 0,
      });
    });

    it('should pass when no photos required and none uploaded', () => {
      const input = createMockTicket({
        photos_count: 0,
        photos_required_count: 0,
      });

      const result = validateQAReadiness(input);

      expect(result.photos_exist).toBe(true);
      expect(result.passed).toBe(true);
    });
  });

  describe('DR Number Validation', () => {
    it('should pass when DR number is populated', () => {
      const input = createMockTicket({
        dr_number: 'DR-12345',
      });

      const result = validateQAReadiness(input);

      expect(result.dr_populated).toBe(true);
      expect(result.failed_checks).not.toContainEqual(
        expect.objectContaining({ check_name: 'dr_populated' })
      );
    });

    it('should fail when DR number is null', () => {
      const input = createMockTicket({
        dr_number: null,
      });

      const result = validateQAReadiness(input);

      expect(result.dr_populated).toBe(false);
      expect(result.passed).toBe(false);
      expect(result.failed_checks).toContainEqual({
        check_name: 'dr_populated',
        reason: 'DR number is required',
        expected: 'Non-empty string',
        actual: null,
      });
    });

    it('should fail when DR number is empty string', () => {
      const input = createMockTicket({
        dr_number: '',
      });

      const result = validateQAReadiness(input);

      expect(result.dr_populated).toBe(false);
      expect(result.passed).toBe(false);
    });

    it('should fail when DR number is whitespace only', () => {
      const input = createMockTicket({
        dr_number: '   ',
      });

      const result = validateQAReadiness(input);

      expect(result.dr_populated).toBe(false);
      expect(result.passed).toBe(false);
    });
  });

  describe('Pole Number Validation', () => {
    it('should pass when pole number is populated', () => {
      const input = createMockTicket({
        pole_number: 'POLE-001',
      });

      const result = validateQAReadiness(input);

      expect(result.pole_populated).toBe(true);
      expect(result.failed_checks).not.toContainEqual(
        expect.objectContaining({ check_name: 'pole_populated' })
      );
    });

    it('should fail when pole number is null', () => {
      const input = createMockTicket({
        pole_number: null,
      });

      const result = validateQAReadiness(input);

      expect(result.pole_populated).toBe(false);
      expect(result.passed).toBe(false);
      expect(result.failed_checks).toContainEqual({
        check_name: 'pole_populated',
        reason: 'Pole number is required',
        expected: 'Non-empty string',
        actual: null,
      });
    });

    it('should fail when pole number is empty string', () => {
      const input = createMockTicket({
        pole_number: '',
      });

      const result = validateQAReadiness(input);

      expect(result.pole_populated).toBe(false);
      expect(result.passed).toBe(false);
    });
  });

  describe('PON Number Validation', () => {
    it('should pass when PON number is populated', () => {
      const input = createMockTicket({
        pon_number: 'PON-123',
      });

      const result = validateQAReadiness(input);

      expect(result.pon_populated).toBe(true);
      expect(result.failed_checks).not.toContainEqual(
        expect.objectContaining({ check_name: 'pon_populated' })
      );
    });

    it('should fail when PON number is null', () => {
      const input = createMockTicket({
        pon_number: null,
      });

      const result = validateQAReadiness(input);

      expect(result.pon_populated).toBe(false);
      expect(result.passed).toBe(false);
      expect(result.failed_checks).toContainEqual({
        check_name: 'pon_populated',
        reason: 'PON number is required',
        expected: 'Non-empty string',
        actual: null,
      });
    });

    it('should fail when PON number is empty string', () => {
      const input = createMockTicket({
        pon_number: '',
      });

      const result = validateQAReadiness(input);

      expect(result.pon_populated).toBe(false);
      expect(result.passed).toBe(false);
    });
  });

  describe('Zone Validation', () => {
    it('should pass when zone ID is populated', () => {
      const input = createMockTicket({
        zone_id: 'zone-uuid-123',
      });

      const result = validateQAReadiness(input);

      expect(result.zone_populated).toBe(true);
      expect(result.failed_checks).not.toContainEqual(
        expect.objectContaining({ check_name: 'zone_populated' })
      );
    });

    it('should fail when zone ID is null', () => {
      const input = createMockTicket({
        zone_id: null,
      });

      const result = validateQAReadiness(input);

      expect(result.zone_populated).toBe(false);
      expect(result.passed).toBe(false);
      expect(result.failed_checks).toContainEqual({
        check_name: 'zone_populated',
        reason: 'Zone is required',
        expected: 'Non-empty string',
        actual: null,
      });
    });

    it('should fail when zone ID is empty string', () => {
      const input = createMockTicket({
        zone_id: '',
      });

      const result = validateQAReadiness(input);

      expect(result.zone_populated).toBe(false);
      expect(result.passed).toBe(false);
    });
  });

  describe('ONT Serial Validation', () => {
    it('should pass when ONT serial is populated', () => {
      const input = createMockTicket({
        ont_serial: 'ONT-SERIAL-12345',
      });

      const result = validateQAReadiness(input);

      expect(result.ont_serial_recorded).toBe(true);
      expect(result.failed_checks).not.toContainEqual(
        expect.objectContaining({ check_name: 'ont_serial_recorded' })
      );
    });

    it('should fail when ONT serial is null', () => {
      const input = createMockTicket({
        ont_serial: null,
      });

      const result = validateQAReadiness(input);

      expect(result.ont_serial_recorded).toBe(false);
      expect(result.passed).toBe(false);
      expect(result.failed_checks).toContainEqual({
        check_name: 'ont_serial_recorded',
        reason: 'ONT serial number is required',
        expected: 'Non-empty string',
        actual: null,
      });
    });

    it('should fail when ONT serial is empty string', () => {
      const input = createMockTicket({
        ont_serial: '',
      });

      const result = validateQAReadiness(input);

      expect(result.ont_serial_recorded).toBe(false);
      expect(result.passed).toBe(false);
    });
  });

  describe('ONT RX Level Validation', () => {
    it('should pass when ONT RX level is a valid number', () => {
      const input = createMockTicket({
        ont_rx_level: -18.5,
      });

      const result = validateQAReadiness(input);

      expect(result.ont_rx_recorded).toBe(true);
      expect(result.failed_checks).not.toContainEqual(
        expect.objectContaining({ check_name: 'ont_rx_recorded' })
      );
    });

    it('should pass when ONT RX level is zero', () => {
      const input = createMockTicket({
        ont_rx_level: 0,
      });

      const result = validateQAReadiness(input);

      expect(result.ont_rx_recorded).toBe(true);
    });

    it('should pass when ONT RX level is negative', () => {
      const input = createMockTicket({
        ont_rx_level: -25.3,
      });

      const result = validateQAReadiness(input);

      expect(result.ont_rx_recorded).toBe(true);
    });

    it('should fail when ONT RX level is null', () => {
      const input = createMockTicket({
        ont_rx_level: null,
      });

      const result = validateQAReadiness(input);

      expect(result.ont_rx_recorded).toBe(false);
      expect(result.passed).toBe(false);
      expect(result.failed_checks).toContainEqual({
        check_name: 'ont_rx_recorded',
        reason: 'ONT RX power level is required',
        expected: 'Numeric value',
        actual: null,
      });
    });

    it('should fail when ONT RX level is undefined', () => {
      const input = createMockTicket({
        ont_rx_level: undefined,
      });

      const result = validateQAReadiness(input);

      expect(result.ont_rx_recorded).toBe(false);
      expect(result.passed).toBe(false);
    });
  });

  describe('Platforms Alignment Validation', () => {
    it('should pass when all platforms have matching DR, pole, and PON', () => {
      const input = createMockTicket({
        dr_number: 'DR-12345',
        pole_number: 'POLE-001',
        pon_number: 'PON-123',
        platforms_data: {
          sp_dr_number: 'DR-12345',
          sp_pole_number: 'POLE-001',
          sp_pon_number: 'PON-123',
          sow_dr_number: 'DR-12345',
          sow_pole_number: 'POLE-001',
          tracker_dr_number: 'DR-12345',
        },
      });

      const result = validateQAReadiness(input);

      expect(result.platforms_aligned).toBe(true);
      expect(result.failed_checks).not.toContainEqual(
        expect.objectContaining({ check_name: 'platforms_aligned' })
      );
    });

    it('should fail when SP DR number does not match', () => {
      const input = createMockTicket({
        dr_number: 'DR-12345',
        platforms_data: {
          sp_dr_number: 'DR-99999',
          sp_pole_number: 'POLE-001',
          sp_pon_number: 'PON-123',
          sow_dr_number: 'DR-12345',
          sow_pole_number: 'POLE-001',
          tracker_dr_number: 'DR-12345',
        },
      });

      const result = validateQAReadiness(input);

      expect(result.platforms_aligned).toBe(false);
      expect(result.passed).toBe(false);
      expect(result.failed_checks).toContainEqual(
        expect.objectContaining({
          check_name: 'platforms_aligned',
          reason: expect.stringContaining('Platform data mismatch'),
        })
      );
    });

    it('should fail when SOW DR number does not match', () => {
      const input = createMockTicket({
        dr_number: 'DR-12345',
        platforms_data: {
          sp_dr_number: 'DR-12345',
          sp_pole_number: 'POLE-001',
          sp_pon_number: 'PON-123',
          sow_dr_number: 'DR-WRONG',
          sow_pole_number: 'POLE-001',
          tracker_dr_number: 'DR-12345',
        },
      });

      const result = validateQAReadiness(input);

      expect(result.platforms_aligned).toBe(false);
      expect(result.passed).toBe(false);
    });

    it('should fail when tracker DR number does not match', () => {
      const input = createMockTicket({
        dr_number: 'DR-12345',
        platforms_data: {
          sp_dr_number: 'DR-12345',
          sp_pole_number: 'POLE-001',
          sp_pon_number: 'PON-123',
          sow_dr_number: 'DR-12345',
          sow_pole_number: 'POLE-001',
          tracker_dr_number: 'DR-MISMATCH',
        },
      });

      const result = validateQAReadiness(input);

      expect(result.platforms_aligned).toBe(false);
      expect(result.passed).toBe(false);
    });

    it('should fail when pole numbers do not match across platforms', () => {
      const input = createMockTicket({
        pole_number: 'POLE-001',
        platforms_data: {
          sp_dr_number: 'DR-12345',
          sp_pole_number: 'POLE-WRONG',
          sp_pon_number: 'PON-123',
          sow_dr_number: 'DR-12345',
          sow_pole_number: 'POLE-001',
          tracker_dr_number: 'DR-12345',
        },
      });

      const result = validateQAReadiness(input);

      expect(result.platforms_aligned).toBe(false);
      expect(result.passed).toBe(false);
    });

    it('should fail when PON numbers do not match across platforms', () => {
      const input = createMockTicket({
        pon_number: 'PON-123',
        platforms_data: {
          sp_dr_number: 'DR-12345',
          sp_pole_number: 'POLE-001',
          sp_pon_number: 'PON-WRONG',
          sow_dr_number: 'DR-12345',
          sow_pole_number: 'POLE-001',
          tracker_dr_number: 'DR-12345',
        },
      });

      const result = validateQAReadiness(input);

      expect(result.platforms_aligned).toBe(false);
      expect(result.passed).toBe(false);
    });

    it('should pass when platforms_data is not provided (optional check)', () => {
      const input = createMockTicket({
        platforms_data: undefined,
      });

      const result = validateQAReadiness(input);

      // When platforms_data is not provided, we skip alignment check
      expect(result.platforms_aligned).toBe(true);
    });

    it('should report multiple platform mismatches', () => {
      const input = createMockTicket({
        dr_number: 'DR-12345',
        pole_number: 'POLE-001',
        pon_number: 'PON-123',
        platforms_data: {
          sp_dr_number: 'DR-WRONG',
          sp_pole_number: 'POLE-WRONG',
          sp_pon_number: 'PON-WRONG',
          sow_dr_number: 'DR-12345',
          sow_pole_number: 'POLE-001',
          tracker_dr_number: 'DR-12345',
        },
      });

      const result = validateQAReadiness(input);

      expect(result.platforms_aligned).toBe(false);
      expect(result.passed).toBe(false);
      const alignmentFailure = result.failed_checks.find(
        (check) => check.check_name === 'platforms_aligned'
      );
      expect(alignmentFailure).toBeDefined();
      expect(alignmentFailure?.reason).toContain('DR');
      expect(alignmentFailure?.reason).toContain('pole');
      expect(alignmentFailure?.reason).toContain('PON');
    });
  });

  describe('Overall Validation Result', () => {
    it('should pass when all checks pass', () => {
      const input = createMockTicket(); // Mock with all valid data

      const result = validateQAReadiness(input);

      expect(result.passed).toBe(true);
      expect(result.photos_exist).toBe(true);
      expect(result.dr_populated).toBe(true);
      expect(result.pole_populated).toBe(true);
      expect(result.pon_populated).toBe(true);
      expect(result.zone_populated).toBe(true);
      expect(result.ont_serial_recorded).toBe(true);
      expect(result.ont_rx_recorded).toBe(true);
      expect(result.platforms_aligned).toBe(true);
      expect(result.failed_checks).toHaveLength(0);
    });

    it('should fail when multiple checks fail', () => {
      const input = createMockTicket({
        photos_count: 2,
        photos_required_count: 5,
        dr_number: null,
        ont_serial: '',
        ont_rx_level: null,
      });

      const result = validateQAReadiness(input);

      expect(result.passed).toBe(false);
      expect(result.photos_exist).toBe(false);
      expect(result.dr_populated).toBe(false);
      expect(result.ont_serial_recorded).toBe(false);
      expect(result.ont_rx_recorded).toBe(false);
      expect(result.failed_checks.length).toBeGreaterThanOrEqual(4);
    });

    it('should return array of all failed checks with details', () => {
      const input = createMockTicket({
        dr_number: null,
        pole_number: '',
        ont_serial: null,
      });

      const result = validateQAReadiness(input);

      expect(result.failed_checks).toHaveLength(3);
      expect(result.failed_checks).toContainEqual({
        check_name: 'dr_populated',
        reason: 'DR number is required',
        expected: 'Non-empty string',
        actual: null,
      });
      expect(result.failed_checks).toContainEqual({
        check_name: 'pole_populated',
        reason: 'Pole number is required',
        expected: 'Non-empty string',
        actual: '',
      });
      expect(result.failed_checks).toContainEqual({
        check_name: 'ont_serial_recorded',
        reason: 'ONT serial number is required',
        expected: 'Non-empty string',
        actual: null,
      });
    });

    it('should include ticket_id in result', () => {
      const input = createMockTicket({
        ticket_id: 'test-ticket-999',
      });

      const result = validateQAReadiness(input);

      expect(result.ticket_id).toBe('test-ticket-999');
    });

    it('should include counts in result', () => {
      const input = createMockTicket({
        photos_count: 3,
        photos_required_count: 5,
      });

      const result = validateQAReadiness(input);

      expect(result.photos_count).toBe(3);
      expect(result.photos_required_count).toBe(5);
    });
  });

  describe('Edge Cases', () => {
    it('should handle missing ticket_id gracefully', () => {
      const input = createMockTicket({
        ticket_id: undefined as any,
      });

      const result = validateQAReadiness(input);

      expect(result).toBeDefined();
      expect(result.ticket_id).toBeUndefined();
    });

    it('should handle negative photo counts', () => {
      const input = createMockTicket({
        photos_count: -1,
        photos_required_count: 5,
      });

      const result = validateQAReadiness(input);

      expect(result.photos_exist).toBe(false);
      expect(result.passed).toBe(false);
    });

    it('should handle very large photo counts', () => {
      const input = createMockTicket({
        photos_count: 1000,
        photos_required_count: 5,
      });

      const result = validateQAReadiness(input);

      expect(result.photos_exist).toBe(true);
    });

    it('should trim whitespace in string validations', () => {
      const input = createMockTicket({
        dr_number: '  DR-12345  ',
        pole_number: '  POLE-001  ',
        pon_number: '  PON-123  ',
        ont_serial: '  ONT-SERIAL  ',
      });

      const result = validateQAReadiness(input);

      // Should pass because trimmed values are valid
      expect(result.dr_populated).toBe(true);
      expect(result.pole_populated).toBe(true);
      expect(result.pon_populated).toBe(true);
      expect(result.ont_serial_recorded).toBe(true);
    });

    it('should handle case-insensitive platform comparisons', () => {
      const input = createMockTicket({
        dr_number: 'DR-12345',
        pole_number: 'POLE-001',
        platforms_data: {
          sp_dr_number: 'dr-12345', // lowercase
          sp_pole_number: 'pole-001', // lowercase
          sp_pon_number: 'PON-123',
          sow_dr_number: 'DR-12345',
          sow_pole_number: 'POLE-001',
          tracker_dr_number: 'DR-12345',
        },
      });

      const result = validateQAReadiness(input);

      // Should pass because values match case-insensitively
      expect(result.platforms_aligned).toBe(true);
    });
  });

  describe('Type Safety', () => {
    it('should enforce required input fields at compile time', () => {
      // This test verifies TypeScript types are correct
      const validInput: QAReadinessValidationInput = {
        ticket_id: 'test-123',
        photos_count: 5,
        photos_required_count: 5,
        dr_number: 'DR-123',
        pole_number: 'POLE-001',
        pon_number: 'PON-123',
        zone_id: 'zone-123',
        ont_serial: 'ONT-123',
        ont_rx_level: -18.5,
        platforms_data: undefined,
      };

      expect(validInput).toBeDefined();
    });

    it('should return properly typed result', () => {
      const input = createMockTicket();
      const result = validateQAReadiness(input);

      // Verify result has all expected properties with correct types
      expect(typeof result.ticket_id).toBe('string');
      expect(typeof result.passed).toBe('boolean');
      expect(typeof result.photos_exist).toBe('boolean');
      expect(typeof result.photos_count).toBe('number');
      expect(typeof result.photos_required_count).toBe('number');
      expect(typeof result.dr_populated).toBe('boolean');
      expect(typeof result.pole_populated).toBe('boolean');
      expect(typeof result.pon_populated).toBe('boolean');
      expect(typeof result.zone_populated).toBe('boolean');
      expect(typeof result.ont_serial_recorded).toBe('boolean');
      expect(typeof result.ont_rx_recorded).toBe('boolean');
      expect(typeof result.platforms_aligned).toBe('boolean');
      expect(Array.isArray(result.failed_checks)).toBe(true);
    });
  });
});
