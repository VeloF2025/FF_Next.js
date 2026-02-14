import { useState } from 'react';
import { useOutletContext, useNavigate } from 'react-router-dom';
import { Package, Plus, BarChart3, AlertTriangle } from 'lucide-react';
import { Button } from '@/shared/components/ui/Button';
import type { ProcurementPortalContext } from '@/types/procurement/portal.types';
import {
  StockStatsCards,
  StockFilters,
  StockItemCard,
  MovementsTab,
  TransfersTab
} from './components';
import { useStockManagement } from './hooks/useStockManagement';
import { mockStockItems, mockStockMovements } from './data/mockData';
import type { StockTab } from './types/stock.types';

export default function StockManagementPage() {
  const navigate = useNavigate();
  const portalContext = useOutletContext<ProcurementPortalContext>();
  const { selectedProject, permissions } = portalContext || {};
  const [activeTab, setActiveTab] = useState<StockTab>('inventory');

  const {
    selectedItems,
    filterStatus,
    sortBy,
    searchTerm,
    filteredItems,
    stats,
    setSearchTerm,
    setFilterStatus,
    setSortBy,
    handleToggleSelect,
    handleBulkAction,
    handleStockAction
  } = useStockManagement(mockStockItems);

  // Filter transfers from movements
  const transferMovements = mockStockMovements.filter(m => m.type === 'transfer');

  if (!selectedProject) {
    return (
      <div className="p-6">
        <div className="text-center py-12">
          <Package className="h-12 w-12 text-gray-400 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-foreground mb-2">Select a Project</h3>
          <p className="text-muted-foreground">Choose a project to view and manage stock inventory.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Stock Management</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Track inventory, manage stock movements, and control project materials
          </p>
        </div>
        <div className="flex gap-3">
          <Button
            variant="outline"
            onClick={() => navigate('/app/procurement/stock/reports')}
          >
            <BarChart3 className="h-4 w-4 mr-2" />
            Stock Reports
          </Button>
          <Button
            onClick={() => navigate('/app/procurement/stock/receive')}
          >
            <Plus className="h-4 w-4 mr-2" />
            Receive Stock
          </Button>
        </div>
      </div>

      {/* Stock Alerts */}
      {(stats.lowStock > 0 || stats.outOfStock > 0) && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-red-600 mt-0.5" />
            <div className="flex-1">
              <h3 className="font-medium text-red-900">Stock Level Alerts</h3>
              <p className="text-sm text-red-700 mt-1">
                {stats.outOfStock > 0 && `${stats.outOfStock} item${stats.outOfStock !== 1 ? 's' : ''} out of stock. `}
                {stats.lowStock > 0 && `${stats.lowStock} item${stats.lowStock !== 1 ? 's' : ''} below minimum level.`}
                {' '}Immediate action required to avoid production delays.
              </p>
            </div>
            <Button
              size="sm"
              onClick={() => setFilterStatus('low-stock')}
              className="bg-red-600 text-white hover:bg-red-700"
            >
              View Items
            </Button>
          </div>
        </div>
      )}

      {/* Statistics Cards */}
      <StockStatsCards stats={stats} />

      {/* Main Content with Tabs */}
      <div className="bg-card rounded-lg border border-border">
        {/* Tab Navigation */}
        <div className="border-b border-border">
          <nav className="flex space-x-8 px-6">
            {[
              { key: 'inventory', label: 'Inventory' },
              { key: 'movements', label: 'Movements' },
              { key: 'transfers', label: 'Transfers' }
            ].map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key as StockTab)}
                className={`py-4 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === tab.key
                    ? 'border-primary-500 text-primary-600'
                    : 'border-transparent text-muted-foreground hover:text-muted-foreground hover:border-border'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </nav>
        </div>

        {/* Tab Content */}
        <div className="p-6">
          {/* Inventory Tab */}
          {activeTab === 'inventory' && (
            <div className="space-y-6">
              <StockFilters
                searchTerm={searchTerm}
                onSearchChange={setSearchTerm}
                filterStatus={filterStatus}
                onFilterChange={setFilterStatus}
                sortBy={sortBy}
                onSortChange={setSortBy}
                selectedCount={selectedItems.length}
                onBulkIssue={() => handleBulkAction('issue')}
                onBulkTransfer={() => handleBulkAction('transfer')}
              />

              {/* Stock Items List */}
              <div className="bg-background rounded-lg border border-border overflow-hidden">
                <div className="divide-y divide-gray-200">
                  {filteredItems.map((item) => (
                    <StockItemCard
                      key={item.id}
                      item={item}
                      isSelected={selectedItems.includes(item.id)}
                      onToggleSelect={handleToggleSelect}
                      onViewDetails={(id) => navigate(`/app/procurement/stock/${id}`)}
                      onStockAction={handleStockAction}
                      canManageStock={permissions?.canManageStock}
                    />
                  ))}
                </div>
              </div>

              {/* Empty State */}
              {filteredItems.length === 0 && (
                <div className="bg-card rounded-lg border border-border p-12 text-center">
                  <Package className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                  <h3 className="text-lg font-medium text-foreground mb-2">No stock items found</h3>
                  <p className="text-muted-foreground mb-4">
                    {searchTerm || filterStatus !== 'all'
                      ? 'Try adjusting your search or filters.'
                      : 'Start by receiving stock from purchase orders.'
                    }
                  </p>
                  <Button
                    onClick={() => navigate('/app/procurement/stock/receive')}
                  >
                    <Plus className="h-4 w-4 mr-2" />
                    Receive First Item
                  </Button>
                </div>
              )}
            </div>
          )}

          {/* Movements Tab */}
          {activeTab === 'movements' && (
            <MovementsTab
              movements={mockStockMovements}
              onViewAll={() => navigate('/app/procurement/stock/movements')}
            />
          )}

          {/* Transfers Tab */}
          {activeTab === 'transfers' && (
            <TransfersTab
              transfers={transferMovements}
              onCreateTransfer={() => navigate('/app/procurement/stock/transfers/create')}
            />
          )}
        </div>
      </div>
    </div>
  );
}
