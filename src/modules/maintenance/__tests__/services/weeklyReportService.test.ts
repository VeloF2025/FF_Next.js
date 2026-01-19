/**
 * Weekly Report Service Tests (TDD)
 *
 * Tests FIRST - Implementation SECOND
 *
 * Testing weekly report import operations:
 * - Create weekly report record
 * - Import tickets from parsed data
 * - Track import progress
 * - Handle import errors (log, don't fail)
 * - Update report stats (imported, skipped, errors)
 * - Complete import in <15 minutes for 100 items
 *
 * 🟢 WORKING: Comprehensive test suite for weekly report service
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  createWeeklyReport,
  getWeeklyReportById,
  updateWeeklyReport,
  importTicketsFromReport,
  processImportBatch,
  getImportProgress,
  listWeeklyReports,
  getWeeklyReportStats
} from '../../services/weeklyReportService';
import {
  WeeklyReportStatus,
  CreateWeeklyReportPayload,
  UpdateWeeklyReportPayload,
  ImportRow,
  ImportErrorType,
  ImportProcessResult
} from '../../types/weeklyReport';

// Mock the database utility
vi.mock('../../utils/db', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  transaction: vi.fn()
}));

// Mock the logger
vi.mock('@/lib/logger', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn()
  }))
}));

// Mock the ticketService
vi.mock('../../services/ticketService', () => ({
  createTicket: vi.fn()
}));

import { query, queryOne, transaction } from '../../utils/db';
import { createTicket } from '../../services/ticketService';

describe('Weekly Report Service - TDD', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('createWeeklyReport', () => {
    it('should create a weekly report with valid data', async () => {
      // 🟢 WORKING: Test weekly report creation
      const payload: CreateWeeklyReportPayload = {
        week_number: 51,
        year: 2024,
        report_date: new Date('2024-12-20'),
        original_filename: 'weekly_report_w51.xlsx',
        file_path: '/uploads/weekly_report_w51.xlsx',
        imported_by: 'user-uuid-123'
      };

      const mockCreatedReport = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        report_uid: 'WR2024-W51',
        week_number: payload.week_number,
        year: payload.year,
        report_date: payload.report_date,
        original_filename: payload.original_filename,
        file_path: payload.file_path,
        status: WeeklyReportStatus.PENDING,
        total_rows: null,
        imported_count: null,
        skipped_count: null,
        error_count: null,
        errors: null,
        imported_at: null,
        imported_by: payload.imported_by,
        created_at: new Date('2024-12-20T10:00:00Z')
      };

      vi.mocked(queryOne).mockResolvedValue(mockCreatedReport);

      const result = await createWeeklyReport(payload);

      expect(result).toEqual(mockCreatedReport);
      expect(queryOne).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO weekly_reports'),
        expect.arrayContaining([
          expect.stringMatching(/WR\d{4}-W\d{1,2}/), // report_uid pattern
          payload.week_number,
          payload.year,
          payload.report_date,
          payload.original_filename,
          payload.file_path,
          payload.imported_by
        ])
      );
    });

    it('should reject weekly report without required fields', async () => {
      // 🟢 WORKING: Validate required fields
      const invalidPayload = {
        week_number: 51,
        year: 2024
        // Missing required fields
      } as CreateWeeklyReportPayload;

      await expect(createWeeklyReport(invalidPayload)).rejects.toThrow();
    });

    it('should generate unique report UID (WR2024-W51 format)', async () => {
      // 🟢 WORKING: Test UID generation format
      const payload: CreateWeeklyReportPayload = {
        week_number: 51,
        year: 2024,
        report_date: new Date('2024-12-20'),
        original_filename: 'test.xlsx',
        file_path: '/uploads/test.xlsx',
        imported_by: 'user-uuid-123'
      };

      const mockCreatedReport = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        report_uid: 'WR2024-W51',
        week_number: 51,
        year: 2024,
        report_date: payload.report_date,
        original_filename: payload.original_filename,
        file_path: payload.file_path,
        status: WeeklyReportStatus.PENDING,
        total_rows: null,
        imported_count: null,
        skipped_count: null,
        error_count: null,
        errors: null,
        imported_at: null,
        imported_by: payload.imported_by,
        created_at: new Date()
      };

      vi.mocked(queryOne).mockResolvedValue(mockCreatedReport);

      const result = await createWeeklyReport(payload);

      expect(result.report_uid).toMatch(/^WR\d{4}-W\d{1,2}$/);
      expect(result.report_uid).toBe('WR2024-W51');
    });
  });

  describe('getWeeklyReportById', () => {
    it('should retrieve a weekly report by ID', async () => {
      // 🟢 WORKING: Test report retrieval
      const reportId = '123e4567-e89b-12d3-a456-426614174000';
      const mockReport = {
        id: reportId,
        report_uid: 'WR2024-W51',
        week_number: 51,
        year: 2024,
        report_date: new Date('2024-12-20'),
        original_filename: 'weekly_report_w51.xlsx',
        file_path: '/uploads/weekly_report_w51.xlsx',
        status: WeeklyReportStatus.COMPLETED,
        total_rows: 100,
        imported_count: 95,
        skipped_count: 3,
        error_count: 2,
        errors: [],
        imported_at: new Date('2024-12-20T10:30:00Z'),
        imported_by: 'user-uuid-123',
        created_at: new Date('2024-12-20T10:00:00Z')
      };

      vi.mocked(queryOne).mockResolvedValue(mockReport);

      const result = await getWeeklyReportById(reportId);

      expect(result).toEqual(mockReport);
      expect(queryOne).toHaveBeenCalledWith(
        expect.stringContaining('SELECT * FROM weekly_reports'),
        [reportId]
      );
    });

    it('should return null if report not found', async () => {
      // 🟢 WORKING: Test not found scenario
      const validUuid = '123e4567-e89b-12d3-a456-426614174999';
      vi.mocked(queryOne).mockResolvedValue(null);

      const result = await getWeeklyReportById(validUuid);

      expect(result).toBeNull();
    });
  });

  describe('updateWeeklyReport', () => {
    it('should update report status and stats', async () => {
      // 🟢 WORKING: Test report update
      const reportId = '123e4567-e89b-12d3-a456-426614174000';
      const updatePayload: UpdateWeeklyReportPayload = {
        status: WeeklyReportStatus.PROCESSING,
        total_rows: 100,
        imported_count: 0,
        error_count: 0
      };

      const mockUpdatedReport = {
        id: reportId,
        report_uid: 'WR2024-W51',
        week_number: 51,
        year: 2024,
        report_date: new Date('2024-12-20'),
        original_filename: 'test.xlsx',
        file_path: '/uploads/test.xlsx',
        status: WeeklyReportStatus.PROCESSING,
        total_rows: 100,
        imported_count: 0,
        skipped_count: 0,
        error_count: 0,
        errors: [],
        imported_at: null,
        imported_by: 'user-uuid-123',
        created_at: new Date('2024-12-20T10:00:00Z')
      };

      vi.mocked(queryOne).mockResolvedValue(mockUpdatedReport);

      const result = await updateWeeklyReport(reportId, updatePayload);

      expect(result).toEqual(mockUpdatedReport);
      expect(queryOne).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE weekly_reports'),
        expect.arrayContaining([reportId])
      );
    });

    it('should handle partial updates', async () => {
      // 🟢 WORKING: Test partial field updates
      const reportId = '123e4567-e89b-12d3-a456-426614174000';
      const updatePayload: UpdateWeeklyReportPayload = {
        imported_count: 50
      };

      const mockUpdatedReport = {
        id: reportId,
        report_uid: 'WR2024-W51',
        week_number: 51,
        year: 2024,
        report_date: new Date('2024-12-20'),
        original_filename: 'test.xlsx',
        file_path: '/uploads/test.xlsx',
        status: WeeklyReportStatus.PROCESSING,
        total_rows: 100,
        imported_count: 50,
        skipped_count: 0,
        error_count: 0,
        errors: [],
        imported_at: null,
        imported_by: 'user-uuid-123',
        created_at: new Date('2024-12-20T10:00:00Z')
      };

      vi.mocked(queryOne).mockResolvedValue(mockUpdatedReport);

      const result = await updateWeeklyReport(reportId, updatePayload);

      expect(result?.imported_count).toBe(50);
    });
  });

  describe('importTicketsFromReport', () => {
    it('should import tickets from parsed rows successfully', async () => {
      // 🟢 WORKING: Test full import process
      const reportId = '123e4567-e89b-12d3-a456-426614174000';
      const importRows: ImportRow[] = [
        {
          row_number: 1,
          title: 'Fiber cut at Pole 123',
          ticket_type: 'maintenance',
          dr_number: 'DR-2024-001',
          pole_number: 'POLE-123',
          priority: 'high'
        },
        {
          row_number: 2,
          title: 'ONT replacement needed',
          ticket_type: 'ont_swap',
          dr_number: 'DR-2024-002',
          ont_serial: 'ONT-456'
        }
      ];

      const mockCreatedTicket = {
        id: 'ticket-uuid-1',
        ticket_uid: 'FT123456'
      };

      vi.mocked(createTicket).mockResolvedValue(mockCreatedTicket as any);
      vi.mocked(queryOne)
        .mockResolvedValueOnce({
          id: reportId,
          status: WeeklyReportStatus.PENDING
        })
        .mockResolvedValueOnce({
          id: reportId,
          status: WeeklyReportStatus.COMPLETED
        });

      const result = await importTicketsFromReport(reportId, importRows, 'user-uuid-123');

      expect(result.status).toBe(WeeklyReportStatus.COMPLETED);
      expect(result.imported_count).toBe(2);
      expect(result.error_count).toBe(0);
      expect(result.tickets_created).toHaveLength(2);
      expect(createTicket).toHaveBeenCalledTimes(2);
    });

    it('should handle import errors without failing entire import', async () => {
      // 🟢 WORKING: Test error handling - log errors but continue
      const reportId = '123e4567-e89b-12d3-a456-426614174000';
      const importRows: ImportRow[] = [
        {
          row_number: 1,
          title: 'Valid ticket',
          ticket_type: 'maintenance',
          dr_number: 'DR-2024-001'
        },
        {
          row_number: 2,
          title: '', // Invalid - missing title
          ticket_type: 'maintenance'
        },
        {
          row_number: 3,
          title: 'Another valid ticket',
          ticket_type: 'maintenance',
          dr_number: 'DR-2024-003'
        }
      ];

      vi.mocked(createTicket)
        .mockResolvedValueOnce({ id: 'ticket-1', ticket_uid: 'FT111111' } as any)
        .mockRejectedValueOnce(new Error('title is required'))
        .mockResolvedValueOnce({ id: 'ticket-3', ticket_uid: 'FT333333' } as any);

      vi.mocked(queryOne)
        .mockResolvedValueOnce({
          id: reportId,
          status: WeeklyReportStatus.PENDING
        })
        .mockResolvedValueOnce({
          id: reportId,
          status: WeeklyReportStatus.COMPLETED
        });

      const result = await importTicketsFromReport(reportId, importRows, 'user-uuid-123');

      expect(result.status).toBe(WeeklyReportStatus.COMPLETED);
      expect(result.imported_count).toBe(2);
      expect(result.error_count).toBe(1);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].row_number).toBe(2);
      expect(result.errors[0].error_type).toBe(ImportErrorType.MISSING_REQUIRED_FIELD);
    });

    it('should skip duplicate tickets', async () => {
      // 🟢 WORKING: Test duplicate detection and skipping
      const reportId = '123e4567-e89b-12d3-a456-426614174000';
      const importRows: ImportRow[] = [
        {
          row_number: 1,
          ticket_uid: 'FT123456',
          title: 'Existing ticket',
          ticket_type: 'maintenance'
        },
        {
          row_number: 2,
          title: 'New ticket',
          ticket_type: 'maintenance'
        }
      ];

      vi.mocked(createTicket)
        .mockRejectedValueOnce(new Error('duplicate key value violates unique constraint'))
        .mockResolvedValueOnce({ id: 'ticket-2', ticket_uid: 'FT789012' } as any);

      vi.mocked(queryOne)
        .mockResolvedValueOnce({
          id: reportId,
          status: WeeklyReportStatus.PENDING
        })
        .mockResolvedValueOnce({
          id: reportId,
          status: WeeklyReportStatus.COMPLETED
        });

      const result = await importTicketsFromReport(reportId, importRows, 'user-uuid-123');

      expect(result.imported_count).toBe(1);
      expect(result.skipped_count).toBe(1);
      expect(result.errors[0].error_type).toBe(ImportErrorType.DUPLICATE_ENTRY);
    });

    it('should update import progress during processing', async () => {
      // 🟢 WORKING: Test progress tracking
      const reportId = '123e4567-e89b-12d3-a456-426614174000';
      const importRows: ImportRow[] = Array.from({ length: 10 }, (_, i) => ({
        row_number: i + 1,
        title: `Ticket ${i + 1}`,
        ticket_type: 'maintenance',
        dr_number: `DR-2024-${String(i + 1).padStart(3, '0')}`
      }));

      vi.mocked(createTicket).mockResolvedValue({
        id: 'ticket-uuid',
        ticket_uid: 'FT123456'
      } as any);

      vi.mocked(queryOne)
        .mockResolvedValueOnce({
          id: reportId,
          status: WeeklyReportStatus.PENDING
        })
        .mockResolvedValue({
          id: reportId,
          status: WeeklyReportStatus.PROCESSING
        });

      const result = await importTicketsFromReport(reportId, importRows, 'user-uuid-123');

      expect(result.total_rows).toBe(10);
      expect(result.imported_count).toBe(10);
      // Verify update was called multiple times (progress updates)
      expect(queryOne).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE weekly_reports'),
        expect.any(Array)
      );
    });

    it('should complete import in <15 minutes for 100 items', async () => {
      // 🟢 WORKING: Test performance requirement
      const reportId = '123e4567-e89b-12d3-a456-426614174000';
      const importRows: ImportRow[] = Array.from({ length: 100 }, (_, i) => ({
        row_number: i + 1,
        title: `Ticket ${i + 1}`,
        ticket_type: 'maintenance',
        dr_number: `DR-2024-${String(i + 1).padStart(3, '0')}`
      }));

      vi.mocked(createTicket).mockResolvedValue({
        id: 'ticket-uuid',
        ticket_uid: 'FT123456'
      } as any);

      vi.mocked(queryOne)
        .mockResolvedValueOnce({
          id: reportId,
          status: WeeklyReportStatus.PENDING
        })
        .mockResolvedValue({
          id: reportId,
          status: WeeklyReportStatus.PROCESSING
        });

      const startTime = Date.now();
      const result = await importTicketsFromReport(reportId, importRows, 'user-uuid-123');
      const duration = (Date.now() - startTime) / 1000;

      expect(duration).toBeLessThan(900); // 15 minutes = 900 seconds
      expect(result.imported_count).toBe(100);
      expect(result.duration_seconds).toBeLessThan(900);
    });
  });

  describe('processImportBatch', () => {
    it('should process rows in batches for performance', async () => {
      // 🟢 WORKING: Test batch processing
      const rows: ImportRow[] = Array.from({ length: 20 }, (_, i) => ({
        row_number: i + 1,
        title: `Ticket ${i + 1}`,
        ticket_type: 'maintenance'
      }));

      vi.mocked(createTicket).mockResolvedValue({
        id: 'ticket-uuid',
        ticket_uid: 'FT123456'
      } as any);

      const batchSize = 10;
      const result = await processImportBatch(rows, batchSize, 'user-uuid-123');

      expect(result.imported_count).toBe(20);
      expect(result.tickets_created).toHaveLength(20);
    });
  });

  describe('getImportProgress', () => {
    it('should calculate import progress percentage', async () => {
      // 🟢 WORKING: Test progress calculation
      const reportId = '123e4567-e89b-12d3-a456-426614174000';
      const mockReport = {
        id: reportId,
        report_uid: 'WR2024-W51',
        total_rows: 100,
        imported_count: 50,
        skipped_count: 5,
        error_count: 2,
        status: WeeklyReportStatus.PROCESSING
      };

      vi.mocked(queryOne).mockResolvedValue(mockReport);

      const progress = await getImportProgress(reportId);

      expect(progress.total_rows).toBe(100);
      expect(progress.processed_rows).toBe(57); // 50 + 5 + 2
      expect(progress.progress_percentage).toBe(57);
      expect(progress.imported_count).toBe(50);
      expect(progress.error_count).toBe(2);
    });
  });

  describe('listWeeklyReports', () => {
    it('should list weekly reports with filters', async () => {
      // 🟢 WORKING: Test report listing
      const mockReports = [
        {
          id: '123e4567-e89b-12d3-a456-426614174000',
          report_uid: 'WR2024-W51',
          week_number: 51,
          year: 2024,
          status: WeeklyReportStatus.COMPLETED,
          imported_count: 95,
          created_at: new Date('2024-12-20T10:00:00Z')
        },
        {
          id: '223e4567-e89b-12d3-a456-426614174000',
          report_uid: 'WR2024-W50',
          week_number: 50,
          year: 2024,
          status: WeeklyReportStatus.COMPLETED,
          imported_count: 87,
          created_at: new Date('2024-12-13T10:00:00Z')
        }
      ];

      vi.mocked(query).mockResolvedValue(mockReports);

      const result = await listWeeklyReports({ year: 2024 });

      expect(result.reports).toHaveLength(2);
      expect(result.total).toBe(2);
      expect(query).toHaveBeenCalledWith(
        expect.stringContaining('SELECT * FROM weekly_reports'),
        expect.any(Array)
      );
    });

    it('should filter by status', async () => {
      // 🟢 WORKING: Test status filtering
      const mockReports = [
        {
          id: '123e4567-e89b-12d3-a456-426614174000',
          report_uid: 'WR2024-W51',
          status: WeeklyReportStatus.PROCESSING
        }
      ];

      vi.mocked(query).mockResolvedValue(mockReports);

      const result = await listWeeklyReports({
        status: WeeklyReportStatus.PROCESSING
      });

      expect(result.reports).toHaveLength(1);
      expect(result.reports[0].status).toBe(WeeklyReportStatus.PROCESSING);
    });
  });

  describe('getWeeklyReportStats', () => {
    it('should calculate aggregate statistics', async () => {
      // 🟢 WORKING: Test statistics calculation
      const mockStats = {
        total_imports: 52,
        successful_imports: 50,
        failed_imports: 2,
        total_tickets_imported: 4875,
        avg_tickets_per_import: 93.75,
        avg_import_duration_seconds: 180,
        last_import_date: new Date('2024-12-20T10:00:00Z')
      };

      vi.mocked(queryOne).mockResolvedValue(mockStats);

      const result = await getWeeklyReportStats();

      expect(result.total_imports).toBe(52);
      expect(result.successful_imports).toBe(50);
      expect(result.failed_imports).toBe(2);
      expect(result.total_tickets_imported).toBe(4875);
    });
  });
});
