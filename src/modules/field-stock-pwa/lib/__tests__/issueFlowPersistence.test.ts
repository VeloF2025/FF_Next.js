/**
 * issueFlowPersistence — save/load/clear round-trip and restore guards.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  saveIssueFlow,
  loadIssueFlow,
  clearIssueFlow,
  ISSUE_FLOW_STORAGE_KEY,
  type PersistedIssueFlow,
} from '../issueFlowPersistence';

// Minimal in-memory Storage stub — vitest unit env has no window.
function makeStorage(): Storage {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => { map.set(k, v); },
    removeItem: (k: string) => { map.delete(k); },
    clear: () => map.clear(),
    key: (i: number) => [...map.keys()][i] ?? null,
    get length() { return map.size; },
  } as Storage;
}

const tech = {
  id: 'tech-1', name: 'T One', phone: null, contractorId: null, contractorName: null,
  accountStatus: 'active', role: null, siteProjectId: null, siteProjectName: null,
} as PersistedIssueFlow['technician'];

const item = {
  id: 'item-gizzu', name: 'FT-GIZZU', sku: 'FT-GIZZU', trackingType: 'serial',
  uom: null, unitValueZar: 263.13,
} as PersistedIssueFlow['stockItem'];

function flowAt(step: PersistedIssueFlow['step']): PersistedIssueFlow {
  return {
    step,
    sourceLocation: { id: 'wh-1', name: 'Main WH' },
    technician: tech,
    stockItem: item,
    scanned: [
      { serialNumber: 'GZ001', stockItemId: 'item-gizzu', stockItemName: 'FT-GIZZU', scannedAt: 1, state: 'valid' },
      { serialNumber: 'GZ002', stockItemId: '', stockItemName: '', scannedAt: 2, state: 'pending-validation' },
      { serialNumber: 'GZ003', stockItemId: 'item-gizzu', stockItemName: 'FT-GIZZU', scannedAt: 3, state: 'invalid', errorMessage: 'nope' },
    ],
    quantity: 0,
  };
}

beforeEach(() => {
  vi.stubGlobal('window', { sessionStorage: makeStorage() });
});

describe('issueFlowPersistence', () => {
  it('round-trips a mid-flow state, dropping pending-validation rows', () => {
    saveIssueFlow(flowAt('scan-serials'));
    const restored = loadIssueFlow();
    expect(restored).not.toBeNull();
    expect(restored?.step).toBe('scan-serials');
    expect(restored?.technician?.id).toBe('tech-1');
    expect(restored?.scanned.map((s) => s.serialNumber)).toEqual(['GZ001', 'GZ003']);
  });

  it('saving a step-1 flow clears instead of persisting', () => {
    saveIssueFlow(flowAt('scan-serials'));
    saveIssueFlow({ ...flowAt('pick-warehouse'), technician: null, stockItem: null, scanned: [] });
    expect(loadIssueFlow()).toBeNull();
  });

  it('clearIssueFlow removes the saved flow', () => {
    saveIssueFlow(flowAt('sign-submit'));
    clearIssueFlow();
    expect(loadIssueFlow()).toBeNull();
  });

  it('rejects corrupt JSON and unknown steps', () => {
    window.sessionStorage.setItem(ISSUE_FLOW_STORAGE_KEY, '{not json');
    expect(loadIssueFlow()).toBeNull();
    window.sessionStorage.setItem(ISSUE_FLOW_STORAGE_KEY, JSON.stringify({ ...flowAt('scan-serials'), step: 'done' }));
    expect(loadIssueFlow()).toBeNull();
  });

  it('rejects a step whose required objects are missing', () => {
    window.sessionStorage.setItem(
      ISSUE_FLOW_STORAGE_KEY,
      JSON.stringify({ ...flowAt('scan-serials'), stockItem: null })
    );
    expect(loadIssueFlow()).toBeNull();
    window.sessionStorage.setItem(
      ISSUE_FLOW_STORAGE_KEY,
      JSON.stringify({ ...flowAt('pick-item'), technician: null })
    );
    expect(loadIssueFlow()).toBeNull();
  });

  it('never throws against the real environment storage', () => {
    vi.unstubAllGlobals();
    // The vitest env may provide a real jsdom window; clear it so this test
    // asserts graceful behaviour, not leftovers from the environment.
    clearIssueFlow();
    expect(() => saveIssueFlow(flowAt('pick-warehouse'))).not.toThrow();
    expect(loadIssueFlow()).toBeNull();
    expect(() => clearIssueFlow()).not.toThrow();
  });
});
