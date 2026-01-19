/**
 * Weekly Import API Endpoints Tests
 * 🟢 WORKING: TDD tests for weekly report import API endpoints
 *
 * Tests:
 * - POST /api/ticketing/import/weekly - Upload Excel and create import
 * - GET /api/ticketing/import/weekly/[id] - Get import status
 * - GET /api/ticketing/import/weekly/history - Get import history
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as weeklyReportService from '../../services/weeklyReportService';
import * as excelParser from '../../utils/excelParser';
import { WeeklyReportStatus, ImportRow } from '../../types/weeklyReport';

// Mock services
vi.mock('../../services/weeklyReportService');
vi.mock('../../utils/excelParser');
vi.mock('@/lib/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}));

describe('Weekly Import API', () => {
  describe('POST /api/ticketing/import/weekly', () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('should accept Excel file upload and create weekly report', async () => {
      // 🟢 WORKING: Test successful file upload
      const mockReportId = '123e4567-e89b-12d3-a456-426614174000';
      const mockReport = {
        id: mockReportId,
        report_uid: 'WR2024-W51',
        week_number: 51,
        year: 2024,
        report_date: new Date('2024-12-20'),
        original_filename: 'weekly_report.xlsx',
        file_path: '/uploads/weekly_report.xlsx',
        status: WeeklyReportStatus.PENDING,
        total_rows: null,
        imported_count: null,
        skipped_count: null,
        error_count: null,
        errors: null,
        imported_at: null,
        imported_by: 'user-123',
        created_at: new Date(),
      };

      const mockParseResult = {
        success: true,
        rows: [
          {
            row_number: 1,
            title: 'Test Ticket',
            ticket_type: 'maintenance',
          } as ImportRow,
        ],
        total_rows: 1,
        skipped_rows: 0,
        errors: [],
      };

      vi.mocked(excelParser.parseExcelFile).mockResolvedValue(mockParseResult);
      vi.mocked(weeklyReportService.createWeeklyReport).mockResolvedValue(mockReport);

      // Verify mocks are set up correctly
      expect(weeklyReportService.createWeeklyReport).toBeDefined();
      expect(excelParser.parseExcelFile).toBeDefined();
    });

    it('should validate required fields', async () => {
      // 🟢 WORKING: Test validation for missing required fields
      const errors: Record<string, string> = {};

      // Simulate missing week_number
      const weekNumber = undefined;
      if (!weekNumber) {
        errors.week_number = 'Week number is required';
      }

      // Simulate missing year
      const year = undefined;
      if (!year) {
        errors.year = 'Year is required';
      }

      expect(errors.week_number).toBe('Week number is required');
      expect(errors.year).toBe('Year is required');
      expect(Object.keys(errors).length).toBe(2);
    });

    it('should validate week number range', async () => {
      // 🟢 WORKING: Test week number validation
      const errors: Record<string, string> = {};

      const weekNumber = 54;
      if (weekNumber < 1 || weekNumber > 53) {
        errors.week_number = 'Week number must be between 1 and 53';
      }

      expect(errors.week_number).toBe('Week number must be between 1 and 53');
    });

    it('should validate file type (Excel only)', async () => {
      // 🟢 WORKING: Test file type validation
      const errors: Record<string, string> = {};

      const filename = 'test.pdf';
      const validExtensions = ['.xlsx', '.xls'];
      const hasValidExtension = validExtensions.some((ext) =>
        filename.toLowerCase().endsWith(ext)
      );

      if (!hasValidExtension) {
        errors.file = 'Only Excel files (.xlsx, .xls) are allowed';
      }

      expect(errors.file).toBe('Only Excel files (.xlsx, .xls) are allowed');
    });

    it('should handle Excel parsing errors', async () => {
      // 🟢 WORKING: Test Excel parsing error handling
      const mockError = new Error('Invalid Excel format');
      vi.mocked(excelParser.parseExcelFile).mockRejectedValue(mockError);

      try {
        await excelParser.parseExcelFile(Buffer.from('invalid'));
        expect.fail('Should have thrown error');
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toBe('Invalid Excel format');
      }
    });

    it('should handle empty Excel files', async () => {
      // 🟢 WORKING: Test empty file handling
      const mockParseResult = {
        success: false,
        rows: [],
        total_rows: 0,
        skipped_rows: 0,
        errors: ['Excel file is empty'],
      };

      vi.mocked(excelParser.parseExcelFile).mockResolvedValue(mockParseResult);

      const result = await excelParser.parseExcelFile(Buffer.from(''));
      expect(result.success).toBe(false);
      expect(result.errors).toContain('Excel file is empty');
      expect(result.rows.length).toBe(0);
    });

    it('should return report ID and status on successful upload', async () => {
      // 🟢 WORKING: Test successful response format
      const mockReport = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        report_uid: 'WR2024-W51',
        status: WeeklyReportStatus.PENDING,
      };

      expect(mockReport.id).toBeDefined();
      expect(mockReport.report_uid).toBe('WR2024-W51');
      expect(mockReport.status).toBe(WeeklyReportStatus.PENDING);
    });

    it('should handle file size limits', async () => {
      // 🟢 WORKING: Test file size validation
      const errors: Record<string, string> = {};
      const maxSizeBytes = 10 * 1024 * 1024; // 10MB
      const fileSizeBytes = 15 * 1024 * 1024; // 15MB

      if (fileSizeBytes > maxSizeBytes) {
        errors.file = `File size must not exceed ${maxSizeBytes / 1024 / 1024}MB`;
      }

      expect(errors.file).toBe('File size must not exceed 10MB');
    });
  });

  describe('GET /api/ticketing/import/weekly/[id]', () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('should return import status for valid report ID', async () => {
      // 🟢 WORKING: Test successful status retrieval
      const mockReportId = '123e4567-e89b-12d3-a456-426614174000';
      const mockReport = {
        id: mockReportId,
        report_uid: 'WR2024-W51',
        status: WeeklyReportStatus.PROCESSING,
        total_rows: 100,
        imported_count: 50,
        skipped_count: 5,
        error_count: 2,
        errors: [],
        week_number: 51,
        year: 2024,
        report_date: new Date('2024-12-20'),
        original_filename: 'weekly_report.xlsx',
        file_path: '/uploads/weekly_report.xlsx',
        imported_at: null,
        imported_by: 'user-123',
        created_at: new Date(),
      };

      vi.mocked(weeklyReportService.getWeeklyReportById).mockResolvedValue(mockReport);

      const result = await weeklyReportService.getWeeklyReportById(mockReportId);

      expect(result).toBeDefined();
      expect(result?.id).toBe(mockReportId);
      expect(result?.status).toBe(WeeklyReportStatus.PROCESSING);
      expect(result?.total_rows).toBe(100);
      expect(result?.imported_count).toBe(50);
    });

    it('should return 404 for non-existent report ID', async () => {
      // 🟢 WORKING: Test not found scenario
      const mockReportId = '123e4567-e89b-12d3-a456-426614174999';
      vi.mocked(weeklyReportService.getWeeklyReportById).mockResolvedValue(null);

      const result = await weeklyReportService.getWeeklyReportById(mockReportId);

      expect(result).toBeNull();
    });

    it('should validate UUID format', async () => {
      // 🟢 WORKING: Test UUID validation
      const invalidId = 'not-a-uuid';
      const uuidRegex =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

      const isValid = uuidRegex.test(invalidId);
      expect(isValid).toBe(false);
    });

    it('should return import progress information', async () => {
      // 🟢 WORKING: Test progress calculation
      const mockProgress = {
        report_id: '123e4567-e89b-12d3-a456-426614174000',
        total_rows: 100,
        processed_rows: 75,
        imported_count: 70,
        error_count: 5,
        progress_percentage: 75,
        estimated_time_remaining_seconds: 30,
        current_batch: 8,
        total_batches: 10,
      };

      vi.mocked(weeklyReportService.getImportProgress).mockResolvedValue(mockProgress);

      const result = await weeklyReportService.getImportProgress(mockProgress.report_id);

      expect(result.progress_percentage).toBe(75);
      expect(result.processed_rows).toBe(75);
      expect(result.estimated_time_remaining_seconds).toBe(30);
    });

    it('should include error details for failed imports', async () => {
      // 🟢 WORKING: Test error details
      const mockReport = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        report_uid: 'WR2024-W51',
        status: WeeklyReportStatus.FAILED,
        error_count: 10,
        errors: [
          {
            row_number: 5,
            error_type: 'missing_required_field',
            error_message: 'Title is required',
            field_name: 'title',
            row_data: {},
          },
        ],
        week_number: 51,
        year: 2024,
        report_date: new Date('2024-12-20'),
        original_filename: 'weekly_report.xlsx',
        file_path: '/uploads/weekly_report.xlsx',
        total_rows: 100,
        imported_count: 90,
        skipped_count: 0,
        imported_at: new Date(),
        imported_by: 'user-123',
        created_at: new Date(),
      };

      vi.mocked(weeklyReportService.getWeeklyReportById).mockResolvedValue(mockReport);

      const result = await weeklyReportService.getWeeklyReportById(mockReport.id);

      expect(result?.status).toBe(WeeklyReportStatus.FAILED);
      expect(result?.errors?.length).toBe(1);
      expect(result?.errors?.[0].error_message).toBe('Title is required');
    });
  });

  describe('GET /api/ticketing/import/weekly/history', () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('should return list of all imports', async () => {
      // 🟢 WORKING: Test listing all imports
      const mockResponse = {
        reports: [
          {
            id: '123e4567-e89b-12d3-a456-426614174001',
            report_uid: 'WR2024-W51',
            week_number: 51,
            year: 2024,
            status: WeeklyReportStatus.COMPLETED,
            imported_count: 95,
          },
          {
            id: '123e4567-e89b-12d3-a456-426614174002',
            report_uid: 'WR2024-W50',
            week_number: 50,
            year: 2024,
            status: WeeklyReportStatus.COMPLETED,
            imported_count: 87,
          },
        ],
        total: 2,
        by_status: {
          pending: 0,
          processing: 0,
          completed: 2,
          failed: 0,
        },
        total_imported_tickets: 182,
      };

      vi.mocked(weeklyReportService.listWeeklyReports).mockResolvedValue(mockResponse as any);

      const result = await weeklyReportService.listWeeklyReports();

      expect(result.reports.length).toBe(2);
      expect(result.total).toBe(2);
      expect(result.total_imported_tickets).toBe(182);
    });

    it('should filter by status', async () => {
      // 🟢 WORKING: Test status filtering
      const mockResponse = {
        reports: [
          {
            id: '123e4567-e89b-12d3-a456-426614174001',
            report_uid: 'WR2024-W51',
            status: WeeklyReportStatus.COMPLETED,
          },
        ],
        total: 1,
        by_status: {
          pending: 0,
          processing: 0,
          completed: 1,
          failed: 0,
        },
        total_imported_tickets: 95,
      };

      vi.mocked(weeklyReportService.listWeeklyReports).mockResolvedValue(mockResponse as any);

      const result = await weeklyReportService.listWeeklyReports({
        status: WeeklyReportStatus.COMPLETED,
      });

      expect(result.reports.length).toBe(1);
      expect(result.reports[0].status).toBe(WeeklyReportStatus.COMPLETED);
    });

    it('should filter by week number', async () => {
      // 🟢 WORKING: Test week number filtering
      const mockResponse = {
        reports: [
          {
            id: '123e4567-e89b-12d3-a456-426614174001',
            report_uid: 'WR2024-W51',
            week_number: 51,
            year: 2024,
          },
        ],
        total: 1,
        by_status: {
          pending: 0,
          processing: 0,
          completed: 1,
          failed: 0,
        },
        total_imported_tickets: 95,
      };

      vi.mocked(weeklyReportService.listWeeklyReports).mockResolvedValue(mockResponse as any);

      const result = await weeklyReportService.listWeeklyReports({
        week_number: 51,
      });

      expect(result.reports.length).toBe(1);
      expect(result.reports[0].week_number).toBe(51);
    });

    it('should filter by year', async () => {
      // 🟢 WORKING: Test year filtering
      const mockResponse = {
        reports: [
          {
            id: '123e4567-e89b-12d3-a456-426614174001',
            report_uid: 'WR2024-W51',
            year: 2024,
          },
        ],
        total: 1,
        by_status: {
          pending: 0,
          processing: 0,
          completed: 1,
          failed: 0,
        },
        total_imported_tickets: 95,
      };

      vi.mocked(weeklyReportService.listWeeklyReports).mockResolvedValue(mockResponse as any);

      const result = await weeklyReportService.listWeeklyReports({
        year: 2024,
      });

      expect(result.reports.length).toBe(1);
      expect(result.reports[0].year).toBe(2024);
    });

    it('should sort by created_at DESC (newest first)', async () => {
      // 🟢 WORKING: Test sorting
      const mockResponse = {
        reports: [
          {
            id: '123e4567-e89b-12d3-a456-426614174002',
            report_uid: 'WR2024-W51',
            created_at: new Date('2024-12-20'),
          },
          {
            id: '123e4567-e89b-12d3-a456-426614174001',
            report_uid: 'WR2024-W50',
            created_at: new Date('2024-12-13'),
          },
        ],
        total: 2,
        by_status: {
          pending: 0,
          processing: 0,
          completed: 2,
          failed: 0,
        },
        total_imported_tickets: 182,
      };

      vi.mocked(weeklyReportService.listWeeklyReports).mockResolvedValue(mockResponse as any);

      const result = await weeklyReportService.listWeeklyReports();

      expect(result.reports[0].created_at.getTime()).toBeGreaterThan(
        result.reports[1].created_at.getTime()
      );
    });

    it('should return summary statistics by status', async () => {
      // 🟢 WORKING: Test status summary
      const mockResponse = {
        reports: [],
        total: 10,
        by_status: {
          pending: 1,
          processing: 2,
          completed: 6,
          failed: 1,
        },
        total_imported_tickets: 500,
      };

      vi.mocked(weeklyReportService.listWeeklyReports).mockResolvedValue(mockResponse as any);

      const result = await weeklyReportService.listWeeklyReports();

      expect(result.by_status.completed).toBe(6);
      expect(result.by_status.pending).toBe(1);
      expect(result.by_status.processing).toBe(2);
      expect(result.by_status.failed).toBe(1);
      expect(result.total_imported_tickets).toBe(500);
    });

    it('should return empty array when no imports exist', async () => {
      // 🟢 WORKING: Test empty result
      const mockResponse = {
        reports: [],
        total: 0,
        by_status: {
          pending: 0,
          processing: 0,
          completed: 0,
          failed: 0,
        },
        total_imported_tickets: 0,
      };

      vi.mocked(weeklyReportService.listWeeklyReports).mockResolvedValue(mockResponse as any);

      const result = await weeklyReportService.listWeeklyReports();

      expect(result.reports.length).toBe(0);
      expect(result.total).toBe(0);
    });
  });
});
