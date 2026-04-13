
import {
  DropsHeader,
  DropsStatsCards,
  DropsFilters,
  DropsGrid,
  useDropsManagement
} from './DropsManagement/index';
import type { DropsFiltersState } from './DropsManagement/types/drops.types';

export function DropsManagement() {
  const {
    stats,
    allDropsStats,
    filters,
    filteredDrops,
    updateFilters,
    loading,
    error,
    searchDrops
  } = useDropsManagement();

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-lg text-[var(--ff-text-secondary)]">Loading drops data from database...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-500/20 border border-red-500/30 rounded-lg p-4">
        <p className="text-red-400">Error loading drops: {error}</p>
        <p className="text-sm text-red-400 mt-2">Using fallback data</p>
      </div>
    );
  }

  const handleFiltersChange = async (newFilters: Partial<DropsFiltersState>) => {
    updateFilters(newFilters);

    // If search term or status filter changed, perform server-side search
    if ('searchTerm' in newFilters || 'statusFilter' in newFilters) {
      await searchDrops(
        newFilters.searchTerm || filters.searchTerm,
        newFilters.statusFilter || filters.statusFilter
      );
    }
  };

  return (
    <div className="p-6 space-y-6">
      <DropsHeader stats={allDropsStats} />
      <DropsStatsCards stats={stats} allDropsStats={allDropsStats} />
      <DropsFilters filters={filters} onFiltersChange={handleFiltersChange} />
      <DropsGrid drops={filteredDrops} />
    </div>
  );
}