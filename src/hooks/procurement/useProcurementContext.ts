/**
 * Procurement Context Hook
 * Provides procurement-specific context and utilities
 */

import { ProcurementContext } from '@/types/procurement/base.types';
import { useAuth } from '@/contexts/AuthContext';
import { useProject } from '@/hooks/useProject';

interface ProcurementContextResult {
  context: ProcurementContext | null;
  isLoading: boolean;
  error: string | null;
  hasContext: boolean;
}

export function useProcurementContext(): ProcurementContextResult {
  const { user, loading: authLoading } = useAuth();
  const { currentProject, isLoading: projectLoading } = useProject();

  const isLoading = authLoading || projectLoading;

  const error = !user ? 'User not authenticated' :
                !currentProject ? 'No project selected' : null;

  const context: ProcurementContext | null = user && currentProject ? {
    userId: user.uid,
    userName: user.displayName || user.email || 'Unknown User',
    projectId: currentProject.id,
    projectName: currentProject.name,
    permissions: {
      canCreateBOQ: true,
      canEditBOQ: true,
      canDeleteBOQ: false,
      canApproveBOQ: false,
      canCreateRFQ: true,
      canEditRFQ: true,
      canDeleteRFQ: false,
      canCreatePO: true,
      canEditPO: true,
      canDeletePO: false,
      canApprovePO: false,
      canManageStock: true,
      canViewReports: true,
      isAdmin: false
    },
    metadata: {
      userEmail: user.email || '',
      timestamp: new Date()
    }
  } : null;

  return {
    context,
    isLoading,
    error,
    hasContext: !!context
  };
}