import { useState, useEffect } from 'react';
import { SOW, SOWFilterType } from '../types/sow.types';
import { log } from '@/lib/logger';

interface SowListItem {
  project_id: string;
  project_name?: string;
  project_code?: string;
  type: 'pole' | 'drop' | 'fibre';
  address?: string;
  is_spare?: boolean;
  distance?: string | number;
}

export function useSOWData() {
  const [sows, setSOWs] = useState<SOW[]>([]);
  const [filter, setFilter] = useState<SOWFilterType>('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchSOWData();
  }, []);

  const fetchSOWData = async () => {
    try {
      setLoading(true);
      
      // Use the combined SOW list API that fetches all types at once
      const sowResponse = await fetch('/api/sow/list?type=all&pageSize=1000');
      const sowResult = await sowResponse.json();
      
      if (!sowResult.success) {
        throw new Error(sowResult.error || 'Failed to fetch SOW data');
      }
      
      const sowData = sowResult.data || [];
      
      // Group data by project
      const projectMap = new Map();
      
      sowData.forEach((item: SowListItem) => {
        const projectId = item.project_id;
        if (!projectMap.has(projectId)) {
          projectMap.set(projectId, {
            project_id: projectId,
            project_name: item.project_name || 'Unknown Project',
            project_code: item.project_code || '',
            poles: [],
            drops: [],
            fibre: []
          });
        }
        
        const project = projectMap.get(projectId);
        if (item.type === 'pole') {
          project.poles.push(item);
        } else if (item.type === 'drop') {
          project.drops.push(item);
        } else if (item.type === 'fibre') {
          project.fibre.push(item);
        }
      });
      
      // Convert to SOW objects
      const sows = Array.from(projectMap.values()).map(projectData => {
        const totalPoles = projectData.poles.length;
        const totalDrops = projectData.drops.length;
        const totalFibre = projectData.fibre.length;
        
        // Calculate houses vs spares from drops
        // Prefer is_spare flag from DB; fall back to address heuristic for legacy data
        const spares = projectData.drops.filter((d: SowListItem) =>
          d.is_spare === true || (d.is_spare === undefined && d.address && (d.address === 'Spare' || d.address.toLowerCase().includes('spare')))
        ).length;
        const houses = projectData.drops.length - spares;
        
        // Calculate total fibre distance
        const totalFibreDistance = projectData.fibre.reduce((sum: number, segment: SowListItem) =>
          sum + (parseFloat(String(segment.distance)) || 0), 0
        );
        
        const sow: SOW = {
          id: projectData.project_id,
          sowNumber: `SOW-${projectData.project_code || projectData.project_id.substring(0, 8)}`,
          projectName: projectData.project_name,
          clientName: 'Lawley Municipality', // Default for now
          status: totalPoles > 0 || totalDrops > 0 || totalFibre > 0 ? 'active' : 'draft',
          version: '1.0',
          value: 0,
          currency: 'ZAR',
          startDate: new Date().toISOString(),
          endDate: new Date().toISOString(),
          scope: [
            `${totalPoles} poles`,
            `${houses} houses connected`,
            `${spares} spare drops`,
            `${totalFibre} fibre segments (${(totalFibreDistance / 1000).toFixed(2)}km)`
          ],
          deliverables: [
            'Network infrastructure data',
            'Poles and drops mapping',
            'Fibre route documentation'
          ],
          milestones: [],
          approvals: [],
          documents: [],
          createdDate: new Date().toISOString(),
          lastModified: new Date().toISOString(),
          createdBy: 'System Import',
          importedData: {
            poles: totalPoles,
            drops: totalDrops,
            houses: houses,
            spares: spares,
            fibre: totalFibre,
            fibreDistance: totalFibreDistance
          }
        };
        
        return sow;
      });
      
      setSOWs(sows);
      setError(null);
    } catch (err) {
      log.error('Error fetching SOW data', { error: err }, 'useSOWData');
      setError('Failed to load SOW data');
      setSOWs([]);
    } finally {
      setLoading(false);
    }
  };

  const filteredSOWs = filter === 'all' 
    ? sows 
    : sows.filter(sow => sow.status === filter);

  return {
    sows,
    filteredSOWs,
    filter,
    setFilter,
    loading,
    error,
    refetch: fetchSOWData
  };
}