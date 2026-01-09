import { useQuery, useQueryClient } from '@tanstack/react-query';

/**
 * SOW Service Hook
 *
 * NOTE: Firebase Firestore has been removed. SOW data is now stored in Neon PostgreSQL.
 * The save/get/delete operations should be performed through the API endpoints:
 * - POST /api/sow/poles, /api/sow/drops, /api/sow/fibre
 * - GET /api/sow/project?projectId=xxx
 */
export function useSOWService() {
  const queryClient = useQueryClient();

  const saveSOWData = async (projectId: string, type: string, data: unknown[]) => {
    // SOW data should be saved via API endpoints
    // Use the import scripts in /scripts/sow-import/ or API endpoints
    const response = await fetch(`/api/sow/${type}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId, data }),
    });

    if (!response.ok) {
      throw new Error(`Failed to save SOW ${type} data`);
    }

    // Invalidate related queries
    queryClient.invalidateQueries({ queryKey: ['sow', projectId] });
    queryClient.invalidateQueries({ queryKey: ['project', projectId] });
  };

  const getSOWData = async (projectId: string, type?: string) => {
    const endpoint = type
      ? `/api/sow/${type}?projectId=${projectId}`
      : `/api/sow/project?projectId=${projectId}`;

    const response = await fetch(endpoint);
    if (!response.ok) {
      throw new Error('Failed to fetch SOW data');
    }
    const result = await response.json();
    return result.success ? result.data : null;
  };

  const deleteSOWData = async (projectId: string, type: string) => {
    const response = await fetch(`/api/sow/${type}?projectId=${projectId}`, {
      method: 'DELETE',
    });

    if (!response.ok) {
      throw new Error(`Failed to delete SOW ${type} data`);
    }

    // Invalidate related queries
    queryClient.invalidateQueries({ queryKey: ['sow', projectId] });
    queryClient.invalidateQueries({ queryKey: ['project', projectId] });
  };

  return {
    saveSOWData,
    getSOWData,
    deleteSOWData
  };
}

export function useProjectSOW(projectId: string) {
  return useQuery({
    queryKey: ['sow', projectId],
    queryFn: async () => {
      const response = await fetch(`/api/sow/project?projectId=${projectId}`);
      if (!response.ok) {
        throw new Error('Failed to fetch SOW data');
      }
      const result = await response.json();
      return result.success ? result.data : {};
    },
    enabled: !!projectId
  });
}

export function useProjectPoles(projectId: string) {
  return useQuery({
    queryKey: ['poles', projectId],
    queryFn: async () => {
      const response = await fetch(`/api/sow/poles?projectId=${projectId}`);
      if (!response.ok) {
        throw new Error('Failed to fetch poles data');
      }
      const result = await response.json();
      return result.success ? result.data : [];
    },
    enabled: !!projectId
  });
}

export function useProjectDrops(projectId: string) {
  return useQuery({
    queryKey: ['drops', projectId],
    queryFn: async () => {
      const response = await fetch(`/api/sow/drops?projectId=${projectId}`);
      if (!response.ok) {
        throw new Error('Failed to fetch drops data');
      }
      const result = await response.json();
      return result.success ? result.data : [];
    },
    enabled: !!projectId
  });
}

export function useProjectFibre(projectId: string) {
  return useQuery({
    queryKey: ['fibre', projectId],
    queryFn: async () => {
      const response = await fetch(`/api/sow/fibre?projectId=${projectId}`);
      if (!response.ok) {
        throw new Error('Failed to fetch fibre data');
      }
      const result = await response.json();
      return result.success ? result.data : [];
    },
    enabled: !!projectId
  });
}
