import { createContext, useContext, useReducer, ReactNode, useEffect } from 'react';
import { useRouter } from 'next/router';
import { BarChart3, FileText, Send, Quote, ShoppingCart, Package, Truck, ClipboardList } from 'lucide-react';
import type { 
  ProcurementPortalContext as ProcurementPortalContextType,
  ProcurementTab,
  ProcurementTabId,
  ProcurementPermissions
} from '@/types/procurement/portal.types';
import { useProcurementPermissions } from '../hooks/useProcurementPermissions';

// Portal state type
interface PortalState {
  selectedProject: {
    id: string;
    name: string;
    code: string;
  } | undefined;
  activeTab: ProcurementTabId;
  isLoading: boolean;
  error: string | undefined;
  tabBadges: Record<ProcurementTabId, { count?: number; type?: 'info' | 'warning' | 'error' | 'success' }>;
}

// Portal actions
type PortalAction = 
  | { type: 'SET_PROJECT'; payload: { id: string; name: string; code: string } | undefined }
  | { type: 'SET_ACTIVE_TAB'; payload: ProcurementTabId }
  | { type: 'SET_LOADING'; payload: boolean }
  | { type: 'SET_ERROR'; payload: string | undefined }
  | { type: 'UPDATE_TAB_BADGE'; payload: { tabId: ProcurementTabId; badge: { count?: number; type?: 'info' | 'warning' | 'error' | 'success' } } }
  | { type: 'CLEAR_TAB_BADGES' };

// Initial state
const initialState: PortalState = {
  selectedProject: undefined,
  activeTab: 'overview',
  isLoading: false,
  error: undefined,
  tabBadges: {
    overview: {},
    boq: {},
    rfq: {},
    quotes: {},
    'purchase-orders': {},
    stock: {},
    suppliers: {},
    reports: {}
  } as Record<ProcurementTabId, { count?: number; type?: 'info' | 'warning' | 'error' | 'success' }>
};

// Portal reducer
function portalReducer(state: PortalState, action: PortalAction): PortalState {
  switch (action.type) {
    case 'SET_PROJECT':
      return {
        ...state,
        selectedProject: action.payload,
        // Clear error when project changes
        error: undefined
      };
    
    case 'SET_ACTIVE_TAB':
      return {
        ...state,
        activeTab: action.payload
      };
    
    case 'SET_LOADING':
      return {
        ...state,
        isLoading: action.payload
      };
    
    case 'SET_ERROR':
      return {
        ...state,
        error: action.payload,
        isLoading: false
      };
    
    case 'UPDATE_TAB_BADGE':
      return {
        ...state,
        tabBadges: {
          ...state.tabBadges,
          [action.payload.tabId]: action.payload.badge
        }
      };
    
    case 'CLEAR_TAB_BADGES':
      return {
        ...state,
        tabBadges: {
          overview: {},
          boq: {},
          rfq: {},
          quotes: {},
          'purchase-orders': {},
          stock: {},
          suppliers: {},
          reports: {}
        } as Record<ProcurementTabId, { count?: number; type?: 'info' | 'warning' | 'error' | 'success' }>
      };
    
    default:
      return state;
  }
}

// Context creation
const PortalContext = createContext<{
  state: PortalState;
  permissions: ProcurementPermissions;
  availableTabs: ProcurementTab[];
  actions: {
    setProject: (project: { id: string; name: string; code: string } | undefined) => void;
    setActiveTab: (tab: ProcurementTabId) => void;
    setLoading: (loading: boolean) => void;
    setError: (error: string | undefined) => void;
    updateTabBadge: (tabId: ProcurementTabId, badge?: { count?: number; type?: 'info' | 'warning' | 'error' | 'success' }) => void;
    refreshData: () => Promise<void>;
  };
} | undefined>(undefined);

// Provider props
interface ProcurementPortalProviderProps {
  children: ReactNode;
}

// Portal provider component
export function ProcurementPortalProvider({ children }: ProcurementPortalProviderProps) {
  const router = useRouter();
  const searchParams = new URLSearchParams(router.query as Record<string, string>);
  const [state, dispatch] = useReducer(portalReducer, initialState);
  
  // Get permissions for selected project
  const permissions = useProcurementPermissions(state.selectedProject?.id);

  // Initialize project from URL parameters
  useEffect(() => {
    const projectId = searchParams.get('project');
    const projectName = searchParams.get('projectName');
    const projectCode = searchParams.get('projectCode');
    
    if (projectId && projectName && projectCode) {
      dispatch({
        type: 'SET_PROJECT',
        payload: { id: projectId, name: projectName, code: projectCode }
      });
    }
  }, [searchParams]);

  // Define available tabs with permissions check
  const availableTabs: ProcurementTab[] = [
    { 
      id: 'overview' as const, 
      label: 'Overview', 
      icon: BarChart3, 
      path: '/app/procurement',
      requiresProject: false,
      permission: undefined,
      badge: undefined
    },
    { 
      id: 'boq' as const, 
      label: 'BOQ', 
      icon: FileText, 
      path: '/app/procurement/boq',
      requiresProject: true,
      permission: 'buyer',
      badge: state.tabBadges.boq
    },
    { 
      id: 'rfq' as const, 
      label: 'RFQ', 
      icon: Send, 
      path: '/app/procurement/rfq',
      requiresProject: true,
      permission: 'buyer',
      badge: state.tabBadges.rfq
    },
    { 
      id: 'quotes' as const, 
      label: 'Quotes', 
      icon: Quote, 
      path: '/app/procurement/quotes',
      requiresProject: true,
      permission: 'buyer',
      badge: state.tabBadges.quotes
    },
    { 
      id: 'purchase-orders' as const, 
      label: 'Purchase Orders', 
      icon: ShoppingCart, 
      path: '/app/procurement/orders',
      requiresProject: true,
      permission: 'buyer',
      badge: state.tabBadges['purchase-orders']
    },
    { 
      id: 'stock' as const, 
      label: 'Stock', 
      icon: Package, 
      path: '/app/procurement/stock',
      requiresProject: true,
      permission: 'store-controller',
      badge: state.tabBadges.stock
    },
    { 
      id: 'suppliers' as const, 
      label: 'Suppliers', 
      icon: Truck, 
      path: '/app/procurement/suppliers',
      requiresProject: false,
      permission: 'buyer',
      badge: state.tabBadges.suppliers
    },
    { 
      id: 'reports' as const, 
      label: 'Reports', 
      icon: ClipboardList, 
      path: '/app/procurement/reports',
      requiresProject: true,
      permission: 'viewer',
      badge: state.tabBadges.reports
    }
  ].filter(tab => {
    // Always show overview
    if (tab.id === 'overview') return true;
    
    // Check if project is required and selected
    if (tab.requiresProject && !state.selectedProject) return false;
    
    // Check permissions (simplified - would integrate with real auth)
    if (tab.permission) {
      // Mock permission check - replace with real implementation
      return true; // For now, allow all tabs
    }
    
    return true;
  });

  // Action handlers
  const actions = {
    setProject: (project: { id: string; name: string; code: string } | undefined) => {
      dispatch({ type: 'SET_PROJECT', payload: project });
    },
    
    setActiveTab: (tab: ProcurementTabId) => {
      dispatch({ type: 'SET_ACTIVE_TAB', payload: tab });
    },
    
    setLoading: (loading: boolean) => {
      dispatch({ type: 'SET_LOADING', payload: loading });
    },
    
    setError: (error: string | undefined) => {
      dispatch({ type: 'SET_ERROR', payload: error });
    },
    
    updateTabBadge: (tabId: ProcurementTabId, badge?: { count?: number; type?: 'info' | 'warning' | 'error' | 'success' }) => {
      dispatch({ type: 'UPDATE_TAB_BADGE', payload: { tabId, badge: badge || {} } });
    },
    
    refreshData: async () => {
      dispatch({ type: 'SET_LOADING', payload: true });
      
      try {
        // Simulate data refresh
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        // Mock badge updates - would be replaced with real data
        if (state.selectedProject) {
          dispatch({ type: 'UPDATE_TAB_BADGE', payload: { tabId: 'boq', badge: { count: 3, type: 'info' } } });
          dispatch({ type: 'UPDATE_TAB_BADGE', payload: { tabId: 'rfq', badge: { count: 2, type: 'warning' } } });
          dispatch({ type: 'UPDATE_TAB_BADGE', payload: { tabId: 'quotes', badge: { count: 1, type: 'success' } } });
          dispatch({ type: 'UPDATE_TAB_BADGE', payload: { tabId: 'stock', badge: { count: 5, type: 'error' } } });
        } else {
          dispatch({ type: 'CLEAR_TAB_BADGES' });
        }
        
        dispatch({ type: 'SET_ERROR', payload: undefined });
      } catch (error) {
        dispatch({ type: 'SET_ERROR', payload: 'Failed to refresh data' });
      } finally {
        dispatch({ type: 'SET_LOADING', payload: false });
      }
    }
  };

  // Auto-refresh badges when project changes
  useEffect(() => {
    if (state.selectedProject) {
      actions.refreshData();
    } else {
      dispatch({ type: 'CLEAR_TAB_BADGES' });
    }
  }, [state.selectedProject]);

  const contextValue = {
    state,
    permissions,
    availableTabs,
    actions
  };

  return (
    <PortalContext.Provider value={contextValue}>
      {children}
    </PortalContext.Provider>
  );
}

// Hook to use portal context
export function useProcurementPortal() {
  const context = useContext(PortalContext);
  
  if (context === undefined) {
    throw new Error('useProcurementPortal must be used within a ProcurementPortalProvider');
  }
  
  return {
    // State
    selectedProject: context.state.selectedProject,
    activeTab: context.state.activeTab,
    isLoading: context.state.isLoading,
    error: context.state.error,
    
    // Computed values
    permissions: context.permissions,
    availableTabs: context.availableTabs,
    
    // Actions
    setProject: context.actions.setProject,
    setActiveTab: context.actions.setActiveTab,
    setLoading: context.actions.setLoading,
    setError: context.actions.setError,
    updateTabBadge: context.actions.updateTabBadge,
    refreshData: context.actions.refreshData
  };
}

// Portal context type for outlet context
export type ProcurementPortalOutletContext = ProcurementPortalContextType;