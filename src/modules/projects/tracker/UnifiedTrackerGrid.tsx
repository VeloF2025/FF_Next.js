'use client';

import { useState, useMemo } from 'react';
import { useRouter } from 'next/router';
import { Download, RefreshCw, Grid3x3 } from 'lucide-react';
import { format } from 'date-fns';
import { useTrackerData } from './hooks/useTrackerData';
import { TrackerStats } from './components/TrackerStats';
import { TrackerFilters } from './components/TrackerFilters';
import { TrackerTable } from './components/TrackerTable';

export function UnifiedTrackerGrid() {
  const router = useRouter();
  const { projectId } = router.query;
  const projectIdStr = typeof projectId === 'string' ? projectId : '';
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedType, setSelectedType] = useState<'all' | 'pole' | 'drop' | 'fiber'>('all');
  const [selectedPhase, setSelectedPhase] = useState<string>('all');
  const [selectedStatus, setSelectedStatus] = useState<string>('all');
  const [sortBy, setSortBy] = useState<'identifier' | 'status' | 'progress' | 'updated'>('identifier');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

  const { data: trackerData, isLoading, refetch } = useTrackerData(projectIdStr);

  // Filter and sort data
  const filteredData = useMemo(() => {
    if (!trackerData) return [];

    let filtered = [...trackerData];

    // Apply filters
    if (searchTerm) {
      filtered = filtered.filter(item =>
        item.identifier.toLowerCase().includes(searchTerm.toLowerCase()) ||
        item.location.toLowerCase().includes(searchTerm.toLowerCase())
      );
    }

    if (selectedType !== 'all') {
      filtered = filtered.filter(item => item.type === selectedType);
    }

    if (selectedPhase !== 'all') {
      filtered = filtered.filter(item => item.phase === selectedPhase);
    }

    if (selectedStatus !== 'all') {
      filtered = filtered.filter(item => item.status === selectedStatus);
    }

    // Apply sorting
    filtered.sort((a, b) => {
      let aVal: any;
      let bVal: any;

      if (sortBy === 'updated') {
        aVal = a.lastUpdated ? a.lastUpdated.getTime() : 0;
        bVal = b.lastUpdated ? b.lastUpdated.getTime() : 0;
      } else if (sortBy === 'identifier') {
        aVal = a.identifier;
        bVal = b.identifier;
      } else if (sortBy === 'status') {
        aVal = a.status;
        bVal = b.status;
      } else if (sortBy === 'progress') {
        aVal = a.progress;
        bVal = b.progress;
      } else {
        aVal = 0;
        bVal = 0;
      }

      if (sortOrder === 'asc') {
        return aVal > bVal ? 1 : -1;
      } else {
        return aVal < bVal ? 1 : -1;
      }
    });

    return filtered;
  }, [trackerData, searchTerm, selectedType, selectedPhase, selectedStatus, sortBy, sortOrder]);

  // Get unique phases
  const phases = useMemo(() => {
    if (!trackerData) return [];
    const uniquePhases = new Set(trackerData.map(item => item.phase).filter(Boolean));
    return Array.from(uniquePhases).sort() as string[];
  }, [trackerData]);

  // Calculate statistics
  const stats = useMemo(() => {
    if (!trackerData) return null;

    const poleStats = trackerData.filter(i => i.type === 'pole');
    const dropStats = trackerData.filter(i => i.type === 'drop');
    const fiberStats = trackerData.filter(i => i.type === 'fiber');

    return {
      poles: {
        total: poleStats.length,
        completed: poleStats.filter(i => i.status === 'completed').length,
        progress: poleStats.filter(i => i.status === 'in_progress').length,
        pending: poleStats.filter(i => i.status === 'pending').length
      },
      drops: {
        total: dropStats.length,
        completed: dropStats.filter(i => i.status === 'completed').length,
        progress: dropStats.filter(i => i.status === 'in_progress').length,
        pending: dropStats.filter(i => i.status === 'pending').length
      },
      fiber: {
        total: fiberStats.length,
        completed: fiberStats.filter(i => i.status === 'completed').length,
        progress: fiberStats.filter(i => i.status === 'in_progress').length,
        pending: fiberStats.filter(i => i.status === 'pending').length
      }
    };
  }, [trackerData]);

  const toggleRowExpansion = (id: string) => {
    const newExpanded = new Set(expandedRows);
    if (newExpanded.has(id)) {
      newExpanded.delete(id);
    } else {
      newExpanded.add(id);
    }
    setExpandedRows(newExpanded);
  };

  const exportData = () => {
    const csv = [
      ['Type', 'Identifier', 'Location', 'Phase', 'Status', 'Progress', 'Photos', 'Quality Checks', 'Last Updated'],
      ...filteredData.map(item => [
        item.type,
        item.identifier,
        item.location,
        item.phase,
        item.status,
        `${item.progress}%`,
        `${item.photos}/${item.totalPhotos}`,
        `${item.qualityChecks}/${item.totalChecks}`,
        item.lastUpdated ? format(item.lastUpdated, 'yyyy-MM-dd HH:mm') : 'N/A'
      ])
    ].map(row => row.join(',')).join('\n');

    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `tracker-export-${format(new Date(), 'yyyy-MM-dd')}.csv`;
    a.click();
  };

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Grid3x3 className="w-6 h-6" />
            Unified Tracker Grid
          </h1>
          <p className="text-muted-foreground mt-1">Track all poles, drops, and fiber sections in one place</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => refetch()}
            className="px-4 py-2 border rounded-lg hover:bg-background flex items-center gap-2"
          >
            <RefreshCw className="w-4 h-4" />
            Refresh
          </button>
          <button
            onClick={exportData}
            className="px-4 py-2 border rounded-lg hover:bg-background flex items-center gap-2"
          >
            <Download className="w-4 h-4" />
            Export
          </button>
        </div>
      </div>

      {/* Statistics */}
      <TrackerStats stats={stats} />

      {/* Filters */}
      <TrackerFilters
        searchTerm={searchTerm}
        setSearchTerm={setSearchTerm}
        selectedType={selectedType}
        setSelectedType={setSelectedType}
        selectedPhase={selectedPhase}
        setSelectedPhase={setSelectedPhase}
        selectedStatus={selectedStatus}
        setSelectedStatus={setSelectedStatus}
        sortBy={sortBy}
        sortOrder={sortOrder}
        setSortBy={setSortBy}
        setSortOrder={setSortOrder}
        phases={phases}
      />

      {/* Grid Table */}
      <TrackerTable
        data={filteredData}
        isLoading={isLoading}
        expandedRows={expandedRows}
        toggleRowExpansion={toggleRowExpansion}
      />
    </div>
  );
}