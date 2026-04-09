import React from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { projectService } from '@/services/projectService';
import { log } from '@/lib/logger';
import {
  Project,
  ProjectFormData,
  ProjectFilter
} from '@/types/project.types';

// Query Keys
export const projectKeys = {
  all: ['projects'] as const,
  lists: () => [...projectKeys.all, 'list'] as const,
  list: (filter?: ProjectFilter) => [...projectKeys.lists(), filter] as const,
  details: () => [...projectKeys.all, 'detail'] as const,
  detail: (id: string) => [...projectKeys.details(), id] as const,
  hierarchy: (id: string) => [...projectKeys.all, 'hierarchy', id] as const,
  summary: () => [...projectKeys.all, 'summary'] as const,
};

/**
 * Hook for fetching all projects with optional filtering
 */
export function useProjects(filter?: ProjectFilter) {
  return useQuery({
    queryKey: projectKeys.list(filter),
    queryFn: () => projectService.getAll(filter),
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 10 * 60 * 1000, // 10 minutes
  });
}

/**
 * Hook for fetching a single project
 */
export function useProject(id: string, enabled = true) {
  return useQuery({
    queryKey: projectKeys.detail(id),
    queryFn: () => projectService.getById(id),
    enabled: !!id && enabled,
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });
}

/**
 * Hook for fetching complete project hierarchy
 */
export function useProjectHierarchy(id: string, enabled = true) {
  return useQuery({
    queryKey: projectKeys.hierarchy(id),
    queryFn: async () => {
      // For now, just return the project data
      // TODO: Implement proper hierarchy fetching
      const project = await projectService.getById(id);
      return project ? { project, phases: [] } : null;
    },
    enabled: !!id && enabled,
    staleTime: 2 * 60 * 1000, // 2 minutes (more dynamic data)
    gcTime: 5 * 60 * 1000,
  });
}

/**
 * Hook for fetching project summary statistics
 */
export function useProjectSummary() {
  return useQuery({
    queryKey: projectKeys.summary(),
    queryFn: () => projectService.getProjectSummary(),
    staleTime: 10 * 60 * 1000, // 10 minutes (less dynamic)
    gcTime: 15 * 60 * 1000,
  });
}

/**
 * Hook for creating a new project
 */
export function useCreateProject() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: ProjectFormData) => projectService.create(data),
    onSuccess: () => {
      // Invalidate and refetch project lists
      queryClient.invalidateQueries({ queryKey: projectKeys.lists() });
      queryClient.invalidateQueries({ queryKey: projectKeys.summary() });
    },
    onError: (error) => {
      log.error('Failed to create project:', { data: error }, 'useProjects');
    },
  });
}

/**
 * Hook for updating a project
 */
export function useUpdateProject() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<ProjectFormData> }) =>
      projectService.update(id, data),
    onSuccess: (_, variables) => {
      // Invalidate affected queries
      queryClient.invalidateQueries({ queryKey: projectKeys.detail(variables.id) });
      queryClient.invalidateQueries({ queryKey: projectKeys.hierarchy(variables.id) });
      queryClient.invalidateQueries({ queryKey: projectKeys.lists() });
      queryClient.invalidateQueries({ queryKey: projectKeys.summary() });
    },
    onError: (error) => {
      log.error('Failed to update project:', { data: error }, 'useProjects');
    },
  });
}

/**
 * Hook for deleting a project
 */
export function useDeleteProject() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => projectService.delete(id),
    onSuccess: (_, deletedId) => {
      // Remove from cache and invalidate lists
      queryClient.removeQueries({ queryKey: projectKeys.detail(deletedId) });
      queryClient.removeQueries({ queryKey: projectKeys.hierarchy(deletedId) });
      queryClient.invalidateQueries({ queryKey: projectKeys.lists() });
      queryClient.invalidateQueries({ queryKey: projectKeys.summary() });
    },
    onError: (error) => {
      log.error('Failed to delete project:', { data: error }, 'useProjects');
    },
  });
}

/**
 * Hook for initializing project phases
 */
export function useInitializeProjectPhases() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ projectId, projectType }: { projectId: string; projectType: string }) => 
      projectService.generatePhases(projectId, projectType),
    onSuccess: (_, variables) => {
      // Invalidate hierarchy to show new phases
      queryClient.invalidateQueries({ queryKey: projectKeys.hierarchy(variables.projectId) });
    },
    onError: (error) => {
      log.error('Failed to initialize project phases:', { data: error }, 'useProjects');
    },
  });
}

/**
 * Hook for updating project progress
 */
export function useUpdateProjectProgress() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ projectId, data }: { projectId: string; data: any }) => projectService.update(projectId, data),
    onSuccess: (_, variables) => {
      // Invalidate project data to show updated progress
      queryClient.invalidateQueries({ queryKey: projectKeys.detail(variables.projectId) });
      queryClient.invalidateQueries({ queryKey: projectKeys.lists() });
      queryClient.invalidateQueries({ queryKey: projectKeys.summary() });
    },
    onError: (error) => {
      log.error('Failed to update project progress:', { data: error }, 'useProjects');
    },
  });
}

/**
 * Hook for real-time project subscription (optional alternative to React Query)
 */
export function useProjectSubscription(id: string, enabled = true) {
  const queryClient = useQueryClient();

  const enableSubscription = !!id && enabled;

  // Set up subscription effect
  React.useEffect(() => {
    if (!enableSubscription) return;

    const unsubscribe = projectService.subscribeToProject(id, (project: Project | null) => {
      // Update the cache directly with real-time data
      queryClient.setQueryData(projectKeys.detail(id), project);
    });

    return unsubscribe;
  }, [id, enableSubscription, queryClient]);
}

/**
 * Hook for real-time projects list subscription
 */
export function useProjectsSubscription(filter?: ProjectFilter, enabled = true) {
  const queryClient = useQueryClient();

  React.useEffect(() => {
    if (!enabled) return;

    const subscribeFilter: { status?: string; clientId?: string } = {};
    if (filter?.status?.[0]) subscribeFilter.status = filter.status[0];
    if (filter?.clientId?.[0]) subscribeFilter.clientId = filter.clientId[0];
    
    const unsubscribe = projectService.subscribeToProjects((projects: Project[]) => {
      // Update the cache with real-time data
      queryClient.setQueryData(projectKeys.list(filter), projects);
    }, subscribeFilter);

    return unsubscribe;
  }, [filter, enabled, queryClient]);
}

// Utility hooks for common project operations

/**
 * Hook that combines project data with loading states for forms
 */
export function useProjectForm(id?: string) {
  const { data: project, isLoading } = useProject(id || '', !!id);
  const createMutation = useCreateProject();
  const updateMutation = useUpdateProject();

  const isCreating = createMutation.isPending;
  const isUpdating = updateMutation.isPending;
  const isSaving = isCreating || isUpdating;

  const save = React.useCallback(
    async (data: ProjectFormData) => {
      if (id) {
        await updateMutation.mutateAsync({ id, data });
        return id;
      } else {
        const newId = await createMutation.mutateAsync(data);
        return newId;
      }
    },
    [id, createMutation, updateMutation]
  );

  return {
    project,
    isLoading: isLoading || isSaving,
    isCreating,
    isUpdating,
    isSaving,
    save,
    error: createMutation.error || updateMutation.error,
  };
}

/**
 * Hook for managing project filters with URL synchronization
 */
export function useProjectFilters() {
  const [filter, setFilter] = React.useState<ProjectFilter>({});
  
  const updateFilter = React.useCallback((updates: Partial<ProjectFilter>) => {
    setFilter(prev => ({ ...prev, ...updates }));
  }, []);

  const clearFilter = React.useCallback(() => {
    setFilter({});
  }, []);

  const hasActiveFilters = React.useMemo(() => {
    return Object.values(filter).some(value => 
      Array.isArray(value) ? value.length > 0 : !!value
    );
  }, [filter]);

  return {
    filter,
    updateFilter,
    clearFilter,
    hasActiveFilters,
  };
}

