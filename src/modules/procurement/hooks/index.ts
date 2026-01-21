// Procurement Hooks - Index Export

export { useProcurementPermissions } from './useProcurementPermissions';
export { useTabPersistence } from './useTabPersistence';

// Placeholder hooks - to be implemented in next phases
export const useProcurement = () => ({ loading: false, error: null });
export const useBoqs = () => ({ boqs: [], loading: false, error: null });
export const useRfqs = () => ({ rfqs: [], loading: false, error: null });
export const useQuotes = () => ({ quotes: [], loading: false, error: null });
export const useStock = () => ({ positions: [], loading: false, error: null });