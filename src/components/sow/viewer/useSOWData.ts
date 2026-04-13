/**
 * Custom hook for loading SOW data
 */

import { useState, useEffect } from 'react';
import { apiSOWService } from '@/services/sow/apiSOWService';
import type { SOWData } from '@/types/sow/base.types';

export function useSOWData(projectId: string) {
  const [data, setData] = useState<SOWData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadSOWData = async () => {
    setLoading(true);
    setError(null);
    
    try {
      const result = await apiSOWService.getProjectSOWData(projectId);
      
      if (result.success) {
        setData(result.data);
      } else {
        setError(result.error || 'Failed to load SOW data');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error occurred');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSOWData();
  }, [projectId]);

  return {
    data,
    loading,
    error,
    refetch: loadSOWData
  };
}