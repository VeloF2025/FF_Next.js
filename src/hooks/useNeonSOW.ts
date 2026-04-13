import { useQuery } from '@tanstack/react-query';
import { sowQueries, neonService } from '@/services/neonService';

/**
 * Hook to fetch complete SOW data for a project from Neon
 */
export function useProjectSOW(projectId?: string) {
  return useQuery({
    queryKey: ['sow-neon', projectId],
    queryFn: () => projectId ? sowQueries.getProjectSOW(projectId) : null,
    enabled: !!projectId,
    staleTime: 5 * 60 * 1000, // 5 minutes
    refetchOnWindowFocus: false,
  });
}

/**
 * Hook to fetch SOW summary statistics for a project
 */
export function useProjectSOWSummary(projectId?: string) {
  return useQuery({
    queryKey: ['sow-summary-neon', projectId],
    queryFn: () => projectId ? sowQueries.getProjectSOWSummary(projectId) : null,
    enabled: !!projectId,
    staleTime: 10 * 60 * 1000, // 10 minutes
    refetchOnWindowFocus: false,
  });
}

/**
 * Hook to fetch poles with connected drops count
 */
export function usePolesWithDrops(projectId?: string) {
  return useQuery({
    queryKey: ['poles-with-drops-neon', projectId],
    queryFn: () => projectId ? sowQueries.getPolesWithDropCount(projectId) : null,
    enabled: !!projectId,
    staleTime: 5 * 60 * 1000, // 5 minutes
    refetchOnWindowFocus: false,
  });
}

/**
 * Hook to check Neon database health and SOW table existence
 */
export function useNeonHealth() {
  return useQuery({
    queryKey: ['neon-health'],
    queryFn: async () => {
      const [health, info, tables] = await Promise.all([
        neonService.healthCheck(),
        neonService.getInfo(),
        sowQueries.checkSOWTables()
      ]);

      return {
        connected: health,
        info,
        sowTablesExist: tables.success ? tables.data.length === 3 : false,
        availableTables: tables.success ? tables.data.map((t: { table_name: string }) => t.table_name) : []
      };
    },
    staleTime: 60 * 1000, // 1 minute
    refetchOnWindowFocus: false,
  });
}

/**
 * Hook for custom Neon queries
 */
export function useNeonQuery<T = unknown>(
  queryKey: string[],
  queryText: string,
  params: unknown[] = [],
  enabled: boolean = true
) {
  return useQuery({
    queryKey: ['neon-custom', ...queryKey],
    queryFn: () => neonService.query<T>(queryText, params),
    enabled,
    staleTime: 5 * 60 * 1000, // 5 minutes
    refetchOnWindowFocus: false,
  });
}

/**
 * Helper hook to check if SOW data exists for a project
 */
export function useHasSOWData(projectId?: string) {
  const { data: sowData, isLoading } = useProjectSOW(projectId);
  
  const hasData = sowData?.success && (
    (sowData.data?.poles?.length ?? 0) > 0 ||
    (sowData.data?.drops?.length ?? 0) > 0 ||
    (sowData.data?.fibre?.length ?? 0) > 0
  );

  return {
    hasSOWData: hasData,
    isLoading,
    summary: sowData?.data?.summary || { totalPoles: 0, totalDrops: 0, totalFibre: 0 }
  };
}

/**
 * Hook to fetch poles data for a project
 */
export function useProjectPoles(projectId?: string) {
  const { data: sowData, ...rest } = useProjectSOW(projectId);
  return {
    data: sowData?.data?.poles || [],
    ...rest
  };
}

/**
 * Hook to fetch drops data for a project
 */
export function useProjectDrops(projectId?: string) {
  const { data: sowData, ...rest } = useProjectSOW(projectId);
  return {
    data: sowData?.data?.drops || [],
    ...rest
  };
}

/**
 * Hook to fetch fibre data for a project
 */
export function useProjectFibre(projectId?: string) {
  const { data: sowData, ...rest } = useProjectSOW(projectId);
  return {
    data: sowData?.data?.fibre || [],
    ...rest
  };
}