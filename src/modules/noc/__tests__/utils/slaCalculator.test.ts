/**
 * SLA Calculator Tests - TDD
 * 🟢 WORKING: Comprehensive tests for SLA calculation utility
 *
 * Tests WRITTEN FIRST following TDD methodology.
 * These tests validate SLA compliance calculations, overdue detection,
 * and resolution time calculations.
 */

import { describe, it, expect } from 'vitest';
import {
  calculateSLACompliance,
  isTicketOverdue,
  calculateResolutionTime,
  calculateSLATimeRemaining,
  type SLAComplianceInput,
  type OverdueCheckInput,
  type ResolutionTimeInput,
  type SLATimeRemainingInput
} from '../../utils/slaCalculator';

describe('SLA Calculator (TDD)', () => {
  /**
   * Test: Calculate SLA compliance rate
   */
  describe('calculateSLACompliance', () => {
    it('should return 100% compliance when all tickets met SLA', () => {
      // Arrange: 10 tickets, all met SLA
      const input: SLAComplianceInput = {
        total_tickets: 10,
        sla_met: 10,
        sla_breached: 0
      };

      // Act
      const result = calculateSLACompliance(input);

      // Assert: 100% compliance
      expect(result.compliance_rate).toBe(100);
      expect(result.total_tickets).toBe(10);
      expect(result.sla_met).toBe(10);
      expect(result.sla_breached).toBe(0);
      expect(result.compliance_percentage).toBe('100.00%');
    });

    it('should return 0% compliance when all tickets breached SLA', () => {
      // Arrange: 5 tickets, all breached
      const input: SLAComplianceInput = {
        total_tickets: 5,
        sla_met: 0,
        sla_breached: 5
      };

      // Act
      const result = calculateSLACompliance(input);

      // Assert: 0% compliance
      expect(result.compliance_rate).toBe(0);
      expect(result.sla_met).toBe(0);
      expect(result.sla_breached).toBe(5);
      expect(result.compliance_percentage).toBe('0.00%');
    });

    it('should calculate correct compliance rate with partial breaches', () => {
      // Arrange: 20 tickets, 17 met SLA, 3 breached
      const input: SLAComplianceInput = {
        total_tickets: 20,
        sla_met: 17,
        sla_breached: 3
      };

      // Act
      const result = calculateSLACompliance(input);

      // Assert: 85% compliance (17/20 = 0.85)
      expect(result.compliance_rate).toBe(85);
      expect(result.compliance_percentage).toBe('85.00%');
    });

    it('should handle zero tickets gracefully', () => {
      // Arrange: No tickets
      const input: SLAComplianceInput = {
        total_tickets: 0,
        sla_met: 0,
        sla_breached: 0
      };

      // Act
      const result = calculateSLACompliance(input);

      // Assert: 0% but no division by zero
      expect(result.compliance_rate).toBe(0);
      expect(result.compliance_percentage).toBe('0.00%');
    });

    it('should round compliance rate to 2 decimal places', () => {
      // Arrange: 7 tickets, 5 met SLA (71.428571%)
      const input: SLAComplianceInput = {
        total_tickets: 7,
        sla_met: 5,
        sla_breached: 2
      };

      // Act
      const result = calculateSLACompliance(input);

      // Assert: Rounded to 71.43%
      expect(result.compliance_rate).toBeCloseTo(71.43, 2);
      expect(result.compliance_percentage).toBe('71.43%');
    });
  });

  /**
   * Test: Check if ticket is overdue (past SLA)
   */
  describe('isTicketOverdue', () => {
    it('should return true when past SLA due date', () => {
      // Arrange: SLA due yesterday
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      yesterday.setHours(0, 0, 0, 0);

      const input: OverdueCheckInput = {
        sla_due_at: yesterday,
        current_status: 'in_progress'
      };

      // Act
      const result = isTicketOverdue(input);

      // Assert: Ticket is overdue
      expect(result.is_overdue).toBe(true);
      expect(result.hours_overdue).toBeGreaterThan(0);
    });

    it('should return false when SLA due date is in the future', () => {
      // Arrange: SLA due tomorrow
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);

      const input: OverdueCheckInput = {
        sla_due_at: tomorrow,
        current_status: 'assigned'
      };

      // Act
      const result = isTicketOverdue(input);

      // Assert: Not overdue
      expect(result.is_overdue).toBe(false);
      expect(result.hours_overdue).toBe(0);
    });

    it('should return false when ticket is already closed', () => {
      // Arrange: SLA due yesterday but ticket is closed
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);

      const input: OverdueCheckInput = {
        sla_due_at: yesterday,
        current_status: 'closed'
      };

      // Act
      const result = isTicketOverdue(input);

      // Assert: Not overdue (closed tickets exempt)
      expect(result.is_overdue).toBe(false);
      expect(result.hours_overdue).toBe(0);
    });

    it('should return false when ticket is cancelled', () => {
      // Arrange: SLA due yesterday but ticket is cancelled
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);

      const input: OverdueCheckInput = {
        sla_due_at: yesterday,
        current_status: 'cancelled'
      };

      // Act
      const result = isTicketOverdue(input);

      // Assert: Not overdue (cancelled tickets exempt)
      expect(result.is_overdue).toBe(false);
    });

    it('should calculate hours overdue correctly', () => {
      // Arrange: SLA due 48 hours ago
      const twoDaysAgo = new Date();
      twoDaysAgo.setHours(twoDaysAgo.getHours() - 48);

      const input: OverdueCheckInput = {
        sla_due_at: twoDaysAgo,
        current_status: 'open'
      };

      // Act
      const result = isTicketOverdue(input);

      // Assert: 48 hours overdue
      expect(result.is_overdue).toBe(true);
      expect(result.hours_overdue).toBeCloseTo(48, 0);
    });

    it('should handle null SLA due date', () => {
      // Arrange: No SLA due date set
      const input: OverdueCheckInput = {
        sla_due_at: null,
        current_status: 'open'
      };

      // Act
      const result = isTicketOverdue(input);

      // Assert: Not overdue if no SLA set
      expect(result.is_overdue).toBe(false);
      expect(result.hours_overdue).toBe(0);
    });
  });

  /**
   * Test: Calculate time remaining until SLA breach
   */
  describe('calculateSLATimeRemaining', () => {
    it('should calculate hours remaining when SLA is in future', () => {
      // Arrange: SLA due in 24 hours
      const tomorrow = new Date();
      tomorrow.setHours(tomorrow.getHours() + 24);

      const input: SLATimeRemainingInput = {
        sla_due_at: tomorrow
      };

      // Act
      const result = calculateSLATimeRemaining(input);

      // Assert: ~24 hours remaining
      expect(result.hours_remaining).toBeCloseTo(24, 0);
      expect(result.is_breached).toBe(false);
      expect(result.status).toBe('ok');
    });

    it('should return warning status when less than 4 hours remaining', () => {
      // Arrange: SLA due in 3 hours
      const soon = new Date();
      soon.setHours(soon.getHours() + 3);

      const input: SLATimeRemainingInput = {
        sla_due_at: soon
      };

      // Act
      const result = calculateSLATimeRemaining(input);

      // Assert: Warning status
      expect(result.hours_remaining).toBeCloseTo(3, 0);
      expect(result.is_breached).toBe(false);
      expect(result.status).toBe('warning');
    });

    it('should return breached status when SLA is past', () => {
      // Arrange: SLA was yesterday
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);

      const input: SLATimeRemainingInput = {
        sla_due_at: yesterday
      };

      // Act
      const result = calculateSLATimeRemaining(input);

      // Assert: Breached
      expect(result.hours_remaining).toBeLessThan(0);
      expect(result.is_breached).toBe(true);
      expect(result.status).toBe('breached');
    });

    it('should handle null SLA due date', () => {
      // Arrange: No SLA set
      const input: SLATimeRemainingInput = {
        sla_due_at: null
      };

      // Act
      const result = calculateSLATimeRemaining(input);

      // Assert: No SLA
      expect(result.hours_remaining).toBe(0);
      expect(result.is_breached).toBe(false);
      expect(result.status).toBe('no_sla');
    });
  });

  /**
   * Test: Calculate resolution time for closed tickets
   */
  describe('calculateResolutionTime', () => {
    it('should calculate resolution time in hours', () => {
      // Arrange: Ticket created 48 hours ago, closed now
      const twoDaysAgo = new Date();
      twoDaysAgo.setHours(twoDaysAgo.getHours() - 48);
      const now = new Date();

      const input: ResolutionTimeInput = {
        created_at: twoDaysAgo,
        closed_at: now
      };

      // Act
      const result = calculateResolutionTime(input);

      // Assert: 48 hours to resolve
      expect(result.resolution_hours).toBeCloseTo(48, 0);
      expect(result.resolution_days).toBeCloseTo(2, 1);
    });

    it('should calculate resolution time in days', () => {
      // Arrange: Ticket created 5 days ago, closed now
      const fiveDaysAgo = new Date();
      fiveDaysAgo.setDate(fiveDaysAgo.getDate() - 5);
      const now = new Date();

      const input: ResolutionTimeInput = {
        created_at: fiveDaysAgo,
        closed_at: now
      };

      // Act
      const result = calculateResolutionTime(input);

      // Assert: ~120 hours = 5 days
      expect(result.resolution_days).toBeCloseTo(5, 0);
      expect(result.resolution_hours).toBeCloseTo(120, 0);
    });

    it('should return null when ticket is not closed', () => {
      // Arrange: Ticket created yesterday, not closed
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);

      const input: ResolutionTimeInput = {
        created_at: yesterday,
        closed_at: null
      };

      // Act
      const result = calculateResolutionTime(input);

      // Assert: No resolution time (not closed)
      expect(result.resolution_hours).toBeNull();
      expect(result.resolution_days).toBeNull();
      expect(result.is_resolved).toBe(false);
    });

    it('should handle same-day resolution', () => {
      // Arrange: Ticket created 2 hours ago, closed now
      const twoHoursAgo = new Date();
      twoHoursAgo.setHours(twoHoursAgo.getHours() - 2);
      const now = new Date();

      const input: ResolutionTimeInput = {
        created_at: twoHoursAgo,
        closed_at: now
      };

      // Act
      const result = calculateResolutionTime(input);

      // Assert: 2 hours to resolve
      expect(result.resolution_hours).toBeCloseTo(2, 0);
      expect(result.resolution_days).toBeCloseTo(0.08, 1); // ~2/24 days
      expect(result.is_resolved).toBe(true);
    });
  });
});
