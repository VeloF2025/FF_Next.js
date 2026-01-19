/**
 * QA Readiness Service Tests
 * ⚪ UNTESTED: Tests written FIRST following TDD methodology
 *
 * Tests the QA readiness service that:
 * - Runs readiness checks and records results
 * - Updates ticket.qa_ready flag
 * - Provides readiness status and history
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as qaReadinessService from '../../services/qaReadinessService';
import * as db from '../../utils/db';
import * as validator from '../../utils/qaReadinessValidator';
import type { QAReadinessCheck } from '../../types/verification';

// Mock dependencies
vi.mock('../../utils/db');
vi.mock('../../utils/qaReadinessValidator');
vi.mock('@/lib/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  }),
}));

describe('QAReadinessService', () => {
  const mockTicketId = '123e4567-e89b-12d3-a456-426614174000';
  const mockCheckerId = '987fcdeb-51a2-43d7-b123-456789abcdef';
  const mockCheckId = '111e2222-e89b-12d3-a456-426614174000';

  beforeEach(() => {
    // Clear all mocks before each test
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('runReadinessCheck', () => {
    it('should run readiness check and insert record when all checks pass', async () => {
      // Arrange - Mock ticket data
      const mockTicket = {
        id: mockTicketId,
        ticket_uid: 'FT123456',
        dr_number: 'DR-001',
        pole_number: 'POLE-123',
        pon_number: 'PON-456',
        zone_id: 'zone-789',
        ont_serial: 'ONT-ABC123',
        ont_rx_level: -18.5,
      };

      const mockPhotoCount = 5;

      // Mock ticket lookup
      vi.mocked(db.queryOne).mockResolvedValueOnce(mockTicket);

      // Mock photo count query
      vi.mocked(db.queryOne).mockResolvedValueOnce({ count: mockPhotoCount });

      // Mock validation result (all pass)
      const mockValidationResult = {
        ticket_id: mockTicketId,
        passed: true,
        photos_exist: true,
        photos_count: 5,
        photos_required_count: 3,
        dr_populated: true,
        pole_populated: true,
        pon_populated: true,
        zone_populated: true,
        ont_serial_recorded: true,
        ont_rx_recorded: true,
        platforms_aligned: true,
        failed_checks: [],
      };

      vi.mocked(validator.validateQAReadiness).mockReturnValue(mockValidationResult);

      // Mock INSERT qa_readiness_checks
      const mockCheckRecord = {
        id: mockCheckId,
        ticket_id: mockTicketId,
        passed: true,
        checked_at: new Date(),
        checked_by: mockCheckerId,
        ...mockValidationResult,
        created_at: new Date(),
      };

      vi.mocked(db.queryOne).mockResolvedValueOnce(mockCheckRecord);

      // Mock UPDATE tickets
      vi.mocked(db.query).mockResolvedValueOnce({ rows: [], rowCount: 1 });

      // Act
      const result = await qaReadinessService.runReadinessCheck(mockTicketId, mockCheckerId);

      // Assert
      expect(result.passed).toBe(true);
      expect(result.ticket_id).toBe(mockTicketId);
      expect(result.failed_checks).toEqual([]);

      // Verify INSERT was called for qa_readiness_checks
      expect(db.queryOne).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO qa_readiness_checks'),
        expect.arrayContaining([
          mockTicketId,
          true, // passed
          mockCheckerId,
          true, // photos_exist
          5, // photos_count
          3, // photos_required_count
          true, // dr_populated
          true, // pole_populated
          true, // pon_populated
          true, // zone_populated
          true, // ont_serial_recorded
          true, // ont_rx_recorded
          true, // platforms_aligned
          expect.any(String), // failed_checks JSON
        ])
      );

      // Verify UPDATE was called for tickets.qa_ready
      const updateCall = vi.mocked(db.query).mock.calls[0];
      expect(updateCall[0]).toContain('UPDATE tickets');
      expect(updateCall[0]).toContain('qa_ready = $1');
      expect(updateCall[0]).toContain('qa_readiness_check_at = NOW()');
      expect(updateCall[1]).toEqual([true, mockTicketId]);
    });

    it('should run readiness check and insert record when checks fail', async () => {
      // Arrange - Mock ticket with missing data
      const mockTicket = {
        id: mockTicketId,
        ticket_uid: 'FT123456',
        dr_number: null,
        pole_number: null,
        pon_number: 'PON-456',
        zone_id: null,
        ont_serial: null,
        ont_rx_level: null,
      };

      const mockPhotoCount = 1;

      vi.mocked(db.queryOne).mockResolvedValueOnce(mockTicket);
      vi.mocked(db.queryOne).mockResolvedValueOnce({ count: mockPhotoCount });

      // Mock validation result (fails)
      const mockValidationResult = {
        ticket_id: mockTicketId,
        passed: false,
        photos_exist: false,
        photos_count: 1,
        photos_required_count: 3,
        dr_populated: false,
        pole_populated: false,
        pon_populated: true,
        zone_populated: false,
        ont_serial_recorded: false,
        ont_rx_recorded: false,
        platforms_aligned: true,
        failed_checks: [
          { check_name: 'photos_exist', reason: 'Insufficient photos uploaded', expected: 3, actual: 1 },
          { check_name: 'dr_populated', reason: 'DR number is required', expected: 'Non-empty string', actual: null },
          { check_name: 'pole_populated', reason: 'Pole number is required', expected: 'Non-empty string', actual: null },
        ],
      };

      vi.mocked(validator.validateQAReadiness).mockReturnValue(mockValidationResult);

      const mockCheckRecord = {
        id: mockCheckId,
        ticket_id: mockTicketId,
        passed: false,
        checked_at: new Date(),
        checked_by: null,
        ...mockValidationResult,
        created_at: new Date(),
      };

      vi.mocked(db.queryOne).mockResolvedValueOnce(mockCheckRecord);
      vi.mocked(db.query).mockResolvedValueOnce({ rows: [], rowCount: 1 });

      // Act
      const result = await qaReadinessService.runReadinessCheck(mockTicketId);

      // Assert
      expect(result.passed).toBe(false);
      expect(result.failed_checks).toHaveLength(3);
      expect(result.failed_checks[0].check_name).toBe('photos_exist');

      // Verify UPDATE was called with qa_ready = false
      const updateCall = vi.mocked(db.query).mock.calls[0];
      expect(updateCall[0]).toContain('UPDATE tickets');
      expect(updateCall[0]).toContain('qa_ready = $1');
      expect(updateCall[1]).toEqual([false, mockTicketId]);
    });

    it('should use system check when checked_by is not provided', async () => {
      // Arrange
      const mockTicket = {
        id: mockTicketId,
        ticket_uid: 'FT123456',
        dr_number: 'DR-001',
        pole_number: 'POLE-123',
        pon_number: 'PON-456',
        zone_id: 'zone-789',
        ont_serial: 'ONT-ABC123',
        ont_rx_level: -18.5,
      };

      vi.mocked(db.queryOne).mockResolvedValueOnce(mockTicket);
      vi.mocked(db.queryOne).mockResolvedValueOnce({ count: 5 });

      const mockValidationResult = {
        ticket_id: mockTicketId,
        passed: true,
        photos_exist: true,
        photos_count: 5,
        photos_required_count: 3,
        dr_populated: true,
        pole_populated: true,
        pon_populated: true,
        zone_populated: true,
        ont_serial_recorded: true,
        ont_rx_recorded: true,
        platforms_aligned: true,
        failed_checks: [],
      };

      vi.mocked(validator.validateQAReadiness).mockReturnValue(mockValidationResult);

      const mockCheckRecord = {
        id: mockCheckId,
        ticket_id: mockTicketId,
        passed: true,
        checked_at: new Date(),
        checked_by: null, // System check
        ...mockValidationResult,
        created_at: new Date(),
      };

      vi.mocked(db.queryOne).mockResolvedValueOnce(mockCheckRecord);
      vi.mocked(db.query).mockResolvedValueOnce({ rows: [], rowCount: 1 });

      // Act
      const result = await qaReadinessService.runReadinessCheck(mockTicketId);

      // Assert
      expect(result.checked_by).toBeNull();

      // Verify INSERT was called with null for checked_by
      expect(db.queryOne).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO qa_readiness_checks'),
        expect.arrayContaining([mockTicketId, true, null])
      );
    });

    it('should throw error when ticket not found', async () => {
      // Arrange
      vi.mocked(db.queryOne).mockResolvedValueOnce(null);

      // Act & Assert
      await expect(
        qaReadinessService.runReadinessCheck(mockTicketId)
      ).rejects.toThrow('Ticket not found');
    });

    it('should throw error on invalid ticket ID format', async () => {
      // Act & Assert
      await expect(
        qaReadinessService.runReadinessCheck('invalid-uuid')
      ).rejects.toThrow('Invalid ticket ID format');
    });

    it('should update ticket.qa_readiness_check_at timestamp', async () => {
      // Arrange
      const mockTicket = {
        id: mockTicketId,
        ticket_uid: 'FT123456',
        dr_number: 'DR-001',
        pole_number: 'POLE-123',
        pon_number: 'PON-456',
        zone_id: 'zone-789',
        ont_serial: 'ONT-ABC123',
        ont_rx_level: -18.5,
      };

      vi.mocked(db.queryOne).mockResolvedValueOnce(mockTicket);
      vi.mocked(db.queryOne).mockResolvedValueOnce({ count: 5 });

      const mockValidationResult = {
        ticket_id: mockTicketId,
        passed: true,
        photos_exist: true,
        photos_count: 5,
        photos_required_count: 3,
        dr_populated: true,
        pole_populated: true,
        pon_populated: true,
        zone_populated: true,
        ont_serial_recorded: true,
        ont_rx_recorded: true,
        platforms_aligned: true,
        failed_checks: [],
      };

      vi.mocked(validator.validateQAReadiness).mockReturnValue(mockValidationResult);

      const mockCheckRecord = {
        id: mockCheckId,
        ticket_id: mockTicketId,
        passed: true,
        checked_at: new Date(),
        checked_by: null,
        ...mockValidationResult,
        created_at: new Date(),
      };

      vi.mocked(db.queryOne).mockResolvedValueOnce(mockCheckRecord);
      vi.mocked(db.query).mockResolvedValueOnce({ rows: [], rowCount: 1 });

      // Act
      await qaReadinessService.runReadinessCheck(mockTicketId);

      // Assert - Verify UPDATE includes qa_readiness_check_at
      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining('qa_readiness_check_at = NOW()'),
        expect.any(Array)
      );
    });
  });

  describe('getReadinessStatus', () => {
    it('should return readiness status with latest check', async () => {
      // Arrange
      const mockLatestCheck = {
        id: mockCheckId,
        ticket_id: mockTicketId,
        passed: true,
        checked_at: new Date('2024-01-15T10:00:00Z'),
        checked_by: mockCheckerId,
        photos_exist: true,
        photos_count: 5,
        photos_required_count: 3,
        dr_populated: true,
        pole_populated: true,
        pon_populated: true,
        zone_populated: true,
        ont_serial_recorded: true,
        ont_rx_recorded: true,
        platforms_aligned: true,
        failed_checks: null,
        created_at: new Date('2024-01-15T10:00:00Z'),
      };

      vi.mocked(db.queryOne).mockResolvedValueOnce(mockLatestCheck);

      // Act
      const result = await qaReadinessService.getReadinessStatus(mockTicketId);

      // Assert
      expect(result.ticket_id).toBe(mockTicketId);
      expect(result.is_ready).toBe(true);
      expect(result.last_check).toEqual(mockLatestCheck);
      expect(result.last_check_at).toEqual(mockLatestCheck.checked_at);
      expect(result.failed_reasons).toBeNull();
      expect(result.next_action).toBe('Ticket is ready for QA');

      // Verify SELECT query
      expect(db.queryOne).toHaveBeenCalledWith(
        expect.stringContaining('SELECT * FROM qa_readiness_checks'),
        [mockTicketId]
      );
    });

    it('should return readiness status when not ready', async () => {
      // Arrange
      const mockLatestCheck = {
        id: mockCheckId,
        ticket_id: mockTicketId,
        passed: false,
        checked_at: new Date('2024-01-15T10:00:00Z'),
        checked_by: null,
        photos_exist: false,
        photos_count: 1,
        photos_required_count: 3,
        dr_populated: false,
        pole_populated: true,
        pon_populated: true,
        zone_populated: true,
        ont_serial_recorded: true,
        ont_rx_recorded: true,
        platforms_aligned: true,
        failed_checks: [
          { check_name: 'photos_exist', reason: 'Insufficient photos uploaded' },
          { check_name: 'dr_populated', reason: 'DR number is required' },
        ],
        created_at: new Date('2024-01-15T10:00:00Z'),
      };

      vi.mocked(db.queryOne).mockResolvedValueOnce(mockLatestCheck);

      // Act
      const result = await qaReadinessService.getReadinessStatus(mockTicketId);

      // Assert
      expect(result.is_ready).toBe(false);
      expect(result.failed_reasons).toHaveLength(2);
      expect(result.failed_reasons).toContain('Insufficient photos uploaded');
      expect(result.failed_reasons).toContain('DR number is required');
      expect(result.next_action).toBe('Fix failed checks before QA');
    });

    it('should return status when no checks have been run', async () => {
      // Arrange
      vi.mocked(db.queryOne).mockResolvedValueOnce(null);

      // Act
      const result = await qaReadinessService.getReadinessStatus(mockTicketId);

      // Assert
      expect(result.ticket_id).toBe(mockTicketId);
      expect(result.is_ready).toBe(false);
      expect(result.last_check).toBeNull();
      expect(result.last_check_at).toBeNull();
      expect(result.failed_reasons).toBeNull();
      expect(result.next_action).toBe('Run readiness check first');
    });

    it('should throw error on invalid ticket ID format', async () => {
      // Act & Assert
      await expect(
        qaReadinessService.getReadinessStatus('invalid-uuid')
      ).rejects.toThrow('Invalid ticket ID format');
    });
  });

  describe('getReadinessHistory', () => {
    it('should return all readiness checks for a ticket ordered by date', async () => {
      // Arrange - Mock checks ordered by checked_at DESC (newest first)
      const mockChecks = [
        {
          id: '222e2222-e89b-12d3-a456-426614174000',
          ticket_id: mockTicketId,
          passed: true,
          checked_at: new Date('2024-01-15T10:00:00Z'),
          checked_by: mockCheckerId,
          photos_exist: true,
          photos_count: 5,
          photos_required_count: 3,
          dr_populated: true,
          pole_populated: true,
          pon_populated: true,
          zone_populated: true,
          ont_serial_recorded: true,
          ont_rx_recorded: true,
          platforms_aligned: true,
          failed_checks: null,
          created_at: new Date('2024-01-15T10:00:00Z'),
        },
        {
          id: '111e1111-e89b-12d3-a456-426614174000',
          ticket_id: mockTicketId,
          passed: false,
          checked_at: new Date('2024-01-10T09:00:00Z'),
          checked_by: null,
          photos_exist: false,
          photos_count: 0,
          photos_required_count: 3,
          dr_populated: true,
          pole_populated: true,
          pon_populated: true,
          zone_populated: true,
          ont_serial_recorded: true,
          ont_rx_recorded: true,
          platforms_aligned: true,
          failed_checks: [{ check_name: 'photos_exist', reason: 'No photos uploaded' }],
          created_at: new Date('2024-01-10T09:00:00Z'),
        },
      ];

      vi.mocked(db.query).mockResolvedValueOnce(mockChecks);

      // Act
      const result = await qaReadinessService.getReadinessHistory(mockTicketId);

      // Assert
      expect(result).toHaveLength(2);
      expect(result[0].checked_at).toEqual(new Date('2024-01-15T10:00:00Z')); // Most recent first
      expect(result[1].checked_at).toEqual(new Date('2024-01-10T09:00:00Z'));

      // Verify SELECT query
      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining('SELECT * FROM qa_readiness_checks'),
        [mockTicketId]
      );
      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining('ORDER BY checked_at DESC'),
        expect.any(Array)
      );
    });

    it('should return empty array when no checks exist', async () => {
      // Arrange
      vi.mocked(db.query).mockResolvedValueOnce([]);

      // Act
      const result = await qaReadinessService.getReadinessHistory(mockTicketId);

      // Assert
      expect(result).toEqual([]);
    });

    it('should throw error on invalid ticket ID format', async () => {
      // Act & Assert
      await expect(
        qaReadinessService.getReadinessHistory('invalid-uuid')
      ).rejects.toThrow('Invalid ticket ID format');
    });
  });

  describe('canStartQA', () => {
    it('should return true when ticket is QA ready', async () => {
      // Arrange
      const mockLatestCheck = {
        id: mockCheckId,
        ticket_id: mockTicketId,
        passed: true,
        checked_at: new Date(),
        checked_by: null,
        photos_exist: true,
        photos_count: 5,
        photos_required_count: 3,
        dr_populated: true,
        pole_populated: true,
        pon_populated: true,
        zone_populated: true,
        ont_serial_recorded: true,
        ont_rx_recorded: true,
        platforms_aligned: true,
        failed_checks: null,
        created_at: new Date(),
      };

      vi.mocked(db.queryOne).mockResolvedValueOnce(mockLatestCheck);

      // Act
      const result = await qaReadinessService.canStartQA(mockTicketId);

      // Assert
      expect(result).toBe(true);
    });

    it('should return false when ticket is not QA ready', async () => {
      // Arrange
      const mockLatestCheck = {
        id: mockCheckId,
        ticket_id: mockTicketId,
        passed: false,
        checked_at: new Date(),
        checked_by: null,
        photos_exist: false,
        photos_count: 1,
        photos_required_count: 3,
        dr_populated: true,
        pole_populated: true,
        pon_populated: true,
        zone_populated: true,
        ont_serial_recorded: true,
        ont_rx_recorded: true,
        platforms_aligned: true,
        failed_checks: [{ check_name: 'photos_exist', reason: 'Insufficient photos' }],
        created_at: new Date(),
      };

      vi.mocked(db.queryOne).mockResolvedValueOnce(mockLatestCheck);

      // Act
      const result = await qaReadinessService.canStartQA(mockTicketId);

      // Assert
      expect(result).toBe(false);
    });

    it('should return false when no checks have been run', async () => {
      // Arrange
      vi.mocked(db.queryOne).mockResolvedValueOnce(null);

      // Act
      const result = await qaReadinessService.canStartQA(mockTicketId);

      // Assert
      expect(result).toBe(false);
    });
  });
});
