// 🟢 WORKING: Enhanced procurement portal context provider with view modes
import React, { createContext, useContext } from 'react';
import type { ProcurementPortalContext } from '@/types/procurement/portal.types';
import type { Project } from '@/types/project.types';

// Create the context
const ProcurementPortalContext = createContext<ProcurementPortalContext | undefined>(undefined);

interface ProcurementPortalProviderProps {
  value: ProcurementPortalContext;
  children: React.ReactNode;
}

/**
 * Enhanced procurement portal provider that manages all portal state
 */
export function ProcurementPortalProvider({ value, children }: ProcurementPortalProviderProps) {
  return (
    <ProcurementPortalContext.Provider value={value}>
      {children}
    </ProcurementPortalContext.Provider>
  );
}

/**
 * Hook to access procurement portal context
 */
export function useProcurementPortal() {
  const context = useContext(ProcurementPortalContext);

  if (context === undefined) {
    throw new Error('useProcurementPortal must be used within a ProcurementPortalProvider');
  }

  return context;
}

/**
 * Optional hook that returns null when used outside of ProcurementPortalProvider
 * Use this when the component needs to work both with and without the provider
 */
export function useProcurementPortalOptional() {
  return useContext(ProcurementPortalContext) ?? null;
}

/**
 * Hook to get only the selected project
 */
export function useSelectedProject() {
  const { selectedProject } = useProcurementPortal();
  return selectedProject;
}

/**
 * Hook to get tab-specific data
 */
export function useTabData(tabId: string) {
  const { tabBadges, updateTabBadge } = useProcurementPortal();
  
  return {
    badge: tabBadges[tabId as keyof typeof tabBadges],
    updateBadge: (badge?: { count?: number; type?: 'error' | 'success' | 'warning' | 'info' }) => 
      updateTabBadge(tabId as keyof typeof tabBadges, badge)
  };
}

/**
 * Hook for project-based filtering logic
 */
export function useProjectFilter() {
  const { selectedProject, viewMode, setProject, setViewMode } = useProcurementPortal();
  
  const handleProjectChange = (project: { id: string; name: string; code: string } | undefined) => {
    // Convert simple project object to full Project type
    const projectData = project ? {
      ...project,
      projectType: 'fiber' as const,
      startDate: new Date(),
      endDate: new Date(),
      status: 'active' as const,
      priority: 'medium' as const,
      progress: 0,
      clientId: '',
      manager: ''
    } : undefined;
    setProject(projectData as Project | undefined);
    if (project) {
      setViewMode('single');
    }
  };
  
  const handleViewModeChange = (mode: 'single' | 'all') => {
    setViewMode(mode);
    if (mode === 'all') {
      setProject(undefined);
    }
  };
  
  return {
    selectedProject,
    viewMode,
    handleProjectChange,
    handleViewModeChange
  };
}

// Export the context for typing purposes
export { ProcurementPortalContext };