import { vfStorage } from '@/services/vfStorageAdapter';
import type { PayrollExportStorage } from './types';

export const payrollExportStorage: PayrollExportStorage = {
  async upload(bytes, filename) {
    const uploaded = await vfStorage.uploadFile(bytes, 'attendance', 'payroll-exports', filename);
    return { path: uploaded.path, filename: uploaded.filename };
  },
  remove(filename) {
    return vfStorage.deleteFile('attendance', 'payroll-exports', filename);
  },
};

export type { PayrollExportStorage } from './types';
