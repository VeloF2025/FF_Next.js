import { SOWHeader, SOWStats, SOWFilters, SOWTable } from './components';
import { useSOWData } from './hooks/useSOWData';

export function SOWManagement() {
  const { sows, filteredSOWs, filter, setFilter, loading, error } = useSOWData();

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto"></div>
          <p className="mt-4 text-muted-foreground">Loading SOW data from database...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center text-red-600">
          <p className="text-xl font-semibold">Error loading SOW data</p>
          <p className="mt-2">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <SOWHeader />
      <SOWStats sows={sows} />
      <SOWFilters filter={filter} onFilterChange={setFilter} />
      <SOWTable sows={filteredSOWs} />
      {sows.length === 0 && (
        <div className="text-center py-8 text-muted-foreground">
          <p className="text-lg">No SOW data found</p>
          <p className="mt-2">Import SOW data through the project import wizard to see it here</p>
        </div>
      )}
    </div>
  );
}