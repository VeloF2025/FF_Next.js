/**
 * Barrel for field-stock-pwa client API helpers.
 *
 * All client-side fetch helpers for /my/stores routes.
 * No server imports; no pg.Pool.
 *
 * Hydration strategy, contractor endpoint, and serial validation notes:
 * See individual sub-modules (technicians.ts, contractors.ts, serials.ts).
 */

export { ApiError } from './request';
export type { ApiEnvelope } from './request';
export { fetchTechnicians, createTechnician } from './technicians';
export { fetchContractors } from './contractors';
export { validateSerial, extractSerialFromPhoto } from './serials';
export type { SerialExtractResult } from './serials';
export { fetchIssuableStockItems } from './items';
export type { PwaIssuableItem, PwaTrackingType } from './items';
export { fetchProjects } from './projects';
export type { PwaProjectSummary } from './projects';
export { submitIssue, uploadIssueProof } from './pickings';
export { submitReturn, submitInspectAndAccept, retryAccept } from './returns';
