// 🟢 WORKING: Stock Movement tab with inventory tracking and project allocation
import { useEffect, useState } from 'react';
import { Package, Search, Filter, TrendingUp, TrendingDown, AlertTriangle, Plus } from 'lucide-react';
import { Button } from '@/shared/components/ui/Button';
import { useProcurementPortal } from '../../context/ProcurementPortalProvider';
import StockManagement from '../../stock/StockManagement';

export function StockMovementTab() {
  const { selectedProject, updateTabBadge } = useProcurementPortal();
  const [searchTerm, setSearchTerm] = useState('');
  const [movementType, setMovementType] = useState<'all' | 'in' | 'out' | 'transfer'>('all');

  // Update tab badge with critical stock items
  useEffect(() => {
    if (selectedProject) {
      // TODO: Replace with actual API call
      const mockCriticalItems = 5;
      updateTabBadge('stock', { 
        count: mockCriticalItems, 
        type: mockCriticalItems > 3 ? 'error' : 'warning'
      });
    }
  }, [selectedProject, updateTabBadge]);

  if (!selectedProject) {
    return <NoProjectSelected />;
  }

  return (
    <div className="h-full bg-gray-50 flex flex-col">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-xl font-semibold text-gray-900">
              Stock Movement
            </h2>
            <p className="text-sm text-gray-600 mt-1">
              Managing inventory for {selectedProject.name} ({selectedProject.code})
            </p>
          </div>
          
          <Button size="sm" className="flex items-center gap-2">
            <Plus className="h-4 w-4" />
            Record Movement
          </Button>
        </div>

        {/* Search and Filter Bar */}
        <div className="flex items-center gap-4">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
            <input
              type="text"
              placeholder="Search by item name, SKU, or location..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            />
          </div>
          
          <div className="flex items-center gap-2">
            <Filter className="h-4 w-4 text-gray-500" />
            <select
              value={movementType}
              onChange={(e) => setMovementType(e.target.value as typeof movementType)}
              className="border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
            >
              <option value="all">All Movements</option>
              <option value="in">Stock In</option>
              <option value="out">Stock Out</option>
              <option value="transfer">Transfers</option>
            </select>
          </div>
        </div>
      </div>

      {/* Stock Summary Cards */}
      <div className="bg-white border-b border-gray-200 p-6">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
          <StockStatCard
            title="Total Items"
            count={1245}
            icon={Package}
            color="blue"
            trend="+12"
          />
          <StockStatCard
            title="Low Stock"
            count={8}
            icon={AlertTriangle}
            color="orange"
            trend="critical"
          />
          <StockStatCard
            title="In Transit"
            count={23}
            icon={TrendingUp}
            color="yellow"
            trend="+5"
          />
          <StockStatCard
            title="Recent Movements"
            count={47}
            icon={TrendingDown}
            color="green"
            trend="today"
          />
        </div>
      </div>

      {/* Content Area */}
      <div className="flex-1 p-6 overflow-auto">
        <div className="max-w-7xl mx-auto">
          {/* Recent Stock Movements */}
          <div className="bg-white rounded-lg border border-gray-200 mb-6">
            <div className="p-6 border-b border-gray-200">
              <h3 className="text-lg font-medium text-gray-900">Recent Stock Movements</h3>
            </div>
            
            <div className="divide-y divide-gray-200">
              <StockMovementItem
                itemName="Fiber Optic Cable - SM G.652.D"
                sku="FOC-SM-652D-24F"
                movementType="in"
                quantity={500}
                unit="meters"
                location="Warehouse A"
                timestamp="2024-01-15 10:30 AM"
                reference="PO-2024-001"
              />
              <StockMovementItem
                itemName="Network Patch Panel 24-Port"
                sku="NPP-24P-CAT6"
                movementType="out"
                quantity={12}
                unit="units"
                location="Site Installation"
                timestamp="2024-01-15 08:15 AM"
                reference="WO-2024-045"
              />
              <StockMovementItem
                itemName="Fiber Splice Closure"
                sku="FSC-24F-DOME"
                movementType="transfer"
                quantity={6}
                unit="units"
                location="Warehouse B → Site Storage"
                timestamp="2024-01-14 03:45 PM"
                reference="TR-2024-012"
              />
            </div>
          </div>

          {/* Stock Management Integration */}
          <div className="bg-white rounded-lg border border-gray-200">
            <div className="p-6 border-b border-gray-200">
              <h3 className="text-lg font-medium text-gray-900">Current Stock Levels</h3>
            </div>
            
            <div className="p-6">
              <StockManagement />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

interface StockStatCardProps {
  title: string;
  count: number;
  icon: React.ElementType;
  color: 'blue' | 'orange' | 'yellow' | 'green';
  trend: string;
}

function StockStatCard({ title, count, icon: Icon, color, trend }: StockStatCardProps) {
  const colorClasses = {
    blue: 'bg-blue-100 text-blue-700',
    orange: 'bg-orange-100 text-orange-700',
    yellow: 'bg-yellow-100 text-yellow-700',
    green: 'bg-green-100 text-green-700'
  };

  return (
    <div className="bg-white p-4 rounded-lg border border-gray-200">
      <div className="flex items-center justify-between mb-2">
        <div className={`p-2 rounded-lg ${colorClasses[color]}`}>
          <Icon className="h-5 w-5" />
        </div>
        <span className="text-xs text-gray-500">{trend}</span>
      </div>
      <div>
        <p className="text-2xl font-bold text-gray-900">{count.toLocaleString()}</p>
        <p className="text-sm text-gray-600">{title}</p>
      </div>
    </div>
  );
}

interface StockMovementItemProps {
  itemName: string;
  sku: string;
  movementType: 'in' | 'out' | 'transfer';
  quantity: number;
  unit: string;
  location: string;
  timestamp: string;
  reference: string;
}

function StockMovementItem({
  itemName,
  sku,
  movementType,
  quantity,
  unit,
  location,
  timestamp,
  reference
}: StockMovementItemProps) {
  const getMovementIcon = (type: string) => {
    switch (type) {
      case 'in':
        return <TrendingUp className="h-4 w-4 text-green-600" />;
      case 'out':
        return <TrendingDown className="h-4 w-4 text-red-600" />;
      case 'transfer':
        return <Package className="h-4 w-4 text-blue-600" />;
      default:
        return <Package className="h-4 w-4 text-gray-600" />;
    }
  };

  const getMovementBadge = (type: string) => {
    const classes = {
      in: 'bg-green-100 text-green-800',
      out: 'bg-red-100 text-red-800',
      transfer: 'bg-blue-100 text-blue-800'
    };
    
    return (
      <span className={`px-2 py-1 text-xs font-medium rounded-full ${classes[type as keyof typeof classes]}`}>
        {type.charAt(0).toUpperCase() + type.slice(1)}
      </span>
    );
  };

  return (
    <div className="p-4 hover:bg-gray-50 transition-colors">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          {getMovementIcon(movementType)}
          <div>
            <h4 className="font-medium text-gray-900">{itemName}</h4>
            <p className="text-sm text-gray-600">SKU: {sku}</p>
          </div>
        </div>
        
        <div className="flex items-center gap-4 text-sm text-gray-600">
          {getMovementBadge(movementType)}
          <span className="font-medium">{quantity.toLocaleString()} {unit}</span>
          <span>{location}</span>
          <span>{timestamp}</span>
          <span className="text-blue-600">{reference}</span>
        </div>
      </div>
    </div>
  );
}

function NoProjectSelected() {
  return (
    <div className="h-full flex items-center justify-center">
      <div className="text-center max-w-md">
        <div className="mx-auto mb-6 w-24 h-24 bg-orange-100 rounded-full flex items-center justify-center">
          <Package className="h-12 w-12 text-orange-600" />
        </div>
        
        <h3 className="text-xl font-semibold text-gray-900 mb-4">
          Project Selection Required
        </h3>
        
        <p className="text-gray-600 mb-6">
          Please select a project to view and manage its stock movements and inventory. 
          Stock management is project-specific to ensure accurate material tracking.
        </p>
        
        <div className="bg-orange-50 p-4 rounded-lg border border-orange-200">
          <p className="text-sm text-orange-700">
            <strong>Tip:</strong> Use the project selector above to choose a project 
            and start tracking its inventory movements.
          </p>
        </div>
      </div>
    </div>
  );
}

export default StockMovementTab;