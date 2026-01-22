/**
 * Staff Service - Main export file
 * Using API routes for browser, Neon for server/build
 */

import { staffNeonService } from './staff/staffNeonService';
import { staffApiService } from './staff/staffApiService';
import { staffImportService } from './staff/staffImportService';
import { staffExportService } from './staff/staffExportService';
import type { StaffMember, StaffFilter, StaffDropdownOption, StaffSummary } from '@/types/staff.types';

// Use API service in browser, Neon service for server/build
const isBrowser = typeof window !== 'undefined';

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
    return isBrowser ? staffApiService.getAll(filter) : staffNeonService.getAll(filter);
  },

  getById: async (id: string): Promise<StaffMember | null> => {
    return isBrowser ? staffApiService.getById(id) : staffNeonService.getById(id);
  },

  create: async (data: Partial<StaffMember>): Promise<StaffMember> => {
    return isBrowser ? staffApiService.create(data) : staffNeonService.create(data);
  },

  createOrUpdate: async (data: Partial<StaffMember>): Promise<StaffMember> => {
    return isBrowser ? staffApiService.create(data) : staffNeonService.createOrUpdate(data);
  },

  update: async (id: string, data: Partial<StaffMember>): Promise<StaffMember> => {
    return isBrowser ? staffApiService.update(id, data) : staffNeonService.update(id, data);
  },

  delete: async (id: string): Promise<void> => {
    return isBrowser ? staffApiService.delete(id) : staffNeonService.delete(id);
  },

  // Query operations
  getActiveStaff: async (): Promise<StaffDropdownOption[]> => {
    return isBrowser ? staffApiService.getActiveStaff() : staffNeonService.getActiveStaff();
  },

  getProjectManagers: async (): Promise<StaffDropdownOption[]> => {
    if (isBrowser) {
      // In browser, filter active staff as project managers
      const staff = await staffApiService.getAll();
      return staff
        .filter(s => s.status === 'active')
        .map(s => ({
          id: s.id || '',
          name: s.name,
          email: s.email,
          position: s.position as string,
          department: s.department as any,
          status: s.status,
          currentProjectCount: s.currentProjectCount,
          maxProjectCount: s.maxProjectCount,
        }));
    }
    return staffNeonService.getProjectManagers();
  },

  getStaffSummary: async (): Promise<StaffSummary> => {
    return isBrowser ? staffApiService.getStaffSummary() : staffNeonService.getStaffSummary();
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