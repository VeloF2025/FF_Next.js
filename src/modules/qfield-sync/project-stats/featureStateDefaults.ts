import type { CableStats, DropStats, PoleStats } from './types';

export function emptyPoles(): PoleStats {
  return {
    qfieldTotal: 0,
    planted: 0,
    photoComplete: 0,
    photoIncomplete: 0,
    qaPassed: 0,
    qaFailed: 0,
    applied: 0,
    stuckRecoverable: 0,
    staleDuplicates: 0,
    designTotal: null,
    neverCaptured: null,
    referencedPhotos: 0,
    presentPhotos: null,
    missingPhotos: null,
    byStatus: {},
  };
}

export function emptyCables(): CableStats {
  return {
    qfieldTotal: 0,
    fibreflowTotal: null,
    totalLengthM: null,
    synchronized: null,
    needsSync: null,
    qfieldOnly: null,
    fibreflowOnly: null,
    byStatus: {},
  };
}

export function emptyDrops(): DropStats {
  return {
    qfieldTotal: 0,
    fibreflowTotal: null,
    installed: 0,
    planned: 0,
    inProgress: 0,
    approved: 0,
    pending: 0,
    failed: 0,
    synchronized: null,
    needsSync: null,
    qfieldOnly: null,
    fibreflowOnly: null,
    installationByStatus: {},
    qcByStatus: {},
  };
}
