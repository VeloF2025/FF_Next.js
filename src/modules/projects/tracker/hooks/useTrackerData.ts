import { useQuery } from '@tanstack/react-query';
import { TrackerGridItem } from '../types/tracker.types';

/**
 * Hook to fetch tracker data (poles, drops, fiber sections) for a project
 *
 * NOTE: This previously used Firebase Firestore. The data has been migrated to Neon PostgreSQL.
 * The tracker functionality is currently disabled pending full migration.
 * Poles/drops data is now available through the SOW import system.
 *
 * TODO: Implement Neon API endpoint for tracker data if this feature is still needed
 */
export function useTrackerData(projectId: string | undefined) {
  return useQuery({
    queryKey: ['unified-trackers', projectId],
    queryFn: async (): Promise<TrackerGridItem[]> => {
      if (!projectId) return [];

      // Firebase Firestore has been removed
      // Return empty array - tracker data should come from Neon if needed
      // See: /api/sow/drops and /api/sow/fibre for SOW data
      return [];
    },
    enabled: !!projectId
  });
}
