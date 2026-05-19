/**
 * PWA-specific types for the field-stock issue/return flow on /my/stores.
 *
 * These are client-side shapes, intentionally separate from the server-side
 * procurement module types so the PWA layer has no server imports.
 */

// 🟢 WORKING: Verbatim from plan 2026-05-19-field-stock-pwa.md § Task 2.1

export interface PwaTechSummary {
  id: string;
  name: string;
  phone: string | null;
  contractorId: string | null;
  contractorName: string | null;
  accountStatus: 'pending' | 'active' | 'suspended';
}

export interface PwaScannedSerial {
  serialNumber: string;
  stockItemId: string;
  stockItemName: string;
  scannedAt: number; // epoch ms; used for sort + audit
  state: 'pending-validation' | 'valid' | 'invalid';
  errorMessage?: string;
}

export interface PwaIssueDraft {
  technicianId: string;
  contractorId: string | null;
  stockItemId: string;
  serials: PwaScannedSerial[];
  signatureDataUrl: string | null;
  notes: string;
}

export interface PwaPickingResult {
  pickingId: string;
  pickingNumber: string; // ISS-YYYYMM-#####
  status: 'pending' | 'confirmed' | 'processed' | 'signed';
}
