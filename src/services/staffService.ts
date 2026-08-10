/**
 * Staff Service - Main export file
 * Using API routes for browser, Neon for server/build
 */

import { staffApiService } from './staff/staffApiService';
import { staffImportService } from './staff/staffImportService';
import { staffExportService } from './staff/staffExportService';
import type { StaffMember, StaffFilter, StaffDropdownOption, StaffSummary } from '@/types/staff.types';

// The Neon service is imported lazily, inside each server-only branch.
//
// What this DID fix, measured: a static import put the whole
// @neondatabase/serverless driver into the dynamic-import graph of six pages
// (staff and projects forms/details, pipeline detail), so visiting any of them
// DOWNLOADED 144KB on component mount to serve a branch that never runs in a
// browser. Those six now pull zero driver chunks.
//
// What it did NOT fix: webpack still emits the chunk for this module. Three
// shapes were tried and measured — dynamic import behind a hoisted
// `const isBrowser`, dynamic import behind a module-level helper, and this one
// (inline `typeof window` test, inline import at all nine sites). The chunk
// survives all three here, though the same inline shape DID eliminate it in
// staffExportService and managerResolver, which have a single call site each.
// It is emitted and served but no client path fetches it.
//
// Reaching zero needs the architectural split, not a fourth import shape:
// staffService becomes API-only and server callers import staffNeonService
// directly. See scripts/client-bundle-db-policy.mjs for the full record.

/**
 * Staff Service Interface
 * Provides consistent typing regardless of browser/server environment
 */
interface StaffService {
  getAll: (filter?: StaffFilter) => Promise<StaffMember[]>;
  getById: (id: string) => Promise<StaffMember | null>;
  create: (data: Partial<StaffMember>) => Promise<StaffMember>;
  createOrUpdate: (data: Partial<StaffMember>) => Promise<StaffMember>;
  update: (id: string, data: Partial<StaffMember>) => Promise<StaffMember>;
  delete: (id: string) => Promise<void>;
  getActiveStaff: () => Promise<StaffDropdownOption[]>;
  getProjectManagers: () => Promise<StaffDropdownOption[]>;
  getStaffSummary: () => Promise<StaffSummary>;
  getProjectAssignments: () => Promise<unknown[]>;
  assignToProject: () => Promise<{ success: boolean }>;
  updateStaffProjectCount: () => Promise<{ success: boolean }>;
  importFromCSV: typeof staffImportService.importFromCSV;
  importFromExcel: typeof staffImportService.importFromExcel;
  getImportTemplate: () => string;
  exportToExcel: typeof staffExportService.exportToExcel;
  import: typeof staffImportService;
  export: typeof staffExportService;
}

export const staffService: StaffService = {
  // Main CRUD operations
  getAll: async (filter?: StaffFilter): Promise<StaffMember[]> => {
    return typeof window !== 'undefined'
      ? staffApiService.getAll(filter as Record<string, unknown>)
      : (await import('./staff/staffNeonService')).staffNeonService.getAll(filter);
  },

  getById: async (id: string): Promise<StaffMember | null> => {
    return typeof window !== 'undefined' ? staffApiService.getById(id) : (await import('./staff/staffNeonService')).staffNeonService.getById(id);
  },

  create: async (data: Partial<StaffMember>): Promise<StaffMember> => {
    return typeof window !== 'undefined' ? staffApiService.create(data) : (await import('./staff/staffNeonService')).staffNeonService.create(data);
  },

  createOrUpdate: async (data: Partial<StaffMember>): Promise<StaffMember> => {
    return typeof window !== 'undefined' ? staffApiService.create(data) : (await import('./staff/staffNeonService')).staffNeonService.createOrUpdate(data);
  },

  update: async (id: string, data: Partial<StaffMember>): Promise<StaffMember> => {
    return typeof window !== 'undefined' ? staffApiService.update(id, data) : (await import('./staff/staffNeonService')).staffNeonService.update(id, data);
  },

  delete: async (id: string): Promise<void> => {
    return typeof window !== 'undefined' ? staffApiService.delete(id) : (await import('./staff/staffNeonService')).staffNeonService.delete(id);
  },

  // Query operations
  getActiveStaff: async (): Promise<StaffDropdownOption[]> => {
    return typeof window !== 'undefined' ? staffApiService.getActiveStaff() : (await import('./staff/staffNeonService')).staffNeonService.getActiveStaff();
  },

  getProjectManagers: async (): Promise<StaffDropdownOption[]> => {
    if (typeof window !== 'undefined') {
      // In browser, filter active staff as project managers
      const staff = await staffApiService.getAll();
      return staff
        .filter(s => s.status === 'active')
        .map(s => ({
          id: s.id || '',
          name: s.name,
          email: s.email,
          position: s.position as string,
          department: s.department,
          status: s.status,
          currentProjectCount: s.currentProjectCount,
          maxProjectCount: s.maxProjectCount,
        }));
    }
    return (await import('./staff/staffNeonService')).staffNeonService.getProjectManagers();
  },

  getStaffSummary: async (): Promise<StaffSummary> => {
    return typeof window !== 'undefined' ? staffApiService.getStaffSummary() : (await import('./staff/staffNeonService')).staffNeonService.getStaffSummary();
  },

  // Extended operations
  // TODO: Wire up to /api/staff/[staffId]/projects GET endpoint
  getProjectAssignments: async () => {
    // STUB: Returns empty array - project assignments not yet wired up
    return Promise.resolve([]);
  },

  // TODO: Wire up to /api/staff/[staffId]/projects POST endpoint
  assignToProject: async () => {
    // STUB: Returns success without action - project assignments not yet wired up
    return Promise.resolve({ success: true });
  },

  // TODO: Implement via API or direct Neon query
  updateStaffProjectCount: async () => {
    // STUB: Returns success without action - counts not recalculated
    return Promise.resolve({ success: true });
  },

  // Import operations
  importFromCSV: staffImportService.importFromCSV,
  importFromExcel: staffImportService.importFromExcel,
  getImportTemplate: staffImportService.getImportTemplate || (() => 'Name,Email,Phone,Employee ID,Position,Department'),

  // Export operations
  exportToExcel: staffExportService.exportToExcel,

  // Legacy structure for backward compatibility
  import: staffImportService,
  export: staffExportService,
};