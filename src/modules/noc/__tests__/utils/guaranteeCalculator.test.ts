/**
 * Guarantee Calculator Tests - TDD
 * 🟢 WORKING: Comprehensive tests for guarantee calculation utility
 *
 * Tests WRITTEN FIRST following TDD methodology.
 * These tests validate guarantee expiry calculations, classification,
 * and billing determinations.
 */

import { describe, it, expect } from 'vitest';
import {
  calculateGuaranteeExpiry,
  classifyGuaranteeStatus,
  determineBillingClassification,
  assessContractorLiability,
  type GuaranteeExpiryInput,
  type GuaranteeClassificationInput,
  type BillingDeterminationInput,
  type ContractorLiabilityInput
} from '../../utils/guaranteeCalculator';
import { GuaranteeStatus, FaultCause } from '../../types/ticket';
import { BillingClassification } from '../../types/guarantee';

describe('Guarantee Calculator (TDD)', () => {
  /**
   * Test: Calculate guarantee expiry - installation (90 days)
   */
  describe('calculateGuaranteeExpiry - Installation', () => {
    it('should calculate expiry date 90 days from installation date', () => {
      // Arrange: Installation on Jan 1, 2024
      const installationDate = new Date('2024-01-01T00:00:00Z');
      const input: GuaranteeExpiryInput = {
        installation_date: installationDate,
        ticket_type: 'installation',
        guarantee_days: 90
      };

      // Act
      const result = calculateGuaranteeExpiry(input);

      // Assert: Should expire on Apr 1, 2024 (90 days later)
      expect(result.expires_at).toEqual(new Date('2024-04-01T00:00:00Z'));
      expect(result.days_from_installation).toBe(90);
    });

    it('should correctly calculate days remaining when within guarantee period', () => {
      // Arrange: Installed 30 days ago at UTC midnight
      const installationDate = new Date();
      installationDate.setUTCDate(installationDate.getUTCDate() - 30);
      installationDate.setUTCHours(0, 0, 0, 0);

      const input: GuaranteeExpiryInput = {
        installation_date: installationDate,
        ticket_type: 'installation',
        guarantee_days: 90
      };

      // Act
      const result = calculateGuaranteeExpiry(input);

      // Assert: Should have 60 days remaining (90 total - 30 elapsed)
      expect(result.days_remaining).toBe(60);
      expect(result.is_expired).toBe(false);
    });

    it('should mark as expired when past guarantee period', () => {
      // Arrange: Installed 120 days ago (past 90 day guarantee)
      const installationDate = new Date();
      installationDate.setDate(installationDate.getDate() - 120);
      installationDate.setHours(0, 0, 0, 0);

      const input: GuaranteeExpiryInput = {
        installation_date: installationDate,
        ticket_type: 'installation',
        guarantee_days: 90
      };

      // Act
      const result = calculateGuaranteeExpiry(input);

      // Assert: Should be expired
      expect(result.is_expired).toBe(true);
      expect(result.days_remaining).toBe(0);
    });

    it('should handle same-day installation correctly', () => {
      // Arrange: Installed today at UTC midnight
      const installationDate = new Date();
      installationDate.setUTCHours(0, 0, 0, 0);

      const input: GuaranteeExpiryInput = {
        installation_date: installationDate,
        ticket_type: 'installation',
        guarantee_days: 90
      };

      // Act
      const result = calculateGuaranteeExpiry(input);

      // Assert: Should have full 90 days remaining
      expect(result.days_remaining).toBe(90);
      expect(result.is_expired).toBe(false);
    });
  });

  /**
   * Test: Calculate guarantee expiry - material (365 days)
   */
  describe('calculateGuaranteeExpiry - Material', () => {
    it('should calculate expiry date 365 days from installation date', () => {
      // Arrange: Installation on Jan 1, 2024
      const installationDate = new Date('2024-01-01T00:00:00Z');
      const input: GuaranteeExpiryInput = {
        installation_date: installationDate,
        ticket_type: 'material',
        guarantee_days: 365
      };

      // Act
      const result = calculateGuaranteeExpiry(input);

      // Assert: Should expire on Jan 1, 2025 (365 days later)
      expect(result.expires_at).toEqual(new Date('2025-01-01T00:00:00Z'));
      expect(result.days_from_installation).toBe(365);
    });

    it('should correctly calculate days remaining for material guarantee', () => {
      // Arrange: Installed 100 days ago at UTC midnight
      const installationDate = new Date();
      installationDate.setUTCDate(installationDate.getUTCDate() - 100);
      installationDate.setUTCHours(0, 0, 0, 0);

      const input: GuaranteeExpiryInput = {
        installation_date: installationDate,
        ticket_type: 'material',
        guarantee_days: 365
      };

      // Act
      const result = calculateGuaranteeExpiry(input);

      // Assert: Should have 265 days remaining
      expect(result.days_remaining).toBe(265);
      expect(result.is_expired).toBe(false);
    });

    it('should handle leap year correctly', () => {
      // Arrange: Installation on Feb 28, 2024 (leap year)
      const installationDate = new Date('2024-02-28T00:00:00Z');
      const input: GuaranteeExpiryInput = {
        installation_date: installationDate,
        ticket_type: 'material',
        guarantee_days: 365
      };

      // Act
      const result = calculateGuaranteeExpiry(input);

      // Assert: Should correctly handle leap year (365 days from Feb 28, 2024 = Feb 28, 2025)
      expect(result.days_from_installation).toBe(365);
      expect(result.expires_at).toEqual(new Date('2025-02-28T00:00:00Z'));
    });
  });

  /**
   * Test: Classify ticket - under guarantee
   */
  describe('classifyGuaranteeStatus - Under Guarantee', () => {
    it('should classify as UNDER_GUARANTEE when within installation guarantee period', () => {
      // Arrange: Installation completed 30 days ago
      const installationDate = new Date();
      installationDate.setDate(installationDate.getDate() - 30);

      const input: GuaranteeClassificationInput = {
        ticket_id: 'ticket-123',
        installation_date: installationDate,
        ticket_type: 'installation',
        installation_guarantee_days: 90,
        material_guarantee_days: 365
      };

      // Act
      const result = classifyGuaranteeStatus(input);

      // Assert
      expect(result.status).toBe(GuaranteeStatus.UNDER_GUARANTEE);
      expect(result.days_remaining).toBe(60);
      expect(result.expires_at).toBeTruthy();
    });

    it('should classify as UNDER_GUARANTEE when within material guarantee period', () => {
      // Arrange: Installation completed 100 days ago (past installation, within material)
      const installationDate = new Date();
      installationDate.setDate(installationDate.getDate() - 100);

      const input: GuaranteeClassificationInput = {
        ticket_id: 'ticket-123',
        installation_date: installationDate,
        ticket_type: 'material',
        installation_guarantee_days: 90,
        material_guarantee_days: 365
      };

      // Act
      const result = classifyGuaranteeStatus(input);

      // Assert
      expect(result.status).toBe(GuaranteeStatus.UNDER_GUARANTEE);
      expect(result.days_remaining).toBe(265);
      expect(result.expires_at).toBeTruthy();
    });

    it('should classify as UNDER_GUARANTEE on last day of guarantee', () => {
      // Arrange: Installation completed 89 days ago (last day of 90-day guarantee)
      const installationDate = new Date();
      installationDate.setDate(installationDate.getDate() - 89);

      const input: GuaranteeClassificationInput = {
        ticket_id: 'ticket-123',
        installation_date: installationDate,
        ticket_type: 'installation',
        installation_guarantee_days: 90,
        material_guarantee_days: 365
      };

      // Act
      const result = classifyGuaranteeStatus(input);

      // Assert
      expect(result.status).toBe(GuaranteeStatus.UNDER_GUARANTEE);
      expect(result.days_remaining).toBe(1);
    });
  });

  /**
   * Test: Classify ticket - out of guarantee
   */
  describe('classifyGuaranteeStatus - Out of Guarantee', () => {
    it('should classify as OUT_OF_GUARANTEE when past installation guarantee period', () => {
      // Arrange: Installation completed 120 days ago (past 90-day guarantee)
      const installationDate = new Date();
      installationDate.setDate(installationDate.getDate() - 120);

      const input: GuaranteeClassificationInput = {
        ticket_id: 'ticket-123',
        installation_date: installationDate,
        ticket_type: 'installation',
        installation_guarantee_days: 90,
        material_guarantee_days: 365
      };

      // Act
      const result = classifyGuaranteeStatus(input);

      // Assert
      expect(result.status).toBe(GuaranteeStatus.OUT_OF_GUARANTEE);
      expect(result.days_remaining).toBe(0);
      expect(result.expires_at).toBeTruthy();
    });

    it('should classify as OUT_OF_GUARANTEE when past material guarantee period', () => {
      // Arrange: Installation completed 400 days ago (past 365-day guarantee)
      const installationDate = new Date();
      installationDate.setDate(installationDate.getDate() - 400);

      const input: GuaranteeClassificationInput = {
        ticket_id: 'ticket-123',
        installation_date: installationDate,
        ticket_type: 'material',
        installation_guarantee_days: 90,
        material_guarantee_days: 365
      };

      // Act
      const result = classifyGuaranteeStatus(input);

      // Assert
      expect(result.status).toBe(GuaranteeStatus.OUT_OF_GUARANTEE);
      expect(result.days_remaining).toBe(0);
    });
  });

  /**
   * Test: Classify ticket - pending classification
   */
  describe('classifyGuaranteeStatus - Pending Classification', () => {
    it('should classify as PENDING_CLASSIFICATION when installation_date is null', () => {
      // Arrange: No installation date provided
      const input: GuaranteeClassificationInput = {
        ticket_id: 'ticket-123',
        installation_date: null,
        ticket_type: 'installation',
        installation_guarantee_days: 90,
        material_guarantee_days: 365
      };

      // Act
      const result = classifyGuaranteeStatus(input);

      // Assert
      expect(result.status).toBe(GuaranteeStatus.PENDING_CLASSIFICATION);
      expect(result.days_remaining).toBeNull();
      expect(result.expires_at).toBeNull();
      expect(result.reason).toContain('No installation date');
    });

    it('should classify as PENDING_CLASSIFICATION when ticket_type is unknown', () => {
      // Arrange: Unknown ticket type
      const installationDate = new Date();
      installationDate.setDate(installationDate.getDate() - 30);

      const input: GuaranteeClassificationInput = {
        ticket_id: 'ticket-123',
        installation_date: installationDate,
        ticket_type: null,
        installation_guarantee_days: 90,
        material_guarantee_days: 365
      };

      // Act
      const result = classifyGuaranteeStatus(input);

      // Assert
      expect(result.status).toBe(GuaranteeStatus.PENDING_CLASSIFICATION);
      expect(result.days_remaining).toBeNull();
      expect(result.expires_at).toBeNull();
      expect(result.reason).toContain('Unknown ticket type');
    });
  });

  /**
   * Test: Determine billable status
   */
  describe('determineBillingClassification', () => {
    it('should classify as CONTRACTOR_UNDER_GUARANTEE when fault is workmanship and under guarantee', () => {
      // Arrange
      const input: BillingDeterminationInput = {
        guarantee_status: GuaranteeStatus.UNDER_GUARANTEE,
        fault_cause: FaultCause.WORKMANSHIP,
        contractor_liable_during_guarantee: true
      };

      // Act
      const result = determineBillingClassification(input);

      // Assert
      expect(result.billing_classification).toBe(BillingClassification.CONTRACTOR_UNDER_GUARANTEE);
      expect(result.is_billable).toBe(false);
      expect(result.reason).toContain('contractor liable');
    });

    it('should classify as CLIENT_OUT_OF_GUARANTEE when out of guarantee period', () => {
      // Arrange
      const input: BillingDeterminationInput = {
        guarantee_status: GuaranteeStatus.OUT_OF_GUARANTEE,
        fault_cause: FaultCause.WORKMANSHIP,
        contractor_liable_during_guarantee: true
      };

      // Act
      const result = determineBillingClassification(input);

      // Assert
      expect(result.billing_classification).toBe(BillingClassification.CLIENT_OUT_OF_GUARANTEE);
      expect(result.is_billable).toBe(true);
      expect(result.reason).toContain('Out of guarantee');
    });

    it('should classify as CLIENT_DAMAGE when fault cause is client damage', () => {
      // Arrange
      const input: BillingDeterminationInput = {
        guarantee_status: GuaranteeStatus.UNDER_GUARANTEE,
        fault_cause: FaultCause.CLIENT_DAMAGE,
        contractor_liable_during_guarantee: true
      };

      // Act
      const result = determineBillingClassification(input);

      // Assert
      expect(result.billing_classification).toBe(BillingClassification.CLIENT_DAMAGE);
      expect(result.is_billable).toBe(true);
      expect(result.reason).toContain('Client caused damage');
    });

    it('should classify as THIRD_PARTY_DAMAGE when fault cause is third party damage', () => {
      // Arrange
      const input: BillingDeterminationInput = {
        guarantee_status: GuaranteeStatus.UNDER_GUARANTEE,
        fault_cause: FaultCause.THIRD_PARTY,
        contractor_liable_during_guarantee: true
      };

      // Act
      const result = determineBillingClassification(input);

      // Assert
      expect(result.billing_classification).toBe(BillingClassification.THIRD_PARTY_DAMAGE);
      expect(result.is_billable).toBe(true);
      expect(result.reason).toContain('Third-party damage');
    });

    it('should classify as WARRANTY_CLAIM when fault cause is material failure under guarantee', () => {
      // Arrange
      const input: BillingDeterminationInput = {
        guarantee_status: GuaranteeStatus.UNDER_GUARANTEE,
        fault_cause: FaultCause.MATERIAL_FAILURE,
        contractor_liable_during_guarantee: true
      };

      // Act
      const result = determineBillingClassification(input);

      // Assert
      expect(result.billing_classification).toBe(BillingClassification.WARRANTY_CLAIM);
      expect(result.is_billable).toBe(false);
      expect(result.reason).toContain('Material warranty claim');
    });

    it('should classify as FREE_OF_CHARGE when fault cause is environmental', () => {
      // Arrange
      const input: BillingDeterminationInput = {
        guarantee_status: GuaranteeStatus.UNDER_GUARANTEE,
        fault_cause: FaultCause.ENVIRONMENTAL,
        contractor_liable_during_guarantee: true
      };

      // Act
      const result = determineBillingClassification(input);

      // Assert
      expect(result.billing_classification).toBe(BillingClassification.FREE_OF_CHARGE);
      expect(result.is_billable).toBe(false);
      expect(result.reason).toContain('Environmental damage');
    });

    it('should classify as FREE_OF_CHARGE when fault cause is vandalism', () => {
      // Arrange
      const input: BillingDeterminationInput = {
        guarantee_status: GuaranteeStatus.UNDER_GUARANTEE,
        fault_cause: FaultCause.VANDALISM,
        contractor_liable_during_guarantee: true
      };

      // Act
      const result = determineBillingClassification(input);

      // Assert
      expect(result.billing_classification).toBe(BillingClassification.FREE_OF_CHARGE);
      expect(result.is_billable).toBe(false);
      expect(result.reason).toContain('Vandalism');
    });

    it('should classify as PENDING_CLASSIFICATION when fault cause is unknown', () => {
      // Arrange
      const input: BillingDeterminationInput = {
        guarantee_status: GuaranteeStatus.UNDER_GUARANTEE,
        fault_cause: FaultCause.UNKNOWN,
        contractor_liable_during_guarantee: true
      };

      // Act
      const result = determineBillingClassification(input);

      // Assert
      expect(result.billing_classification).toBe(BillingClassification.PENDING_CLASSIFICATION);
      expect(result.is_billable).toBe(false);
      expect(result.reason).toContain('Unknown fault cause');
    });

    it('should classify as PENDING_CLASSIFICATION when guarantee status is pending', () => {
      // Arrange
      const input: BillingDeterminationInput = {
        guarantee_status: GuaranteeStatus.PENDING_CLASSIFICATION,
        fault_cause: FaultCause.WORKMANSHIP,
        contractor_liable_during_guarantee: true
      };

      // Act
      const result = determineBillingClassification(input);

      // Assert
      expect(result.billing_classification).toBe(BillingClassification.PENDING_CLASSIFICATION);
      expect(result.is_billable).toBe(false);
      expect(result.reason).toContain('Guarantee status pending');
    });

    it('should respect contractor_liable_during_guarantee setting when false', () => {
      // Arrange: Contractor NOT liable during guarantee
      const input: BillingDeterminationInput = {
        guarantee_status: GuaranteeStatus.UNDER_GUARANTEE,
        fault_cause: FaultCause.WORKMANSHIP,
        contractor_liable_during_guarantee: false
      };

      // Act
      const result = determineBillingClassification(input);

      // Assert: Should still classify as under guarantee but contractor not liable
      expect(result.billing_classification).toBe(BillingClassification.FREE_OF_CHARGE);
      expect(result.is_billable).toBe(false);
      expect(result.reason).toContain('Contractor not liable');
    });
  });

  /**
   * Test: Contractor liability determination
   */
  describe('assessContractorLiability', () => {
    it('should determine contractor IS liable when workmanship fault under guarantee', () => {
      // Arrange
      const input: ContractorLiabilityInput = {
        guarantee_status: GuaranteeStatus.UNDER_GUARANTEE,
        fault_cause: FaultCause.WORKMANSHIP,
        contractor_liable_during_guarantee: true
      };

      // Act
      const result = assessContractorLiability(input);

      // Assert
      expect(result.is_liable).toBe(true);
      expect(result.billing_impact).toBe('contractor_pays');
      expect(result.reason).toContain('Workmanship fault under guarantee');
    });

    it('should determine contractor is NOT liable when out of guarantee', () => {
      // Arrange
      const input: ContractorLiabilityInput = {
        guarantee_status: GuaranteeStatus.OUT_OF_GUARANTEE,
        fault_cause: FaultCause.WORKMANSHIP,
        contractor_liable_during_guarantee: true
      };

      // Act
      const result = assessContractorLiability(input);

      // Assert
      expect(result.is_liable).toBe(false);
      expect(result.billing_impact).toBe('client_pays');
      expect(result.reason).toContain('Out of guarantee');
    });

    it('should determine contractor is NOT liable when fault is client damage', () => {
      // Arrange
      const input: ContractorLiabilityInput = {
        guarantee_status: GuaranteeStatus.UNDER_GUARANTEE,
        fault_cause: FaultCause.CLIENT_DAMAGE,
        contractor_liable_during_guarantee: true
      };

      // Act
      const result = assessContractorLiability(input);

      // Assert
      expect(result.is_liable).toBe(false);
      expect(result.billing_impact).toBe('client_pays');
      expect(result.reason).toContain('Client damage');
    });

    it('should determine contractor is NOT liable when fault is third party', () => {
      // Arrange
      const input: ContractorLiabilityInput = {
        guarantee_status: GuaranteeStatus.UNDER_GUARANTEE,
        fault_cause: FaultCause.THIRD_PARTY,
        contractor_liable_during_guarantee: true
      };

      // Act
      const result = assessContractorLiability(input);

      // Assert
      expect(result.is_liable).toBe(false);
      expect(result.billing_impact).toBe('client_pays');
      expect(result.reason).toContain('Third-party damage');
    });

    it('should determine contractor is NOT liable when fault is environmental', () => {
      // Arrange
      const input: ContractorLiabilityInput = {
        guarantee_status: GuaranteeStatus.UNDER_GUARANTEE,
        fault_cause: FaultCause.ENVIRONMENTAL,
        contractor_liable_during_guarantee: true
      };

      // Act
      const result = assessContractorLiability(input);

      // Assert
      expect(result.is_liable).toBe(false);
      expect(result.billing_impact).toBe('client_pays');
      expect(result.reason).toContain('Environmental damage');
    });

    it('should determine contractor is NOT liable when fault is material failure', () => {
      // Arrange
      const input: ContractorLiabilityInput = {
        guarantee_status: GuaranteeStatus.UNDER_GUARANTEE,
        fault_cause: FaultCause.MATERIAL_FAILURE,
        contractor_liable_during_guarantee: true
      };

      // Act
      const result = assessContractorLiability(input);

      // Assert
      expect(result.is_liable).toBe(false);
      expect(result.billing_impact).toBe('client_pays');
      expect(result.reason).toContain('Material failure');
    });

    it('should return pending when fault cause is unknown', () => {
      // Arrange
      const input: ContractorLiabilityInput = {
        guarantee_status: GuaranteeStatus.UNDER_GUARANTEE,
        fault_cause: FaultCause.UNKNOWN,
        contractor_liable_during_guarantee: true
      };

      // Act
      const result = assessContractorLiability(input);

      // Assert
      expect(result.is_liable).toBe(false);
      expect(result.billing_impact).toBe('pending');
      expect(result.reason).toContain('Unknown fault cause');
    });

    it('should return pending when guarantee status is pending', () => {
      // Arrange
      const input: ContractorLiabilityInput = {
        guarantee_status: GuaranteeStatus.PENDING_CLASSIFICATION,
        fault_cause: FaultCause.WORKMANSHIP,
        contractor_liable_during_guarantee: true
      };

      // Act
      const result = assessContractorLiability(input);

      // Assert
      expect(result.is_liable).toBe(false);
      expect(result.billing_impact).toBe('pending');
      expect(result.reason).toContain('Guarantee status pending');
    });

    it('should respect contractor_liable_during_guarantee setting', () => {
      // Arrange: Policy says contractor NOT liable
      const input: ContractorLiabilityInput = {
        guarantee_status: GuaranteeStatus.UNDER_GUARANTEE,
        fault_cause: FaultCause.WORKMANSHIP,
        contractor_liable_during_guarantee: false
      };

      // Act
      const result = assessContractorLiability(input);

      // Assert
      expect(result.is_liable).toBe(false);
      expect(result.billing_impact).toBe('client_pays');
      expect(result.reason).toContain('Policy: contractor not liable');
    });
  });

  /**
   * Test: Edge cases and validation
   */
  describe('Edge Cases and Validation', () => {
    it('should handle custom guarantee days correctly', () => {
      // Arrange: Custom 60-day guarantee instead of standard 90
      const installationDate = new Date();
      installationDate.setDate(installationDate.getDate() - 30);

      const input: GuaranteeExpiryInput = {
        installation_date: installationDate,
        ticket_type: 'installation',
        guarantee_days: 60 // Custom
      };

      // Act
      const result = calculateGuaranteeExpiry(input);

      // Assert
      expect(result.days_from_installation).toBe(60);
      expect(result.days_remaining).toBe(30);
    });

    it('should handle future installation dates gracefully', () => {
      // Arrange: Installation date in future (data error scenario)
      const installationDate = new Date();
      installationDate.setDate(installationDate.getDate() + 10);

      const input: GuaranteeExpiryInput = {
        installation_date: installationDate,
        ticket_type: 'installation',
        guarantee_days: 90
      };

      // Act
      const result = calculateGuaranteeExpiry(input);

      // Assert: Should handle gracefully (future dates get full guarantee)
      expect(result.days_remaining).toBeGreaterThan(90);
      expect(result.is_expired).toBe(false);
    });

    it('should handle zero guarantee days', () => {
      // Arrange: Zero-day guarantee (instant expiry)
      const installationDate = new Date();
      installationDate.setDate(installationDate.getDate() - 1);

      const input: GuaranteeExpiryInput = {
        installation_date: installationDate,
        ticket_type: 'installation',
        guarantee_days: 0
      };

      // Act
      const result = calculateGuaranteeExpiry(input);

      // Assert
      expect(result.days_from_installation).toBe(0);
      expect(result.is_expired).toBe(true);
      expect(result.days_remaining).toBe(0);
    });
  });
});
