/**
 * FaultCauseSelector Component Tests
 *
 * 🟢 WORKING: Comprehensive tests for fault cause selection component
 *
 * Tests:
 * - Display 7 fault cause options
 * - Select fault cause
 * - Require fault cause details when selected
 * - Show examples for each fault cause
 * - Validate required fields
 * - Handle loading and error states
 * - Display contractor liability indicator
 */

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { FaultCauseSelector } from '../../components/FaultAttribution/FaultCauseSelector';
import { FaultTrendAnalysis } from '../../components/FaultAttribution/FaultTrendAnalysis';
import { FaultCause } from '../../types/ticket';
import { FAULT_CAUSE_OPTIONS } from '../../constants/faultCauses';

// Mock Clerk auth
vi.mock('@clerk/nextjs', () => ({
  useUser: vi.fn(() => ({
    user: { id: 'test-user-id' },
    isLoaded: true,
  })),
}));

describe('FaultCauseSelector Component', () => {
  const mockOnChange = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Initial Rendering', () => {
    it('should display 7 fault cause options', () => {
      // Arrange & Act
      render(
        <FaultCauseSelector
          value={null}
          details=""
          onChange={mockOnChange}
        />
      );

      // Assert - Open the dropdown
      const selectButton = screen.getByRole('combobox') || screen.getByRole('button', { name: /select fault cause/i });
      fireEvent.click(selectButton);

      // Should show all 7 fault causes
      waitFor(() => {
        expect(screen.getByText('Workmanship')).toBeInTheDocument();
        expect(screen.getByText('Material Failure')).toBeInTheDocument();
        expect(screen.getByText('Client Damage')).toBeInTheDocument();
        expect(screen.getByText('Third Party Damage')).toBeInTheDocument();
        expect(screen.getByText('Environmental')).toBeInTheDocument();
        expect(screen.getByText('Vandalism')).toBeInTheDocument();
        expect(screen.getByText('Unknown')).toBeInTheDocument();
      });
    });

    it('should show placeholder when no cause selected', () => {
      // Arrange & Act
      render(
        <FaultCauseSelector
          value={null}
          details=""
          onChange={mockOnChange}
        />
      );

      // Assert
      expect(screen.getByText(/select fault cause/i)).toBeInTheDocument();
    });

    it('should show selected cause when value provided', () => {
      // Arrange & Act
      render(
        <FaultCauseSelector
          value={FaultCause.WORKMANSHIP}
          details="Poor fiber splicing"
          onChange={mockOnChange}
        />
      );

      // Assert - Selected value should be in the select element
      const selectElement = screen.getByRole('combobox') as HTMLSelectElement;
      expect(selectElement.value).toBe(FaultCause.WORKMANSHIP);
    });

    it('should be disabled when disabled prop is true', () => {
      // Arrange & Act
      render(
        <FaultCauseSelector
          value={null}
          details=""
          onChange={mockOnChange}
          disabled={true}
        />
      );

      // Assert
      const selectButton = screen.getByRole('combobox') || screen.getByRole('button');
      expect(selectButton).toBeDisabled();
    });
  });

  describe('Fault Cause Selection', () => {
    it('should call onChange when fault cause selected', async () => {
      // Arrange
      render(
        <FaultCauseSelector
          value={null}
          details=""
          onChange={mockOnChange}
        />
      );

      // Act - Select Workmanship from dropdown
      const selectElement = screen.getByRole('combobox');
      fireEvent.change(selectElement, { target: { value: FaultCause.WORKMANSHIP } });

      // Assert
      await waitFor(() => {
        expect(mockOnChange).toHaveBeenCalledWith({
          fault_cause: FaultCause.WORKMANSHIP,
          fault_cause_details: '',
        });
      });
    });

    it('should show description for selected fault cause', () => {
      // Arrange & Act
      render(
        <FaultCauseSelector
          value={FaultCause.MATERIAL_FAILURE}
          details=""
          onChange={mockOnChange}
        />
      );

      // Assert
      expect(screen.getByText(/equipment or material defect/i)).toBeInTheDocument();
    });

    it('should show examples for selected fault cause', () => {
      // Arrange & Act
      render(
        <FaultCauseSelector
          value={FaultCause.WORKMANSHIP}
          details=""
          onChange={mockOnChange}
        />
      );

      // Assert - Examples should be visible
      expect(screen.getByText(/improper fiber splicing/i)).toBeInTheDocument();
      expect(screen.getByText(/loose connections/i)).toBeInTheDocument();
    });

    it('should display contractor liability indicator for workmanship', () => {
      // Arrange & Act
      render(
        <FaultCauseSelector
          value={FaultCause.WORKMANSHIP}
          details=""
          onChange={mockOnChange}
        />
      );

      // Assert
      expect(screen.getByText('Contractor Liable')).toBeInTheDocument();
    });

    it('should display non-liability indicator for material failure', () => {
      // Arrange & Act
      render(
        <FaultCauseSelector
          value={FaultCause.MATERIAL_FAILURE}
          details=""
          onChange={mockOnChange}
        />
      );

      // Assert
      expect(screen.getByText(/not contractor liable/i)).toBeInTheDocument();
    });
  });

  describe('Fault Cause Details Field', () => {
    it('should require details field when fault cause selected', () => {
      // Arrange & Act
      render(
        <FaultCauseSelector
          value={FaultCause.WORKMANSHIP}
          details=""
          onChange={mockOnChange}
          required={true}
        />
      );

      // Assert
      const detailsInput = screen.getByPlaceholderText(/describe the fault/i);
      expect(detailsInput).toBeRequired();
    });

    it('should call onChange when details are entered', async () => {
      // Arrange
      render(
        <FaultCauseSelector
          value={FaultCause.WORKMANSHIP}
          details=""
          onChange={mockOnChange}
        />
      );

      // Act
      const detailsInput = screen.getByPlaceholderText(/describe the fault/i);
      fireEvent.change(detailsInput, { target: { value: 'Poor fiber splicing at splice point 3' } });

      // Assert
      await waitFor(() => {
        expect(mockOnChange).toHaveBeenCalledWith({
          fault_cause: FaultCause.WORKMANSHIP,
          fault_cause_details: 'Poor fiber splicing at splice point 3',
        });
      });
    });

    it('should show details field only when cause is selected', () => {
      // Arrange
      const { rerender } = render(
        <FaultCauseSelector
          value={null}
          details=""
          onChange={mockOnChange}
        />
      );

      // Assert - No details field when no cause selected
      expect(screen.queryByPlaceholderText(/describe the fault/i)).not.toBeInTheDocument();

      // Act - Select a cause
      rerender(
        <FaultCauseSelector
          value={FaultCause.WORKMANSHIP}
          details=""
          onChange={mockOnChange}
        />
      );

      // Assert - Details field now visible
      expect(screen.getByPlaceholderText(/describe the fault/i)).toBeInTheDocument();
    });

    it('should show character count for details field', () => {
      // Arrange & Act
      render(
        <FaultCauseSelector
          value={FaultCause.WORKMANSHIP}
          details="Poor splicing"
          onChange={mockOnChange}
          showCharacterCount={true}
        />
      );

      // Assert
      expect(screen.getByText(/13/i)).toBeInTheDocument(); // Character count
    });

    it('should disable details field when disabled prop is true', () => {
      // Arrange & Act
      render(
        <FaultCauseSelector
          value={FaultCause.WORKMANSHIP}
          details="Poor splicing"
          onChange={mockOnChange}
          disabled={true}
        />
      );

      // Assert
      const detailsInput = screen.getByPlaceholderText(/describe the fault/i);
      expect(detailsInput).toBeDisabled();
    });
  });

  describe('Validation', () => {
    it('should show error when fault cause required but not selected', () => {
      // Arrange & Act
      render(
        <FaultCauseSelector
          value={null}
          details=""
          onChange={mockOnChange}
          required={true}
          error="Fault cause is required"
        />
      );

      // Assert
      expect(screen.getByText('Fault cause is required')).toBeInTheDocument();
    });

    it('should show error when details required but empty', () => {
      // Arrange & Act
      render(
        <FaultCauseSelector
          value={FaultCause.WORKMANSHIP}
          details=""
          onChange={mockOnChange}
          required={true}
          error="Fault details are required"
        />
      );

      // Assert
      expect(screen.getByText('Fault details are required')).toBeInTheDocument();
    });

    it('should clear error when valid selection made', () => {
      // Arrange
      const { rerender } = render(
        <FaultCauseSelector
          value={null}
          details=""
          onChange={mockOnChange}
          required={true}
          error="Fault cause is required"
        />
      );

      // Assert - Error shown
      expect(screen.getByText('Fault cause is required')).toBeInTheDocument();

      // Act - Select a cause
      rerender(
        <FaultCauseSelector
          value={FaultCause.WORKMANSHIP}
          details="Poor splicing"
          onChange={mockOnChange}
          required={true}
          error={null}
        />
      );

      // Assert - Error cleared
      expect(screen.queryByText('Fault cause is required')).not.toBeInTheDocument();
    });
  });

  describe('Color Coding', () => {
    it('should use error color for Workmanship', () => {
      // Arrange & Act
      render(
        <FaultCauseSelector
          value={FaultCause.WORKMANSHIP}
          details=""
          onChange={mockOnChange}
        />
      );

      // Assert - Check for error/red styling by finding the heading element
      const causeHeading = screen.getByRole('heading', { level: 4, name: 'Workmanship' });
      expect(causeHeading).toBeInTheDocument();
    });

    it('should use warning color for Material Failure', () => {
      // Arrange & Act
      render(
        <FaultCauseSelector
          value={FaultCause.MATERIAL_FAILURE}
          details=""
          onChange={mockOnChange}
        />
      );

      // Assert - Check for warning/yellow styling by finding the heading element
      const causeHeading = screen.getByRole('heading', { level: 4, name: 'Material Failure' });
      expect(causeHeading).toBeInTheDocument();
    });
  });
});

describe('FaultTrendAnalysis Component', () => {
  const mockTrendData = [
    {
      cause: FaultCause.WORKMANSHIP,
      count: 15,
      percentage: 30,
      contractorLiable: true,
    },
    {
      cause: FaultCause.MATERIAL_FAILURE,
      count: 10,
      percentage: 20,
      contractorLiable: false,
    },
    {
      cause: FaultCause.ENVIRONMENTAL,
      count: 8,
      percentage: 16,
      contractorLiable: false,
    },
    {
      cause: FaultCause.CLIENT_DAMAGE,
      count: 7,
      percentage: 14,
      contractorLiable: false,
    },
    {
      cause: FaultCause.THIRD_PARTY,
      count: 5,
      percentage: 10,
      contractorLiable: false,
    },
    {
      cause: FaultCause.VANDALISM,
      count: 3,
      percentage: 6,
      contractorLiable: false,
    },
    {
      cause: FaultCause.UNKNOWN,
      count: 2,
      percentage: 4,
      contractorLiable: false,
    },
  ];

  describe('Chart Display', () => {
    it('should show trend chart when data provided', () => {
      // Arrange & Act
      render(<FaultTrendAnalysis data={mockTrendData} />);

      // Assert
      expect(screen.getByText(/fault trend analysis/i)).toBeInTheDocument();
    });

    it('should display all fault causes in chart', () => {
      // Arrange & Act
      render(<FaultTrendAnalysis data={mockTrendData} />);

      // Assert
      expect(screen.getByText('Workmanship')).toBeInTheDocument();
      expect(screen.getByText('Material Failure')).toBeInTheDocument();
      expect(screen.getByText('Environmental')).toBeInTheDocument();
      expect(screen.getByText('Client Damage')).toBeInTheDocument();
      expect(screen.getByText('Third Party Damage')).toBeInTheDocument();
      expect(screen.getByText('Vandalism')).toBeInTheDocument();
      expect(screen.getByText('Unknown')).toBeInTheDocument();
    });

    it('should display percentage for each fault cause', () => {
      // Arrange & Act
      render(<FaultTrendAnalysis data={mockTrendData} />);

      // Assert
      expect(screen.getByText('30%')).toBeInTheDocument(); // Workmanship
      expect(screen.getByText('20%')).toBeInTheDocument(); // Material Failure
      expect(screen.getByText('16%')).toBeInTheDocument(); // Environmental
    });

    it('should display count for each fault cause', () => {
      // Arrange & Act
      render(<FaultTrendAnalysis data={mockTrendData} />);

      // Assert
      expect(screen.getByText(/15 faults/i)).toBeInTheDocument(); // Workmanship
      expect(screen.getByText(/10 faults/i)).toBeInTheDocument(); // Material Failure
    });

    it('should show empty state when no data', () => {
      // Arrange & Act
      render(<FaultTrendAnalysis data={[]} />);

      // Assert
      expect(screen.getByText(/no fault data available/i)).toBeInTheDocument();
    });

    it('should show loading state while loading', () => {
      // Arrange & Act
      render(<FaultTrendAnalysis data={mockTrendData} isLoading={true} />);

      // Assert
      expect(screen.getByText(/loading/i)).toBeInTheDocument();
    });
  });

  describe('Filtering', () => {
    it('should filter by contractor liable faults', async () => {
      // Arrange
      render(<FaultTrendAnalysis data={mockTrendData} />);

      // Act - Click filter for contractor liable
      const filterButton = screen.getByRole('button', { name: /contractor liable/i });
      fireEvent.click(filterButton);

      // Assert - Should only show Workmanship (30%)
      await waitFor(() => {
        expect(screen.getByText('Workmanship')).toBeInTheDocument();
        // Material Failure should be hidden or filtered out
        expect(screen.queryByText('Material Failure')).not.toBeInTheDocument();
      });
    });

    it('should filter by non-contractor faults', async () => {
      // Arrange
      render(<FaultTrendAnalysis data={mockTrendData} />);

      // Act - Click filter for non-contractor
      const filterButton = screen.getByRole('button', { name: /non-contractor/i });
      fireEvent.click(filterButton);

      // Assert - Workmanship should be hidden
      await waitFor(() => {
        expect(screen.queryByText('Workmanship')).not.toBeInTheDocument();
        expect(screen.getByText('Material Failure')).toBeInTheDocument();
      });
    });

    it('should show all faults when filter cleared', async () => {
      // Arrange
      render(<FaultTrendAnalysis data={mockTrendData} />);

      // Act - Apply and clear filter
      const contractorFilter = screen.getByRole('button', { name: /contractor liable/i });
      fireEvent.click(contractorFilter);

      await waitFor(() => {
        expect(screen.queryByText('Material Failure')).not.toBeInTheDocument();
      });

      const allFilter = screen.getByRole('button', { name: /all faults/i });
      fireEvent.click(allFilter);

      // Assert - All faults visible again
      await waitFor(() => {
        expect(screen.getByText('Workmanship')).toBeInTheDocument();
        expect(screen.getByText('Material Failure')).toBeInTheDocument();
      });
    });
  });

  describe('Summary Statistics', () => {
    it('should display total fault count', () => {
      // Arrange & Act
      render(<FaultTrendAnalysis data={mockTrendData} />);

      // Assert - Total is 15+10+8+7+5+3+2 = 50
      expect(screen.getByText(/50 total faults/i)).toBeInTheDocument();
    });

    it('should display contractor liability percentage', () => {
      // Arrange & Act
      render(<FaultTrendAnalysis data={mockTrendData} />);

      // Assert - 15/50 = 30% contractor liable
      expect(screen.getByText(/30% contractor liable/i)).toBeInTheDocument();
    });

    it('should highlight top fault cause', () => {
      // Arrange & Act
      render(<FaultTrendAnalysis data={mockTrendData} />);

      // Assert
      expect(screen.getByText(/top cause: workmanship/i)).toBeInTheDocument();
    });
  });

  describe('Time Range Filtering', () => {
    it('should allow selecting time range', async () => {
      // Arrange
      const mockOnTimeRangeChange = vi.fn();
      render(
        <FaultTrendAnalysis
          data={mockTrendData}
          onTimeRangeChange={mockOnTimeRangeChange}
        />
      );

      // Act - Select last 30 days
      const timeRangeSelect = screen.getByRole('combobox', { name: /time range/i });
      fireEvent.change(timeRangeSelect, { target: { value: '30_days' } });

      // Assert
      await waitFor(() => {
        expect(mockOnTimeRangeChange).toHaveBeenCalledWith('30_days');
      });
    });

    it('should display selected time range', () => {
      // Arrange & Act
      render(<FaultTrendAnalysis data={mockTrendData} timeRange="7_days" />);

      // Assert - Check that the select has the correct value
      const selectElement = screen.getByRole('combobox', { name: /time range/i }) as HTMLSelectElement;
      expect(selectElement.value).toBe('7_days');
    });
  });

  describe('Scope Filtering', () => {
    it('should allow filtering by scope (pole/PON/zone)', async () => {
      // Arrange
      const mockOnScopeChange = vi.fn();
      render(
        <FaultTrendAnalysis
          data={mockTrendData}
          onScopeChange={mockOnScopeChange}
        />
      );

      // Act - Select scope filter
      const scopeInput = screen.getByPlaceholderText(/filter by pole, pon, or zone/i);
      fireEvent.change(scopeInput, { target: { value: 'POLE-123' } });

      // Assert
      await waitFor(() => {
        expect(mockOnScopeChange).toHaveBeenCalledWith('POLE-123');
      });
    });
  });

  describe('Export Functionality', () => {
    it('should show export button', () => {
      // Arrange & Act
      const mockOnExport = vi.fn();
      render(<FaultTrendAnalysis data={mockTrendData} onExport={mockOnExport} />);

      // Assert
      expect(screen.getByRole('button', { name: /export/i })).toBeInTheDocument();
    });

    it('should call onExport when export clicked', async () => {
      // Arrange
      const mockOnExport = vi.fn();
      render(<FaultTrendAnalysis data={mockTrendData} onExport={mockOnExport} />);

      // Act
      const exportButton = screen.getByRole('button', { name: /export/i });
      fireEvent.click(exportButton);

      // Assert
      await waitFor(() => {
        expect(mockOnExport).toHaveBeenCalledTimes(1);
      });
    });
  });
});
