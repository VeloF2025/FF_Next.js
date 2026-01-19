/**
 * Guarantee Service Tests - TDD
 * 🟢 WORKING: Comprehensive tests for guarantee service
 *
 * Tests WRITTEN FIRST following TDD methodology.
 * These tests validate guarantee period management and ticket classification.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as guaranteeService from '../../services/guaranteeService';
import * as db from '../../utils/db';
import * as calculator from '../../utils/guaranteeCalculator';
import { GuaranteeStatus, FaultCause } from '../../types/ticket';
import { BillingClassification } from '../../types/guarantee';
import type { GuaranteePeriod, CreateGuaranteePeriodPayload, UpdateGuaranteePeriodPayload } from '../../types/guarantee';

// Mock dependencies
vi.mock('../../utils/db');
vi.mock('../../utils/guaranteeCalculator');
vi.mock('@/lib/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  }),
}));

describe('GuaranteeService (TDD)', () => {
  const mockProjectId = '123e4567-e89b-12d3-a456-426614174000';
  const mockTicketId = '987fcdeb-51a2-43d7-b123-456789abcdef';
  const mockGuaranteePeriodId = '111e2222-e89b-12d3-a456-426614174111';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * Test: Get guarantee period for a project
   */
  describe('getGuaranteePeriodByProject', () => {
    it('should return guarantee period when it exists for project', async () => {
      // Arrange
      const mockGuaranteePeriod: GuaranteePeriod = {
        id: mockGuaranteePeriodId,
        project_id: mockProjectId,
        installation_guarantee_days: 90,
        material_guarantee_days: 365,
        contractor_liable_during_guarantee: true,
        auto_classify_out_of_guarantee: true,
        created_at: new Date('2024-01-01'),
        updated_at: new Date('2024-01-01')
      };

      vi.mocked(db.queryOne).mockResolvedValue(mockGuaranteePeriod);

      // Act
      const result = await guaranteeService.getGuaranteePeriodByProject(mockProjectId);

      // Assert
      expect(result).toEqual(mockGuaranteePeriod);
      expect(db.queryOne).toHaveBeenCalledWith(
        expect.stringContaining('SELECT * FROM guarantee_periods'),
        [mockProjectId]
      );
    });

    it('should return null when no guarantee period exists for project', async () => {
      // Arrange
      vi.mocked(db.queryOne).mockResolvedValue(null);

      // Act
      const result = await guaranteeService.getGuaranteePeriodByProject(mockProjectId);

      // Assert
      expect(result).toBeNull();
    });

    it('should throw error when project_id is invalid', async () => {
      // Arrange - Invalid UUID
      const invalidProjectId = 'not-a-uuid';

      // Act & Assert
      await expect(
        guaranteeService.getGuaranteePeriodByProject(invalidProjectId)
      ).rejects.toThrow('Invalid project_id format');
    });
  });

  /**
   * Test: Create guarantee period
   */
  describe('createGuaranteePeriod', () => {
    it('should create guarantee period with default values', async () => {
      // Arrange
      const payload: CreateGuaranteePeriodPayload = {
        project_id: mockProjectId
      };

      const mockCreatedPeriod: GuaranteePeriod = {
        id: mockGuaranteePeriodId,
        project_id: mockProjectId,
        installation_guarantee_days: 90, // Default
        material_guarantee_days: 365, // Default
        contractor_liable_during_guarantee: true, // Default
        auto_classify_out_of_guarantee: true, // Default
        created_at: new Date(),
        updated_at: new Date()
      };

      vi.mocked(db.queryOne).mockResolvedValue(mockCreatedPeriod);

      // Act
      const result = await guaranteeService.createGuaranteePeriod(payload);

      // Assert
      expect(result).toEqual(mockCreatedPeriod);
      expect(db.queryOne).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO guarantee_periods'),
        expect.arrayContaining([
          mockProjectId,
          90, // Default installation days
          365, // Default material days
          true, // Default contractor liable
          true // Default auto classify
        ])
      );
    });

    it('should create guarantee period with custom values', async () => {
      // Arrange
      const payload: CreateGuaranteePeriodPayload = {
        project_id: mockProjectId,
        installation_guarantee_days: 60,
        material_guarantee_days: 180,
        contractor_liable_during_guarantee: false,
        auto_classify_out_of_guarantee: false
      };

      const mockCreatedPeriod: GuaranteePeriod = {
        id: mockGuaranteePeriodId,
        project_id: mockProjectId,
        installation_guarantee_days: 60,
        material_guarantee_days: 180,
        contractor_liable_during_guarantee: false,
        auto_classify_out_of_guarantee: false,
        created_at: new Date(),
        updated_at: new Date()
      };

      vi.mocked(db.queryOne).mockResolvedValue(mockCreatedPeriod);

      // Act
      const result = await guaranteeService.createGuaranteePeriod(payload);

      // Assert
      expect(result).toEqual(mockCreatedPeriod);
      expect(db.queryOne).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO guarantee_periods'),
        [mockProjectId, 60, 180, false, false]
      );
    });

    it('should throw error when project_id is missing', async () => {
      // Arrange
      const payload = {} as CreateGuaranteePeriodPayload;

      // Act & Assert
      await expect(
        guaranteeService.createGuaranteePeriod(payload)
      ).rejects.toThrow('project_id is required');
    });

    it('should throw error when project already has guarantee period', async () => {
      // Arrange
      const payload: CreateGuaranteePeriodPayload = {
        project_id: mockProjectId
      };

      // Mock database constraint violation error
      const constraintError = new Error('duplicate key value violates unique constraint');
      vi.mocked(db.queryOne).mockRejectedValue(constraintError);

      // Act & Assert
      await expect(
        guaranteeService.createGuaranteePeriod(payload)
      ).rejects.toThrow();
    });
  });

  /**
   * Test: Update guarantee period
   */
  describe('updateGuaranteePeriod', () => {
    it('should update guarantee period with partial data', async () => {
      // Arrange
      const payload: UpdateGuaranteePeriodPayload = {
        installation_guarantee_days: 120
      };

      const mockUpdatedPeriod: GuaranteePeriod = {
        id: mockGuaranteePeriodId,
        project_id: mockProjectId,
        installation_guarantee_days: 120, // Updated
        material_guarantee_days: 365, // Unchanged
        contractor_liable_during_guarantee: true,
        auto_classify_out_of_guarantee: true,
        created_at: new Date('2024-01-01'),
        updated_at: new Date()
      };

      vi.mocked(db.queryOne).mockResolvedValue(mockUpdatedPeriod);

      // Act
      const result = await guaranteeService.updateGuaranteePeriod(mockProjectId, payload);

      // Assert
      expect(result).toEqual(mockUpdatedPeriod);
      expect(db.queryOne).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE guarantee_periods'),
        expect.arrayContaining([120, mockProjectId])
      );
    });

    it('should update all guarantee period fields', async () => {
      // Arrange
      const payload: UpdateGuaranteePeriodPayload = {
        installation_guarantee_days: 60,
        material_guarantee_days: 180,
        contractor_liable_during_guarantee: false,
        auto_classify_out_of_guarantee: false
      };

      const mockUpdatedPeriod: GuaranteePeriod = {
        id: mockGuaranteePeriodId,
        project_id: mockProjectId,
        installation_guarantee_days: 60,
        material_guarantee_days: 180,
        contractor_liable_during_guarantee: false,
        auto_classify_out_of_guarantee: false,
        created_at: new Date('2024-01-01'),
        updated_at: new Date()
      };

      vi.mocked(db.queryOne).mockResolvedValue(mockUpdatedPeriod);

      // Act
      const result = await guaranteeService.updateGuaranteePeriod(mockProjectId, payload);

      // Assert
      expect(result).toEqual(mockUpdatedPeriod);
      expect(db.queryOne).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE guarantee_periods'),
        expect.arrayContaining([60, 180, false, false, mockProjectId])
      );
    });

    it('should throw error when guarantee period does not exist', async () => {
      // Arrange
      const payload: UpdateGuaranteePeriodPayload = {
        installation_guarantee_days: 120
      };

      vi.mocked(db.queryOne).mockResolvedValue(null);

      // Act & Assert
      await expect(
        guaranteeService.updateGuaranteePeriod(mockProjectId, payload)
      ).rejects.toThrow('Guarantee period not found');
    });
  });

  /**
   * Test: Classify ticket guarantee status
   */
  describe('classifyTicketGuarantee', () => {
    it('should classify ticket as UNDER_GUARANTEE and update ticket', async () => {
      // Arrange
      const installationDate = new Date();
      installationDate.setDate(installationDate.getDate() - 30); // 30 days ago

      const mockTicket = {
        id: mockTicketId,
        project_id: mockProjectId,
        ticket_type: 'installation',
        fault_cause: FaultCause.WORKMANSHIP,
        created_at: installationDate
      };

      const mockGuaranteePeriod: GuaranteePeriod = {
        id: mockGuaranteePeriodId,
        project_id: mockProjectId,
        installation_guarantee_days: 90,
        material_guarantee_days: 365,
        contractor_liable_during_guarantee: true,
        auto_classify_out_of_guarantee: true,
        created_at: new Date(),
        updated_at: new Date()
      };

      const expiryDate = new Date(installationDate);
      expiryDate.setDate(expiryDate.getDate() + 90);

      const mockClassificationResult = {
        ticket_id: mockTicketId,
        status: GuaranteeStatus.UNDER_GUARANTEE,
        expires_at: expiryDate,
        days_remaining: 60,
        reason: 'Guarantee valid for 60 more days'
      };

      const mockBillingResult = {
        billing_classification: BillingClassification.CONTRACTOR_UNDER_GUARANTEE,
        is_billable: false,
        reason: 'Workmanship fault under guarantee - contractor liable'
      };

      const mockLiabilityResult = {
        is_liable: true,
        reason: 'Workmanship fault under guarantee period',
        guarantee_status: GuaranteeStatus.UNDER_GUARANTEE,
        fault_cause: FaultCause.WORKMANSHIP,
        billing_impact: 'contractor_pays' as const
      };

      // Mock database calls
      vi.mocked(db.queryOne).mockResolvedValueOnce(mockTicket); // Get ticket
      vi.mocked(db.queryOne).mockResolvedValueOnce(mockGuaranteePeriod); // Get guarantee period

      // Mock calculator calls
      vi.mocked(calculator.classifyGuaranteeStatus).mockReturnValue(mockClassificationResult);
      vi.mocked(calculator.determineBillingClassification).mockReturnValue(mockBillingResult);
      vi.mocked(calculator.assessContractorLiability).mockReturnValue(mockLiabilityResult);

      // Mock ticket update
      vi.mocked(db.query).mockResolvedValue([]);

      // Act
      const result = await guaranteeService.classifyTicketGuarantee(mockTicketId);

      // Assert
      expect(result.status).toBe(GuaranteeStatus.UNDER_GUARANTEE);
      expect(result.is_billable).toBe(false);
      expect(result.billing_classification).toBe(BillingClassification.CONTRACTOR_UNDER_GUARANTEE);
      expect(result.contractor_liable).toBe(true);

      // Verify UPDATE was called for tickets
      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE tickets'),
        expect.arrayContaining([
          GuaranteeStatus.UNDER_GUARANTEE,
          expiryDate,
          false, // is_billable
          BillingClassification.CONTRACTOR_UNDER_GUARANTEE,
          mockTicketId
        ])
      );
    });

    it('should classify ticket as OUT_OF_GUARANTEE and mark as billable', async () => {
      // Arrange
      const installationDate = new Date();
      installationDate.setDate(installationDate.getDate() - 120); // 120 days ago (past 90-day guarantee)

      const mockTicket = {
        id: mockTicketId,
        project_id: mockProjectId,
        ticket_type: 'installation',
        fault_cause: FaultCause.WORKMANSHIP,
        created_at: installationDate
      };

      const mockGuaranteePeriod: GuaranteePeriod = {
        id: mockGuaranteePeriodId,
        project_id: mockProjectId,
        installation_guarantee_days: 90,
        material_guarantee_days: 365,
        contractor_liable_during_guarantee: true,
        auto_classify_out_of_guarantee: true,
        created_at: new Date(),
        updated_at: new Date()
      };

      const expiryDate = new Date(installationDate);
      expiryDate.setDate(expiryDate.getDate() + 90);

      const mockClassificationResult = {
        ticket_id: mockTicketId,
        status: GuaranteeStatus.OUT_OF_GUARANTEE,
        expires_at: expiryDate,
        days_remaining: 0,
        reason: 'Guarantee expired 30 days ago'
      };

      const mockBillingResult = {
        billing_classification: BillingClassification.CLIENT_OUT_OF_GUARANTEE,
        is_billable: true,
        reason: 'Out of guarantee period - client liable'
      };

      const mockLiabilityResult = {
        is_liable: false,
        reason: 'Out of guarantee period - contractor not liable',
        guarantee_status: GuaranteeStatus.OUT_OF_GUARANTEE,
        fault_cause: FaultCause.WORKMANSHIP,
        billing_impact: 'client_pays' as const
      };

      // Mock database calls
      vi.mocked(db.queryOne).mockResolvedValueOnce(mockTicket);
      vi.mocked(db.queryOne).mockResolvedValueOnce(mockGuaranteePeriod);

      // Mock calculator calls
      vi.mocked(calculator.classifyGuaranteeStatus).mockReturnValue(mockClassificationResult);
      vi.mocked(calculator.determineBillingClassification).mockReturnValue(mockBillingResult);
      vi.mocked(calculator.assessContractorLiability).mockReturnValue(mockLiabilityResult);

      // Mock ticket update
      vi.mocked(db.query).mockResolvedValue([]);

      // Act
      const result = await guaranteeService.classifyTicketGuarantee(mockTicketId);

      // Assert
      expect(result.status).toBe(GuaranteeStatus.OUT_OF_GUARANTEE);
      expect(result.is_billable).toBe(true);
      expect(result.billing_classification).toBe(BillingClassification.CLIENT_OUT_OF_GUARANTEE);
      expect(result.contractor_liable).toBe(false);
    });

    it('should classify as PENDING_CLASSIFICATION when no installation date', async () => {
      // Arrange
      const mockTicket = {
        id: mockTicketId,
        project_id: mockProjectId,
        ticket_type: 'installation',
        fault_cause: FaultCause.WORKMANSHIP,
        created_at: null // No installation date
      };

      const mockGuaranteePeriod: GuaranteePeriod = {
        id: mockGuaranteePeriodId,
        project_id: mockProjectId,
        installation_guarantee_days: 90,
        material_guarantee_days: 365,
        contractor_liable_during_guarantee: true,
        auto_classify_out_of_guarantee: true,
        created_at: new Date(),
        updated_at: new Date()
      };

      const mockClassificationResult = {
        ticket_id: mockTicketId,
        status: GuaranteeStatus.PENDING_CLASSIFICATION,
        expires_at: null,
        days_remaining: null,
        reason: 'No installation date available'
      };

      const mockBillingResult = {
        billing_classification: BillingClassification.PENDING_CLASSIFICATION,
        is_billable: false,
        reason: 'Guarantee status pending classification'
      };

      const mockLiabilityResult = {
        is_liable: false,
        reason: 'Guarantee status pending classification',
        guarantee_status: GuaranteeStatus.PENDING_CLASSIFICATION,
        fault_cause: FaultCause.WORKMANSHIP,
        billing_impact: 'pending' as const
      };

      // Mock database calls
      vi.mocked(db.queryOne).mockResolvedValueOnce(mockTicket);
      vi.mocked(db.queryOne).mockResolvedValueOnce(mockGuaranteePeriod);

      // Mock calculator calls
      vi.mocked(calculator.classifyGuaranteeStatus).mockReturnValue(mockClassificationResult);
      vi.mocked(calculator.determineBillingClassification).mockReturnValue(mockBillingResult);
      vi.mocked(calculator.assessContractorLiability).mockReturnValue(mockLiabilityResult);

      // Mock ticket update
      vi.mocked(db.query).mockResolvedValue([]);

      // Act
      const result = await guaranteeService.classifyTicketGuarantee(mockTicketId);

      // Assert
      expect(result.status).toBe(GuaranteeStatus.PENDING_CLASSIFICATION);
      expect(result.is_billable).toBe(false);
      expect(result.billing_classification).toBe(BillingClassification.PENDING_CLASSIFICATION);
    });

    it('should throw error when ticket not found', async () => {
      // Arrange
      vi.mocked(db.queryOne).mockResolvedValue(null);

      // Act & Assert
      await expect(
        guaranteeService.classifyTicketGuarantee(mockTicketId)
      ).rejects.toThrow('Ticket not found');
    });

    it('should throw error when guarantee period not found for project', async () => {
      // Arrange
      const mockTicket = {
        id: mockTicketId,
        project_id: mockProjectId,
        ticket_type: 'installation',
        fault_cause: FaultCause.WORKMANSHIP,
        created_at: new Date()
      };

      vi.mocked(db.queryOne).mockResolvedValueOnce(mockTicket);
      vi.mocked(db.queryOne).mockResolvedValueOnce(null); // No guarantee period

      // Act & Assert
      await expect(
        guaranteeService.classifyTicketGuarantee(mockTicketId)
      ).rejects.toThrow('Guarantee period not configured for project');
    });

    it('should handle CLIENT_DAMAGE fault cause correctly', async () => {
      // Arrange
      const installationDate = new Date();
      installationDate.setDate(installationDate.getDate() - 30);

      const mockTicket = {
        id: mockTicketId,
        project_id: mockProjectId,
        ticket_type: 'installation',
        fault_cause: FaultCause.CLIENT_DAMAGE, // Client damage
        created_at: installationDate
      };

      const mockGuaranteePeriod: GuaranteePeriod = {
        id: mockGuaranteePeriodId,
        project_id: mockProjectId,
        installation_guarantee_days: 90,
        material_guarantee_days: 365,
        contractor_liable_during_guarantee: true,
        auto_classify_out_of_guarantee: true,
        created_at: new Date(),
        updated_at: new Date()
      };

      const expiryDate = new Date(installationDate);
      expiryDate.setDate(expiryDate.getDate() + 90);

      const mockClassificationResult = {
        ticket_id: mockTicketId,
        status: GuaranteeStatus.UNDER_GUARANTEE,
        expires_at: expiryDate,
        days_remaining: 60,
        reason: 'Guarantee valid for 60 more days'
      };

      const mockBillingResult = {
        billing_classification: BillingClassification.CLIENT_DAMAGE,
        is_billable: true, // Billable even under guarantee
        reason: 'Client caused damage - client liable'
      };

      const mockLiabilityResult = {
        is_liable: false,
        reason: 'Client damage - client liable',
        guarantee_status: GuaranteeStatus.UNDER_GUARANTEE,
        fault_cause: FaultCause.CLIENT_DAMAGE,
        billing_impact: 'client_pays' as const
      };

      // Mock database calls
      vi.mocked(db.queryOne).mockResolvedValueOnce(mockTicket);
      vi.mocked(db.queryOne).mockResolvedValueOnce(mockGuaranteePeriod);

      // Mock calculator calls
      vi.mocked(calculator.classifyGuaranteeStatus).mockReturnValue(mockClassificationResult);
      vi.mocked(calculator.determineBillingClassification).mockReturnValue(mockBillingResult);
      vi.mocked(calculator.assessContractorLiability).mockReturnValue(mockLiabilityResult);

      // Mock ticket update
      vi.mocked(db.query).mockResolvedValue([]);

      // Act
      const result = await guaranteeService.classifyTicketGuarantee(mockTicketId);

      // Assert
      expect(result.status).toBe(GuaranteeStatus.UNDER_GUARANTEE);
      expect(result.is_billable).toBe(true); // Billable to client
      expect(result.billing_classification).toBe(BillingClassification.CLIENT_DAMAGE);
      expect(result.contractor_liable).toBe(false);
    });
  });

  /**
   * Test: Get or create default guarantee period
   */
  describe('getOrCreateDefaultGuaranteePeriod', () => {
    it('should return existing guarantee period if it exists', async () => {
      // Arrange
      const mockGuaranteePeriod: GuaranteePeriod = {
        id: mockGuaranteePeriodId,
        project_id: mockProjectId,
        installation_guarantee_days: 90,
        material_guarantee_days: 365,
        contractor_liable_during_guarantee: true,
        auto_classify_out_of_guarantee: true,
        created_at: new Date(),
        updated_at: new Date()
      };

      vi.mocked(db.queryOne).mockResolvedValue(mockGuaranteePeriod);

      // Act
      const result = await guaranteeService.getOrCreateDefaultGuaranteePeriod(mockProjectId);

      // Assert
      expect(result).toEqual(mockGuaranteePeriod);
      expect(db.queryOne).toHaveBeenCalledTimes(1); // Only SELECT, no INSERT
    });

    it('should create default guarantee period if it does not exist', async () => {
      // Arrange
      const mockNewGuaranteePeriod: GuaranteePeriod = {
        id: mockGuaranteePeriodId,
        project_id: mockProjectId,
        installation_guarantee_days: 90,
        material_guarantee_days: 365,
        contractor_liable_during_guarantee: true,
        auto_classify_out_of_guarantee: true,
        created_at: new Date(),
        updated_at: new Date()
      };

      vi.mocked(db.queryOne).mockResolvedValueOnce(null); // Not found
      vi.mocked(db.queryOne).mockResolvedValueOnce(mockNewGuaranteePeriod); // Created

      // Act
      const result = await guaranteeService.getOrCreateDefaultGuaranteePeriod(mockProjectId);

      // Assert
      expect(result).toEqual(mockNewGuaranteePeriod);
      expect(db.queryOne).toHaveBeenCalledTimes(2); // SELECT + INSERT
    });
  });
});
