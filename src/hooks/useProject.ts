/**
 * Project Hook
 * Provides current project context and utilities
 */

import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import { projectsService } from '@/services/projectsService';
import { log } from '@/lib/logger';

export interface Project {
  id: string;
  name: string;
  code: string;
  status: string;
  clientId?: string;
  clientName?: string;
  description?: string;
  startDate?: Date;
  endDate?: Date;
  budget?: number;
  metadata?: Record<string, any>;
}

interface UseProjectResult {
  currentProject: Project | null;
  isLoading: boolean;
  error: string | null;
  setCurrentProject: (project: Project | null) => void;
  refreshProject: () => Promise<void>;
}

export function useProject(): UseProjectResult {
  const router = useRouter();
  const { projectId } = router.query as Record<string, string>;
  const [currentProject, setCurrentProject] = useState<Project | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadProject = async (id: string) => {
    try {
      setIsLoading(true);
      setError(null);
      const project = await projectsService.getById(id);
      setCurrentProject(project);
    } catch (err) {
      log.error('Failed to load project:', { data: err }, 'useProject');
      setError(err instanceof Error ? err.message : 'Failed to load project');
      setCurrentProject(null);
    } finally {
      setIsLoading(false);
    }
  };

  const refreshProject = async () => {
    if (projectId) {
      await loadProject(projectId);
    }
  };

  useEffect(() => {
    if (projectId) {
      loadProject(projectId);
    } else {
      // Try to get from localStorage or context
      const storedProjectId = localStorage.getItem('currentProjectId');
      if (storedProjectId) {
        loadProject(storedProjectId);
      }
    }
  }, [projectId]);

  return {
    currentProject,
    isLoading,
    error,
    setCurrentProject,
    refreshProject
  };
}