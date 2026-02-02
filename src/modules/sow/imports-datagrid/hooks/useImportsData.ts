// ============= Imports Data Hook =============

import { useState, useEffect } from 'react';
import toast from 'react-hot-toast';
import { log } from '@/lib/logger';
import type {
  PoleData,
  FibreData,
  DropData,
  OneMapData,
  NokiaData,
  LinkingStats,
  MatchingMode
} from '../types/types';

interface UseImportsDataProps {
  projectId: string;
  matchingMode: MatchingMode;
}

export const useImportsData = ({ projectId, matchingMode }: UseImportsDataProps) => {
  const [polesData, setPolesData] = useState<PoleData[]>([]);
  const [fibreData, setFibreData] = useState<FibreData[]>([]);
  const [dropsData, setDropsData] = useState<DropData[]>([]);
  const [onemapData, setOnemapData] = useState<OneMapData[]>([]);
  const [nokiaData, setNokiaData] = useState<NokiaData[]>([]);
  const [loading, setLoading] = useState(false);
  const [linkingStats, setLinkingStats] = useState<LinkingStats | null>(null);

  useEffect(() => {
    if (projectId) {
      fetchAllData();
    }
  }, [projectId, matchingMode]);

  const fetchAllData = async () => {
    setLoading(true);
    try {
      const [polesRes, fibreRes, dropsRes, onemapRes, nokiaRes] = await Promise.all([
        fetch(`/api/sow/poles?projectId=${projectId}`),
        fetch(`/api/sow/fibre?projectId=${projectId}`),
        fetch(`/api/sow/drops?projectId=${projectId}`),
        fetch(`/api/onemap/properties-enhanced?projectId=${projectId}&matchingMode=${matchingMode}`),
        fetch(`/api/nokia/velocity?projectId=${projectId}`)
      ]);

      const [poles, fibre, drops, onemap, nokia] = await Promise.all([
        polesRes.json(),
        fibreRes.json(),
        dropsRes.json(),
        onemapRes.ok ? onemapRes.json() : { data: [] },
        nokiaRes.ok ? nokiaRes.json() : { data: [] }
      ]);

      setPolesData(poles.data || []);
      setFibreData(fibre.data || []);
      setDropsData(drops.data || []);
      setOnemapData(onemap.data || []);
      setNokiaData(nokia.data || []);
      setLinkingStats(onemap.stats || null);

      // Show linking statistics
      if (onemap.stats) {
        const msg = `Loaded ${onemap.stats.total} records: ${onemap.stats.linked} linked (${onemap.stats.linkingRate}%)`;
        toast.success(msg);
      } else {
        toast.success('Import data loaded successfully');
      }
    } catch (error) {
      log.error('Error fetching import data', { error, projectId, matchingMode }, 'useImportsData');
      toast.error('Failed to load import data');
    } finally {
      setLoading(false);
    }
  };

  return {
    polesData,
    fibreData,
    dropsData,
    onemapData,
    nokiaData,
    loading,
    linkingStats
  };
};
