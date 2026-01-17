/**
 * Stock Management Module - Main Tab Component
 * Comprehensive inventory management with dashboard, operations, and warehouse management
 */

import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import {
  Package,
  TrendingUp,
  AlertTriangle,
  BarChart3,
  Truck,
  Scan
} from 'lucide-react';
import { Button } from '@/shared/components/ui/Button';
// import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/shared/components/ui/Tabs';
import type { StockItem } from '@/types/procurement/stock.types';
import { log } from '@/lib/logger';

// Component imports - TODO: Implement these components
// import InventoryDashboard from './components/InventoryDashboard';
// import GoodsReceiptProcess from './components/GoodsReceiptProcess';
// import StockOperations from './components/StockOperations';
// import WarehouseManager from './components/WarehouseManager';
// import StockReports from './components/StockReports';

interface StockMetrics {
  totalItems: number;
  totalValue: number;
  lowStockItems: number;
  outOfStockItems: number;
  pendingReceipts: number;
  pendingIssues: number;
  stockTurnover: number;
  warehouseUtilization: number;
}

interface StockManagementProps {
  projectId?: string;
  projectName?: string;
  stockItems?: StockItem[];
}

export default function StockManagement({ projectId, projectName, stockItems = [] }: StockManagementProps) {
  const router = useRouter();
  const { tab } = router.query;

  // State
  const [activeTab, setActiveTab] = useState<string>((tab as string) || 'dashboard');
  const [, setIsLoading] = useState(true);
  const [, setError] = useState<string | null>(null);
  const [metrics, setMetrics] = useState<StockMetrics>({
    totalItems: 0,
    totalValue: 0,
    lowStockItems: 0,
    outOfStockItems: 0,
    pendingReceipts: 0,
    pendingIssues: 0,
    stockTurnover: 0,
    warehouseUtilization: 0
  });

  // Load stock metrics
  useEffect(() => {
    const loadMetrics = async () => {
      try {
        setIsLoading(true);

        // TODO: Replace with actual API call
        // Mock data for now - use stockItems if available
        const mockMetrics: StockMetrics = {
          totalItems: stockItems.length || 147,
          totalValue: 2847593.45,
          lowStockItems: 8,
          outOfStockItems: 3,
          pendingReceipts: 12,
          pendingIssues: 5,
          stockTurnover: 3.2,
          warehouseUtilization: 78.5
        };

        // Simulate API delay
        await new Promise(resolve => setTimeout(resolve, 500));

        setMetrics(mockMetrics);
        setError(null);
      } catch (err) {
        log.error('Failed to load stock metrics:', { data: err }, 'StockManagement');
        setError('Failed to load stock data. Please try again.');
      } finally {
        setIsLoading(false);
      }
    };

    loadMetrics();
  }, [projectId, stockItems]);


  // Refresh data
  const handleRefresh = () => {
    // Trigger refresh in child components
    window.dispatchEvent(new CustomEvent('stockDataRefresh'));
  };

  // Note: Permission checks are now handled at the page level

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[var(--ff-text-primary)]">Stock Management</h1>
          {projectName && (
            <p className="text-sm text-[var(--ff-text-secondary)] mt-1">
              Comprehensive inventory control for {projectName}
            </p>
          )}
        </div>
        
        <div className="flex items-center gap-3">
          {/* Barcode Scanner Integration */}
          <Button
            variant="outline"
            onClick={() => {
              // TODO: Integrate with barcode scanning library

            }}
            className="hidden sm:flex"
          >
            <Scan className="h-4 w-4 mr-2" />
            Scan Barcode
          </Button>
          
          {/* Stock Reports */}
          <Button
            variant="outline"
            onClick={() => setActiveTab('reports')}
          >
            <BarChart3 className="h-4 w-4 mr-2" />
            Reports
          </Button>
          
          {/* Refresh Data */}
          <Button
            variant="outline"
            onClick={handleRefresh}
          >
            <TrendingUp className="h-4 w-4 mr-2" />
            Refresh
          </Button>
        </div>
      </div>

      {/* Critical Alerts */}
      {(metrics.lowStockItems > 0 || metrics.outOfStockItems > 0) && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-red-600 mt-0.5" />
            <div className="flex-1">
              <h3 className="font-medium text-red-900">Stock Level Alerts</h3>
              <p className="text-sm text-red-700 mt-1">
                {metrics.outOfStockItems > 0 && 
                  `${metrics.outOfStockItems} item${metrics.outOfStockItems !== 1 ? 's' : ''} out of stock. `
                }
                {metrics.lowStockItems > 0 && 
                  `${metrics.lowStockItems} item${metrics.lowStockItems !== 1 ? 's' : ''} below minimum level. `
                }
                Immediate action required to prevent project delays.
              </p>
            </div>
            <Button
              size="sm"
              onClick={() => setActiveTab('dashboard')}
              className="bg-red-600 text-white hover:bg-red-700"
            >
              View Details
            </Button>
          </div>
        </div>
      )}

      {/* Key Metrics Overview */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <div className="flex items-center">
            <div className="p-2 bg-blue-100 rounded-lg">
              <Package className="h-5 w-5 text-blue-600" />
            </div>
            <div className="ml-3">
              <p className="text-sm text-gray-500">Total Items</p>
              <p className="text-xl font-bold text-gray-900">{metrics.totalItems.toLocaleString()}</p>
            </div>
          </div>
        </div>
        
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <div className="flex items-center">
            <div className="p-2 bg-green-100 rounded-lg">
              <TrendingUp className="h-5 w-5 text-green-600" />
            </div>
            <div className="ml-3">
              <p className="text-sm text-gray-500">Total Value</p>
              <p className="text-xl font-bold text-green-600">
                R {(metrics.totalValue / 1000).toFixed(0)}k
              </p>
            </div>
          </div>
        </div>
        
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <div className="flex items-center">
            <div className="p-2 bg-red-100 rounded-lg">
              <AlertTriangle className="h-5 w-5 text-red-600" />
            </div>
            <div className="ml-3">
              <p className="text-sm text-gray-500">Critical Stock</p>
              <p className="text-xl font-bold text-red-600">
                {metrics.lowStockItems + metrics.outOfStockItems}
              </p>
            </div>
          </div>
        </div>
        
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <div className="flex items-center">
            <div className="p-2 bg-orange-100 rounded-lg">
              <Truck className="h-5 w-5 text-orange-600" />
            </div>
            <div className="ml-3">
              <p className="text-sm text-gray-500">Pending</p>
              <p className="text-xl font-bold text-orange-600">
                {metrics.pendingReceipts + metrics.pendingIssues}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content - TODO: Implement Stock Management components */}
      <div className="bg-white rounded-lg border p-6">
        <div className="text-center py-12">
          <Package className="mx-auto h-12 w-12 text-gray-400" />
          <h3 className="mt-4 text-lg font-medium text-gray-900">Stock Management</h3>
          <p className="mt-2 text-gray-500">
            This module is under development. Stock management features including inventory dashboard, 
            goods receipts, stock operations, warehouse management, and reporting will be available here.
          </p>
          <div className="mt-6 text-sm text-gray-400">
            Current tab: {activeTab}
          </div>
        </div>
      </div>
    </div>
  );
}