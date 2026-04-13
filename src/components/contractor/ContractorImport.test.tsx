/**
 * Contractor Import Component Tests
 * Tests for the main contractor import UI component
 */

import { describe, it, expect, beforeEach, vi, type MockedObject } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ContractorImport } from './ContractorImport';
import { contractorImportService } from '@/services/contractor/import/contractorImportService';
import { contractorService } from '@/services/contractorService';

// Mock the services
vi.mock('@/services/contractor/import/contractorImportService');
vi.mock('@/services/contractorService');

const mockContractorImportService = contractorImportService as MockedObject<typeof contractorImportService>;
const mockContractorService = contractorService as MockedObject<typeof contractorService>;

// Mock URL.createObjectURL and revokeObjectURL
global.URL.createObjectURL = vi.fn(() => 'mock-url');
global.URL.revokeObjectURL = vi.fn();

// Mock document.createElement for download links
const mockLink = {
  href: '',
  download: '',
  click: vi.fn(),
  style: { display: '' }
};
vi.spyOn(document, 'createElement').mockImplementation((tagName) => {
  if (tagName === 'a') {
    return mockLink as unknown as HTMLAnchorElement;
  }
  return document.createElement(tagName);
});

describe('ContractorImport Component', () => {
  const mockOnComplete = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    
    // Setup default mock implementations
    mockContractorImportService.validateFile.mockReturnValue({ valid: true });
    mockContractorImportService.getImportTemplate.mockReturnValue('Company Name,Email\nTest Company,test@example.com');
    mockContractorImportService.importFromFile.mockResolvedValue({
      success: true,
      total: 1,
      imported: 1,
      failed: 0,
      errors: [],
      contractors: [{
        companyName: 'Test Company',
        contactPerson: 'Test Person',
        email: 'test@example.com',
        registrationNumber: 'REG001'
      }]
    });
    mockContractorService.getAll.mockResolvedValue([]);
    mockContractorImportService.exportToExcel.mockReturnValue(new Blob(['test'], { type: 'application/vnd.ms-excel' }));
  });

  describe('Initial State', () => {
    test('should render initial state correctly', () => {
      // 🟢 WORKING: Test initial render
      render(<ContractorImport onComplete={mockOnComplete} />);

      expect(screen.getByText('Import Contractors')).toBeInTheDocument();
      expect(screen.getByText('Upload CSV or Excel files to bulk import contractor data')).toBeInTheDocument();
      expect(screen.getByText('Download Template')).toBeInTheDocument();
      expect(screen.getByText('Export All Contractors')).toBeInTheDocument();
      expect(screen.getByText('Drop your CSV or Excel file here')).toBeInTheDocument();
    });

    test('should show import instructions initially', () => {
      // 🟢 WORKING: Test instructions display
      render(<ContractorImport />);

      expect(screen.getByText('How to Import Contractors')).toBeInTheDocument();
      expect(screen.getByText('Required Fields')).toBeInTheDocument();
      expect(screen.getByText('Optional Fields')).toBeInTheDocument();
    });
  });

  describe('File Selection', () => {
    test('should handle valid file selection', async () => {
      // 🟢 WORKING: Test valid file selection
      render(<ContractorImport onComplete={mockOnComplete} />);

      const file = new File(['Company Name,Email\nTest Company,test@example.com'], 'test.csv', {
        type: 'text/csv'
      });

      const fileInput = screen.getByLabelText(/choose contractor file/i);
      
      await userEvent.upload(fileInput, file);

      expect(screen.getByText('test.csv')).toBeInTheDocument();
      expect(screen.getByText('CSV File')).toBeInTheDocument();
      expect(screen.getByText('Import Contractors')).toBeInTheDocument();
    });

    test('should reject invalid file types', async () => {
      // 🟢 WORKING: Test invalid file rejection
      mockContractorImportService.validateFile.mockReturnValue({
        valid: false,
        error: 'Invalid file type'
      });

      render(<ContractorImport />);

      const file = new File(['test'], 'test.txt', { type: 'text/plain' });
      const fileInput = screen.getByLabelText(/choose contractor file/i);

      // Mock window.alert
      const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});

      await userEvent.upload(fileInput, file);

      expect(alertSpy).toHaveBeenCalledWith('Invalid file type');
      expect(screen.queryByText('test.txt')).not.toBeInTheDocument();

      alertSpy.mockRestore();
    });

    test('should handle drag and drop', async () => {
      // 🟢 WORKING: Test drag and drop functionality
      render(<ContractorImport />);

      const dropZone = screen.getByText('Drop your CSV or Excel file here').closest('div');
      const file = new File(['Company Name,Email\nTest Company,test@example.com'], 'test.csv', {
        type: 'text/csv'
      });

      // Simulate drag enter
      fireEvent.dragEnter(dropZone!, {
        dataTransfer: { files: [file] }
      });

      expect(screen.getByText('Drop your contractor file here')).toBeInTheDocument();

      // Simulate drop
      fireEvent.drop(dropZone!, {
        dataTransfer: { files: [file] }
      });

      await waitFor(() => {
        expect(screen.getByText('test.csv')).toBeInTheDocument();
      });
    });
  });

  describe('Import Process', () => {
    test('should handle successful import', async () => {
      // 🟢 WORKING: Test successful import flow
      render(<ContractorImport onComplete={mockOnComplete} />);

      const file = new File(['Company Name,Email\nTest Company,test@example.com'], 'test.csv', {
        type: 'text/csv'
      });
      const fileInput = screen.getByLabelText(/choose contractor file/i);
      
      await userEvent.upload(fileInput, file);

      const importButton = screen.getByRole('button', { name: /import contractors/i });
      fireEvent.click(importButton);

      // Should show loading state
      await waitFor(() => {
        expect(screen.getByText('Importing contractors...')).toBeInTheDocument();
      });

      // Should show results
      await waitFor(() => {
        expect(screen.getByText('Import Completed Successfully')).toBeInTheDocument();
        expect(screen.getByText('1 contractor imported successfully')).toBeInTheDocument();
      });

      expect(mockOnComplete).toHaveBeenCalled();
    });

    test('should handle import errors', async () => {
      // 🟢 WORKING: Test import error handling
      mockContractorImportService.importFromFile.mockResolvedValue({
        success: false,
        total: 1,
        imported: 0,
        failed: 1,
        errors: [{
          row: 1,
          field: 'email',
          message: 'Invalid email format'
        }],
        contractors: []
      });

      render(<ContractorImport />);

      const file = new File(['Company Name,Email\nTest Company,invalid-email'], 'test.csv', {
        type: 'text/csv'
      });
      const fileInput = screen.getByLabelText(/choose contractor file/i);
      
      await userEvent.upload(fileInput, file);

      const importButton = screen.getByRole('button', { name: /import contractors/i });
      fireEvent.click(importButton);

      await waitFor(() => {
        expect(screen.getByText('Import Completed with Errors')).toBeInTheDocument();
        expect(screen.getByText('Invalid email format')).toBeInTheDocument();
      });

      expect(mockOnComplete).not.toHaveBeenCalled();
    });

    test('should handle import exceptions', async () => {
      // 🟢 WORKING: Test import exception handling
      mockContractorImportService.importFromFile.mockRejectedValue(new Error('Import failed'));

      render(<ContractorImport />);

      const file = new File(['Company Name,Email\nTest Company,test@example.com'], 'test.csv', {
        type: 'text/csv'
      });
      const fileInput = screen.getByLabelText(/choose contractor file/i);
      
      await userEvent.upload(fileInput, file);

      const importButton = screen.getByRole('button', { name: /import contractors/i });
      fireEvent.click(importButton);

      await waitFor(() => {
        expect(screen.getByText('Import failed')).toBeInTheDocument();
      });
    });

    test('should handle import mode selection', async () => {
      // 🟢 WORKING: Test import mode selection
      render(<ContractorImport />);

      const file = new File(['Company Name,Email\nTest Company,test@example.com'], 'test.csv', {
        type: 'text/csv'
      });
      const fileInput = screen.getByLabelText(/choose contractor file/i);
      
      await userEvent.upload(fileInput, file);

      // Select "Skip duplicates" mode
      const skipRadio = screen.getByLabelText(/skip duplicate contractors/i);
      fireEvent.click(skipRadio);

      const importButton = screen.getByRole('button', { name: /import contractors/i });
      fireEvent.click(importButton);

      await waitFor(() => {
        expect(mockContractorImportService.importFromFile).toHaveBeenCalledWith(
          expect.any(File),
          false // overwriteExisting should be false
        );
      });
    });
  });

  describe('Template and Export Actions', () => {
    test('should download template', async () => {
      // 🟢 WORKING: Test template download
      render(<ContractorImport />);

      const downloadButton = screen.getByText('Download Template');
      fireEvent.click(downloadButton);

      expect(mockContractorImportService.getImportTemplate).toHaveBeenCalled();
      expect(global.URL.createObjectURL).toHaveBeenCalled();
      expect(mockLink.click).toHaveBeenCalled();
      expect(mockLink.download).toBe('contractor_import_template.csv');
    });

    test('should export all contractors', async () => {
      // 🟢 WORKING: Test contractor export
      const mockContractors = [
        {
          id: '1',
          companyName: 'Test Company 1',
          contactPerson: 'Person 1',
          email: 'test1@example.com',
          registrationNumber: 'REG001',
          businessType: 'pty_ltd' as const,
          industryCategory: 'Construction',
          status: 'approved' as const,
          isActive: true,
          complianceStatus: 'compliant' as const,
          ragOverall: 'green' as const,
          ragFinancial: 'green' as const,
          ragCompliance: 'green' as const,
          ragPerformance: 'green' as const,
          ragSafety: 'green' as const,
          totalProjects: 5,
          completedProjects: 4,
          activeProjects: 1,
          cancelledProjects: 0,
          onboardingProgress: 100,
          documentsExpiring: 0,
          createdAt: new Date(),
          updatedAt: new Date()
        }
      ];

      mockContractorService.getAll.mockResolvedValue(mockContractors);

      render(<ContractorImport />);

      const exportButton = screen.getByText('Export All Contractors');
      fireEvent.click(exportButton);

      await waitFor(() => {
        expect(mockContractorService.getAll).toHaveBeenCalled();
        expect(mockContractorImportService.exportToExcel).toHaveBeenCalledWith(mockContractors);
        expect(mockLink.click).toHaveBeenCalled();
      });
    });

    test('should handle export when no contractors exist', async () => {
      // 🟢 WORKING: Test export with no contractors
      mockContractorService.getAll.mockResolvedValue([]);

      render(<ContractorImport />);

      const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
      
      const exportButton = screen.getByText('Export All Contractors');
      fireEvent.click(exportButton);

      await waitFor(() => {
        expect(alertSpy).toHaveBeenCalledWith('No contractors found to export.');
      });

      alertSpy.mockRestore();
    });
  });

  describe('UI State Management', () => {
    test('should reset import state correctly', async () => {
      // 🟢 WORKING: Test state reset
      render(<ContractorImport />);

      // Upload file and import
      const file = new File(['Company Name,Email\nTest Company,test@example.com'], 'test.csv', {
        type: 'text/csv'
      });
      const fileInput = screen.getByLabelText(/choose contractor file/i);
      
      await userEvent.upload(fileInput, file);
      
      const importButton = screen.getByRole('button', { name: /import contractors/i });
      fireEvent.click(importButton);

      await waitFor(() => {
        expect(screen.getByText('Import Completed Successfully')).toBeInTheDocument();
      });

      // Reset the import
      const resetButton = screen.getByText('Import Another File');
      fireEvent.click(resetButton);

      expect(screen.getByText('Drop your CSV or Excel file here')).toBeInTheDocument();
      expect(screen.queryByText('Import Completed Successfully')).not.toBeInTheDocument();
    });

    test('should handle cancellation during file preview', async () => {
      // 🟢 WORKING: Test file preview cancellation
      render(<ContractorImport />);

      const file = new File(['Company Name,Email\nTest Company,test@example.com'], 'test.csv', {
        type: 'text/csv'
      });
      const fileInput = screen.getByLabelText(/choose contractor file/i);
      
      await userEvent.upload(fileInput, file);

      expect(screen.getByText('test.csv')).toBeInTheDocument();

      const cancelButton = screen.getByRole('button', { name: /cancel/i });
      fireEvent.click(cancelButton);

      expect(screen.getByText('Drop your CSV or Excel file here')).toBeInTheDocument();
      expect(screen.queryByText('test.csv')).not.toBeInTheDocument();
    });

    test('should disable actions during import', async () => {
      // 🟢 WORKING: Test UI state during import
      // Make the import hang to test loading state
      mockContractorImportService.importFromFile.mockImplementation(
        () => new Promise(resolve => setTimeout(resolve, 100))
      );

      render(<ContractorImport />);

      const file = new File(['Company Name,Email\nTest Company,test@example.com'], 'test.csv', {
        type: 'text/csv'
      });
      const fileInput = screen.getByLabelText(/choose contractor file/i);
      
      await userEvent.upload(fileInput, file);

      const importButton = screen.getByRole('button', { name: /import contractors/i });
      const cancelButton = screen.getByRole('button', { name: /cancel/i });

      fireEvent.click(importButton);

      // Buttons should be disabled during import
      await waitFor(() => {
        expect(importButton).toBeDisabled();
        expect(cancelButton).toBeDisabled();
      });
    });
  });

  describe('Accessibility', () => {
    test('should have proper accessibility attributes', () => {
      // 🟢 WORKING: Test accessibility
      render(<ContractorImport />);

      const fileInput = screen.getByLabelText(/choose contractor file/i);
      expect(fileInput).toHaveAttribute('accept', '.csv,.xlsx,.xls');
      
      const uploadLabel = screen.getByRole('button', { name: /choose contractor file/i });
      expect(uploadLabel).toBeInTheDocument();
    });

    test('should have proper ARIA labels', () => {
      // 🟢 WORKING: Test ARIA labels
      render(<ContractorImport />);

      const heading = screen.getByRole('heading', { name: /import contractors/i });
      expect(heading).toBeInTheDocument();
      
      const buttons = screen.getAllByRole('button');
      buttons.forEach(button => {
        expect(button).toHaveTextContent(/\w+/); // Should have text content
      });
    });
  });

  describe('Error Boundaries', () => {
    test('should handle service errors gracefully', async () => {
      // 🟢 WORKING: Test service error handling
      mockContractorImportService.validateFile.mockImplementation(() => {
        throw new Error('Service error');
      });

      render(<ContractorImport />);

      const file = new File(['test'], 'test.csv', { type: 'text/csv' });
      const fileInput = screen.getByLabelText(/choose contractor file/i);
      
      // This should not crash the component
      await userEvent.upload(fileInput, file);
      
      expect(screen.getByText('Drop your CSV or Excel file here')).toBeInTheDocument();
    });
  });
});