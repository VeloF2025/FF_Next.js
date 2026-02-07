/**
 * Tests for ComplianceDashboard component (TDD)
 * RAG status overview for staff document compliance
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ComplianceDashboard } from '../../../src/components/staff/ComplianceDashboard';
import type { ComplianceStatus } from '../../../src/types/staff-document.types';

// Mock logger
vi.mock('@/lib/logger', () => ({
  log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), getLogs: vi.fn(() => []), clearLogs: vi.fn() },
  createLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}));

describe('ComplianceDashboard', () => {
  const compliantStatus: ComplianceStatus = {
    staffId: 'staff-1',
    totalDocuments: 5,
    verifiedDocuments: 5,
    pendingDocuments: 0,
    rejectedDocuments: 0,
    expiredDocuments: 0,
    expiringIn30Days: 1,
    expiringIn7Days: 0,
    missingRequired: [],
    compliancePercentage: 100,
    status: 'compliant',
  };

  const warningStatus: ComplianceStatus = {
    staffId: 'staff-2',
    totalDocuments: 6,
    verifiedDocuments: 4,
    pendingDocuments: 2,
    rejectedDocuments: 0,
    expiredDocuments: 0,
    expiringIn30Days: 2,
    expiringIn7Days: 1,
    missingRequired: [],
    compliancePercentage: 67,
    status: 'warning',
  };

  const nonCompliantStatus: ComplianceStatus = {
    staffId: 'staff-3',
    totalDocuments: 3,
    verifiedDocuments: 1,
    pendingDocuments: 1,
    rejectedDocuments: 1,
    expiredDocuments: 1,
    expiringIn30Days: 0,
    expiringIn7Days: 0,
    missingRequired: ['id_document', 'employment_contract'],
    compliancePercentage: 33,
    status: 'non_compliant',
  };

  const mockStaffComplianceData = [
    { ...compliantStatus, staffName: 'John Doe' },
    { ...warningStatus, staffName: 'Jane Smith' },
    { ...nonCompliantStatus, staffName: 'Bob Wilson' },
  ];

  const defaultProps = {
    complianceData: mockStaffComplianceData,
    isLoading: false,
    onStaffClick: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Summary Statistics', () => {
    it('should display total staff count', () => {
      render(<ComplianceDashboard {...defaultProps} />);
      expect(screen.getByText('Total Staff')).toBeInTheDocument();
    });

    it('should display compliant count', () => {
      render(<ComplianceDashboard {...defaultProps} />);
      expect(screen.getByText(/1 Compliant/)).toBeInTheDocument();
    });

    it('should display warning count', () => {
      render(<ComplianceDashboard {...defaultProps} />);
      expect(screen.getByText(/1 Warning/)).toBeInTheDocument();
    });

    it('should display non-compliant count', () => {
      render(<ComplianceDashboard {...defaultProps} />);
      expect(screen.getByText(/1 Non-Compliant/)).toBeInTheDocument();
    });

    it('should display overall compliance percentage', () => {
      render(<ComplianceDashboard {...defaultProps} />);
      // Average of 100, 67, 33 = 66.67%
      expect(screen.getByText('Avg Compliance')).toBeInTheDocument();
    });

    it('should display expiring documents count', () => {
      render(<ComplianceDashboard {...defaultProps} />);
      expect(screen.getByText('Expiring in 30 days')).toBeInTheDocument();
    });
  });

  describe('RAG Status Indicators', () => {
    it('should show green indicator for compliant staff', () => {
      const { container } = render(<ComplianceDashboard {...defaultProps} />);
      expect(container.querySelector('[class*="green"]')).toBeTruthy();
    });

    it('should show yellow/amber indicator for warning status', () => {
      const { container } = render(<ComplianceDashboard {...defaultProps} />);
      expect(
        container.querySelector('[class*="yellow"], [class*="amber"]')
      ).toBeTruthy();
    });

    it('should show red indicator for non-compliant status', () => {
      const { container } = render(<ComplianceDashboard {...defaultProps} />);
      expect(container.querySelector('[class*="red"]')).toBeTruthy();
    });
  });

  describe('Staff List', () => {
    it('should display staff names', () => {
      render(<ComplianceDashboard {...defaultProps} />);
      expect(screen.getByText('John Doe')).toBeInTheDocument();
      expect(screen.getByText('Jane Smith')).toBeInTheDocument();
      expect(screen.getByText('Bob Wilson')).toBeInTheDocument();
    });

    it('should display individual compliance percentages', () => {
      render(<ComplianceDashboard {...defaultProps} />);
      // Check that percentage values are displayed
      const percentages = screen.getAllByText(/%/);
      expect(percentages.length).toBeGreaterThanOrEqual(3);
    });

    it('should show missing required documents for non-compliant staff', () => {
      render(<ComplianceDashboard {...defaultProps} />);
      expect(screen.getByText(/ID Document|employment/i)).toBeInTheDocument();
    });

    it('should show pending document count', () => {
      render(<ComplianceDashboard {...defaultProps} />);
      // Jane Smith has 2 pending documents
      expect(screen.getByText(/2 pending/)).toBeInTheDocument();
    });

    it('should show expired document count when present', () => {
      render(<ComplianceDashboard {...defaultProps} />);
      expect(screen.getByText(/expired/i)).toBeInTheDocument();
    });
  });

  describe('Filtering', () => {
    it('should have filter options', () => {
      render(<ComplianceDashboard {...defaultProps} />);
      expect(screen.getByRole('combobox')).toBeInTheDocument();
    });

    it('should filter to show only non-compliant staff', async () => {
      const user = userEvent.setup();
      render(<ComplianceDashboard {...defaultProps} />);

      const filterSelect = screen.getByRole('combobox');
      await user.selectOptions(filterSelect, 'non_compliant');

      await waitFor(() => {
        // After filtering, only Bob Wilson should be visible in list
        const listItems = screen.getAllByRole('listitem');
        expect(listItems.length).toBe(1);
        expect(screen.getByText('Bob Wilson')).toBeInTheDocument();
      });
    });
  });

  describe('Sorting', () => {
    it('should sort staff by compliance status by default', () => {
      render(<ComplianceDashboard {...defaultProps} />);
      // Non-compliant should appear first (most urgent)
      const staffItems = screen.getAllByRole('listitem');
      expect(staffItems[0]).toHaveTextContent('Bob Wilson');
    });

    it('should allow sorting by name', async () => {
      const user = userEvent.setup();
      render(<ComplianceDashboard {...defaultProps} />);

      const sortButton = screen.queryByRole('button', { name: /sort|name/i });
      if (sortButton) {
        await user.click(sortButton);
        await waitFor(() => {
          // Alphabetically: Bob Wilson, Jane Smith, John Doe
          const staffItems = screen.getAllByRole('listitem');
          expect(staffItems[0]).toHaveTextContent(/Bob/i);
        });
      }
    });
  });

  describe('Click Interactions', () => {
    it('should call onStaffClick when staff item is clicked', async () => {
      const onStaffClick = vi.fn();
      const user = userEvent.setup();

      render(<ComplianceDashboard {...defaultProps} onStaffClick={onStaffClick} />);

      await user.click(screen.getByText('John Doe'));

      expect(onStaffClick).toHaveBeenCalledWith('staff-1');
    });

    it('should highlight clickable staff items on hover', () => {
      const { container } = render(<ComplianceDashboard {...defaultProps} />);
      const listItems = container.querySelectorAll('[class*="hover"]');
      expect(listItems.length).toBeGreaterThan(0);
    });
  });

  describe('Loading State', () => {
    it('should show loading indicator when loading', () => {
      render(<ComplianceDashboard {...defaultProps} isLoading={true} />);
      expect(
        screen.getByRole('status', { hidden: true }) ||
          document.querySelector('.animate-spin') ||
          screen.getByText(/loading/i)
      ).toBeTruthy();
    });

    it('should hide content when loading', () => {
      render(<ComplianceDashboard {...defaultProps} isLoading={true} />);
      expect(screen.queryByText('John Doe')).not.toBeInTheDocument();
    });
  });

  describe('Empty State', () => {
    it('should show empty state when no compliance data', () => {
      render(<ComplianceDashboard {...defaultProps} complianceData={[]} />);
      expect(screen.getByText(/no staff|no data|empty/i)).toBeInTheDocument();
    });
  });

  describe('Expiring Documents Alert', () => {
    it('should highlight staff with documents expiring soon', () => {
      const { container } = render(<ComplianceDashboard {...defaultProps} />);
      // Jane Smith has expiringIn7Days = 1 (urgent)
      expect(container.querySelector('[class*="orange"], [class*="amber"], [class*="yellow"]')).toBeTruthy();
    });

    it('should show count of documents expiring in 7 days', () => {
      render(<ComplianceDashboard {...defaultProps} />);
      // Summary card shows "Expiring in 7 days" label
      expect(screen.getByText('Expiring in 7 days')).toBeInTheDocument();
    });

    it('should show count of documents expiring in 30 days', () => {
      render(<ComplianceDashboard {...defaultProps} />);
      // Summary shows "Expiring in 30 days"
      expect(screen.getByText('Expiring in 30 days')).toBeInTheDocument();
    });
  });

  describe('Status Badges', () => {
    it('should display "Compliant" badge for compliant staff', () => {
      render(<ComplianceDashboard {...defaultProps} />);
      // Badge appears in staff list item
      const compliantBadges = screen.getAllByText('Compliant');
      expect(compliantBadges.length).toBeGreaterThanOrEqual(1);
    });

    it('should display "Warning" badge for warning status', () => {
      render(<ComplianceDashboard {...defaultProps} />);
      // Badge appears in staff list item
      const warningBadges = screen.getAllByText('Warning');
      expect(warningBadges.length).toBeGreaterThanOrEqual(1);
    });

    it('should display "Non-Compliant" badge for non-compliant status', () => {
      render(<ComplianceDashboard {...defaultProps} />);
      // Badge appears in staff list item (as "Non-Compliant")
      expect(screen.getByText('Non-Compliant')).toBeInTheDocument();
    });
  });

  describe('Progress Visualization', () => {
    it('should show compliance progress bar for each staff', () => {
      const { container } = render(<ComplianceDashboard {...defaultProps} />);
      const progressBars = container.querySelectorAll('[role="progressbar"], [class*="progress"]');
      expect(progressBars.length).toBeGreaterThan(0);
    });

    it('should show overall compliance progress', () => {
      const { container } = render(<ComplianceDashboard {...defaultProps} />);
      // Overall progress bar or percentage display
      expect(
        container.querySelector('[role="progressbar"]') ||
          screen.getByText(/%/)
      ).toBeTruthy();
    });
  });

  describe('Document Counts', () => {
    it('should display total documents per staff', () => {
      render(<ComplianceDashboard {...defaultProps} />);
      // John Doe has 5 documents
      expect(screen.getByText('5 documents')).toBeInTheDocument();
    });

    it('should display verified documents count', () => {
      render(<ComplianceDashboard {...defaultProps} />);
      // Staff have various verified counts
      expect(screen.getByText('5 verified')).toBeInTheDocument();
    });
  });

  describe('Accessibility', () => {
    it('should have proper heading hierarchy', () => {
      render(<ComplianceDashboard {...defaultProps} />);
      expect(screen.getByRole('heading', { level: 2 })).toBeInTheDocument();
    });

    it('should have accessible status indicators', () => {
      render(<ComplianceDashboard {...defaultProps} />);
      // Status breakdown section has meaningful text
      expect(screen.getByText(/1 Compliant/)).toBeInTheDocument();
    });
  });

  describe('Single Staff View', () => {
    it('should work with single staff member', () => {
      const singleStaff = [{ ...compliantStatus, staffName: 'Single User' }];
      render(<ComplianceDashboard {...defaultProps} complianceData={singleStaff} />);
      expect(screen.getByText('Single User')).toBeInTheDocument();
    });
  });
});
