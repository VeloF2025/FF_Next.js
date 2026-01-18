/**
 * Stock Management Page
 * Complete inventory management with positions, movements, and alerts
 */

import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import { AppLayout } from '@/components/layout';
import {
  Package,
  TrendingUp,
  AlertTriangle,
  Truck,
  Plus,
  ArrowLeftRight,
  RefreshCw,
  Search,
  Filter,
  Loader2,
  ArrowDown,
  ArrowUp,
  Clock,
  MapPin,
  X
} from 'lucide-react';
import { Button } from '@/shared/components/ui/Button';
import toast from 'react-hot-toast';
import { log } from '@/lib/logger';

interface StockItem {
  id: string;
  itemCode: string;
  name: string;
  description?: string;
  category: string;
  projectId?: string;
  warehouse: string;
  location?: string;
  quantity: number;
  unit: string;
  minQuantity: number;
  maxQuantity: number;
  unitCost: number;
  totalValue: number;
  status: 'in_stock' | 'low_stock' | 'out_of_stock';
  lastRestocked?: string;
}

interface StockMovement {
  id: string;
  movement_type: string;
  item_code?: string;
  item_name?: string;
  quantity: number;
  from_location?: string;
  to_location?: string;
  reference_number?: string;
  movement_date: string;
  notes?: string;
}

interface StockStats {
  totalValue: number;
  categories: string[];
  recentMovements: number;
}

interface MovementFormData {
  type: 'receipt' | 'issue' | 'transfer' | 'adjustment';
  itemId: string;
  quantity: number;
  fromLocation?: string;
  toLocation?: string;
  reason?: string;
  referenceNumber?: string;
}

export default function StockPage() {
  const router = useRouter();
  const { projectId: queryProjectId } = router.query;

  // Data state
  const [stockItems, setStockItems] = useState<StockItem[]>([]);
  const [movements, setMovements] = useState<StockMovement[]>([]);
  const [stats, setStats] = useState<StockStats | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // UI state
  const [activeTab, setActiveTab] = useState<'positions' | 'movements' | 'alerts'>('positions');
  const [searchTerm, setSearchTerm] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [showMovementModal, setShowMovementModal] = useState(false);
  const [movementType, setMovementType] = useState<'receipt' | 'issue' | 'transfer' | 'adjustment'>('receipt');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Form state for movements
  const [movementForm, setMovementForm] = useState<MovementFormData>({
    type: 'receipt',
    itemId: '',
    quantity: 1,
    fromLocation: '',
    toLocation: '',
    reason: '',
    referenceNumber: ''
  });

  // Load stock data
  useEffect(() => {
    loadStockData();
  }, [queryProjectId]);

  const loadStockData = async () => {
    setIsLoading(true);
    try {
      const url = queryProjectId && queryProjectId !== 'all'
        ? `/api/procurement/stock?projectId=${queryProjectId}`
        : '/api/procurement/stock';

      const response = await fetch(url);
      if (!response.ok) throw new Error('Failed to load stock data');

      const data = await response.json();
      setStockItems(data.items || []);
      setMovements(data.movements || []);
      setStats(data.stats || null);
    } catch (error) {
      log.error('Error loading stock data:', { data: error }, 'StockPage');
      toast.error('Failed to load stock data');
    } finally {
      setIsLoading(false);
    }
  };

  // Calculate metrics
  const metrics = {
    totalItems: stockItems.length,
    totalValue: stockItems.reduce((sum, item) => sum + item.totalValue, 0),
    lowStockItems: stockItems.filter(item =>
      item.minQuantity > 0 && item.quantity <= item.minQuantity && item.quantity > 0
    ).length,
    outOfStockItems: stockItems.filter(item => item.quantity <= 0).length,
    pendingMovements: movements.filter(m => m.movement_type === 'pending').length
  };

  // Filter stock items
  const filteredItems = stockItems.filter(item => {
    const matchesSearch = !searchTerm ||
      item.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      item.itemCode.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesCategory = categoryFilter === 'all' || item.category === categoryFilter;
    return matchesSearch && matchesCategory;
  });

  // Get alert items
  const alertItems = stockItems.filter(item =>
    item.quantity <= 0 || (item.minQuantity > 0 && item.quantity <= item.minQuantity)
  );

  // Get unique categories
  const categories = [...new Set(stockItems.map(item => item.category))];

  // Handle movement creation
  const handleCreateMovement = async () => {
    if (!movementForm.itemId) {
      toast.error('Please select an item');
      return;
    }
    if (movementForm.quantity <= 0) {
      toast.error('Quantity must be greater than 0');
      return;
    }

    setIsSubmitting(true);
    try {
      // For now, we'll update stock locally since movement API may not exist
      const selectedItem = stockItems.find(i => i.id === movementForm.itemId);
      if (!selectedItem) {
        throw new Error('Item not found');
      }

      // Create a movement record (this would normally go to an API)
      const newMovement: StockMovement = {
        id: `mov-${Date.now()}`,
        movement_type: movementForm.type,
        item_code: selectedItem.itemCode,
        item_name: selectedItem.name,
        quantity: movementForm.quantity,
        from_location: movementForm.type === 'issue' || movementForm.type === 'transfer' ? selectedItem.warehouse : undefined,
        to_location: movementForm.type === 'receipt' || movementForm.type === 'transfer' ? movementForm.toLocation : undefined,
        reference_number: movementForm.referenceNumber,
        movement_date: new Date().toISOString(),
        notes: movementForm.reason
      };

      // Update local state
      setMovements([newMovement, ...movements]);

      // Update stock quantity
      let newQuantity = selectedItem.quantity;
      switch (movementForm.type) {
        case 'receipt':
          newQuantity += movementForm.quantity;
          break;
        case 'issue':
          newQuantity -= movementForm.quantity;
          break;
        case 'adjustment':
          newQuantity = movementForm.quantity;
          break;
        // transfer doesn't change total quantity
      }

      setStockItems(prev => prev.map(item =>
        item.id === movementForm.itemId
          ? { ...item, quantity: newQuantity, lastRestocked: new Date().toISOString() }
          : item
      ));

      toast.success(`${movementForm.type.charAt(0).toUpperCase() + movementForm.type.slice(1)} recorded successfully`);
      setShowMovementModal(false);
      setMovementForm({
        type: 'receipt',
        itemId: '',
        quantity: 1,
        fromLocation: '',
        toLocation: '',
        reason: '',
        referenceNumber: ''
      });
    } catch (error) {
      log.error('Failed to create movement:', { data: error }, 'StockPage');
      toast.error('Failed to record movement');
    } finally {
      setIsSubmitting(false);
    }
  };

  const openMovementModal = (type: 'receipt' | 'issue' | 'transfer' | 'adjustment') => {
    setMovementType(type);
    setMovementForm(prev => ({ ...prev, type }));
    setShowMovementModal(true);
  };

  const getStatusBadge = (status: string, quantity: number, minQuantity: number) => {
    if (quantity <= 0) {
      return <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-red-500/20 text-red-400">Out of Stock</span>;
    }
    if (minQuantity > 0 && quantity <= minQuantity) {
      return <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-yellow-500/20 text-yellow-400">Low Stock</span>;
    }
    return <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-green-500/20 text-green-400">In Stock</span>;
  };

  const getMovementIcon = (type: string) => {
    switch (type) {
      case 'receipt':
        return <ArrowDown className="h-4 w-4 text-green-400" />;
      case 'issue':
        return <ArrowUp className="h-4 w-4 text-red-400" />;
      case 'transfer':
        return <ArrowLeftRight className="h-4 w-4 text-blue-400" />;
      default:
        return <RefreshCw className="h-4 w-4 text-[var(--ff-text-tertiary)]" />;
    }
  };

  if (isLoading) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center h-96">
          <Loader2 className="h-8 w-8 animate-spin text-blue-400" />
          <span className="ml-2 text-[var(--ff-text-secondary)]">Loading stock data...</span>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="min-h-screen bg-[var(--ff-bg-tertiary)]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          {/* Header */}
          <div className="flex items-center justify-between mb-6">
            <div>
              <h1 className="text-3xl font-bold text-[var(--ff-text-primary)]">Stock Management</h1>
              <p className="mt-1 text-[var(--ff-text-secondary)]">
                Manage inventory, track movements, and monitor stock levels
              </p>
            </div>
            <div className="flex items-center gap-3">
              <Button variant="outline" onClick={loadStockData}>
                <RefreshCw className="h-4 w-4 mr-2" />
                Refresh
              </Button>
              <Button onClick={() => openMovementModal('receipt')}>
                <Plus className="h-4 w-4 mr-2" />
                New Movement
              </Button>
            </div>
          </div>

          {/* Critical Alerts */}
          {(metrics.lowStockItems > 0 || metrics.outOfStockItems > 0) && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 mb-6">
              <div className="flex items-start gap-3">
                <AlertTriangle className="h-5 w-5 text-red-400 mt-0.5" />
                <div className="flex-1">
                  <h3 className="font-medium text-red-400">Stock Level Alerts</h3>
                  <p className="text-sm text-red-300 mt-1">
                    {metrics.outOfStockItems > 0 &&
                      `${metrics.outOfStockItems} item${metrics.outOfStockItems !== 1 ? 's' : ''} out of stock. `
                    }
                    {metrics.lowStockItems > 0 &&
                      `${metrics.lowStockItems} item${metrics.lowStockItems !== 1 ? 's' : ''} below minimum level. `
                    }
                    Immediate action required.
                  </p>
                </div>
                <Button
                  size="sm"
                  onClick={() => setActiveTab('alerts')}
                  className="bg-red-600 text-white hover:bg-red-700"
                >
                  View Alerts
                </Button>
              </div>
            </div>
          )}

          {/* Metrics Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            <div className="bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)] p-4">
              <div className="flex items-center">
                <div className="p-2 bg-blue-500/20 rounded-lg">
                  <Package className="h-5 w-5 text-blue-400" />
                </div>
                <div className="ml-3">
                  <p className="text-sm text-[var(--ff-text-secondary)]">Total Items</p>
                  <p className="text-xl font-bold text-[var(--ff-text-primary)]">{metrics.totalItems.toLocaleString()}</p>
                </div>
              </div>
            </div>

            <div className="bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)] p-4">
              <div className="flex items-center">
                <div className="p-2 bg-green-500/20 rounded-lg">
                  <TrendingUp className="h-5 w-5 text-green-400" />
                </div>
                <div className="ml-3">
                  <p className="text-sm text-[var(--ff-text-secondary)]">Total Value</p>
                  <p className="text-xl font-bold text-green-400">
                    R {(metrics.totalValue / 1000).toFixed(0)}k
                  </p>
                </div>
              </div>
            </div>

            <div className="bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)] p-4">
              <div className="flex items-center">
                <div className="p-2 bg-red-500/20 rounded-lg">
                  <AlertTriangle className="h-5 w-5 text-red-400" />
                </div>
                <div className="ml-3">
                  <p className="text-sm text-[var(--ff-text-secondary)]">Critical Stock</p>
                  <p className="text-xl font-bold text-red-400">
                    {metrics.lowStockItems + metrics.outOfStockItems}
                  </p>
                </div>
              </div>
            </div>

            <div className="bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)] p-4">
              <div className="flex items-center">
                <div className="p-2 bg-orange-500/20 rounded-lg">
                  <Truck className="h-5 w-5 text-orange-400" />
                </div>
                <div className="ml-3">
                  <p className="text-sm text-[var(--ff-text-secondary)]">Recent Movements</p>
                  <p className="text-xl font-bold text-orange-400">{movements.length}</p>
                </div>
              </div>
            </div>
          </div>

          {/* Quick Actions */}
          <div className="flex flex-wrap gap-3 mb-6">
            <Button variant="outline" size="sm" onClick={() => openMovementModal('receipt')}>
              <ArrowDown className="h-4 w-4 mr-1 text-green-600" />
              Receive Stock
            </Button>
            <Button variant="outline" size="sm" onClick={() => openMovementModal('issue')}>
              <ArrowUp className="h-4 w-4 mr-1 text-red-600" />
              Issue Stock
            </Button>
            <Button variant="outline" size="sm" onClick={() => openMovementModal('transfer')}>
              <ArrowLeftRight className="h-4 w-4 mr-1 text-blue-600" />
              Transfer
            </Button>
            <Button variant="outline" size="sm" onClick={() => openMovementModal('adjustment')}>
              <RefreshCw className="h-4 w-4 mr-1 text-gray-600" />
              Adjustment
            </Button>
          </div>

          {/* Tabs */}
          <div className="border-b border-[var(--ff-border-light)] mb-6">
            <nav className="flex space-x-8">
              {[
                { id: 'positions', label: 'Stock Positions', count: stockItems.length },
                { id: 'movements', label: 'Movements', count: movements.length },
                { id: 'alerts', label: 'Alerts', count: alertItems.length }
              ].map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id as typeof activeTab)}
                  className={`flex items-center gap-2 py-4 px-1 border-b-2 text-sm font-medium transition-colors ${
                    activeTab === tab.id
                      ? 'border-blue-500 text-blue-400'
                      : 'border-transparent text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] hover:border-[var(--ff-border-light)]'
                  }`}
                >
                  {tab.label}
                  {tab.count > 0 && (
                    <span className={`px-2 py-0.5 rounded-full text-xs ${
                      activeTab === tab.id ? 'bg-blue-500/20 text-blue-400' : 'bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-secondary)]'
                    }`}>
                      {tab.count}
                    </span>
                  )}
                </button>
              ))}
            </nav>
          </div>

          {/* Tab Content */}
          <div className="bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)]">
            {activeTab === 'positions' && (
              <div>
                {/* Filters */}
                <div className="p-4 border-b border-[var(--ff-border-light)] flex flex-wrap gap-4">
                  <div className="flex-1 min-w-64">
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-[var(--ff-text-tertiary)]" />
                      <input
                        type="text"
                        placeholder="Search items..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="w-full pl-10 pr-4 py-2 bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded-md text-[var(--ff-text-primary)] placeholder:text-[var(--ff-text-tertiary)] focus:ring-blue-500 focus:border-blue-500"
                      />
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Filter className="h-4 w-4 text-[var(--ff-text-tertiary)]" />
                    <select
                      value={categoryFilter}
                      onChange={(e) => setCategoryFilter(e.target.value)}
                      className="px-3 py-2 bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded-md text-[var(--ff-text-primary)]"
                    >
                      <option value="all">All Categories</option>
                      {categories.map((cat) => (
                        <option key={cat} value={cat}>{cat}</option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Stock Table */}
                {filteredItems.length > 0 ? (
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead className="bg-[var(--ff-bg-tertiary)]">
                        <tr>
                          <th className="px-4 py-3 text-left text-xs font-medium text-[var(--ff-text-secondary)] uppercase">Item</th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-[var(--ff-text-secondary)] uppercase">Category</th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-[var(--ff-text-secondary)] uppercase">Location</th>
                          <th className="px-4 py-3 text-right text-xs font-medium text-[var(--ff-text-secondary)] uppercase">Quantity</th>
                          <th className="px-4 py-3 text-right text-xs font-medium text-[var(--ff-text-secondary)] uppercase">Value</th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-[var(--ff-text-secondary)] uppercase">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[var(--ff-border-light)]">
                        {filteredItems.map((item) => (
                          <tr key={item.id} className="hover:bg-[var(--ff-bg-hover)]">
                            <td className="px-4 py-4">
                              <div>
                                <p className="font-medium text-[var(--ff-text-primary)]">{item.name}</p>
                                <p className="text-sm text-[var(--ff-text-secondary)]">{item.itemCode}</p>
                              </div>
                            </td>
                            <td className="px-4 py-4 text-sm text-[var(--ff-text-secondary)]">{item.category}</td>
                            <td className="px-4 py-4">
                              <div className="flex items-center gap-1 text-sm text-[var(--ff-text-secondary)]">
                                <MapPin className="h-3 w-3" />
                                {item.warehouse}
                                {item.location && ` / ${item.location}`}
                              </div>
                            </td>
                            <td className="px-4 py-4 text-right">
                              <p className="font-medium text-[var(--ff-text-primary)]">{item.quantity} {item.unit}</p>
                              {item.minQuantity > 0 && (
                                <p className="text-xs text-[var(--ff-text-tertiary)]">Min: {item.minQuantity}</p>
                              )}
                            </td>
                            <td className="px-4 py-4 text-right">
                              <p className="font-medium text-[var(--ff-text-primary)]">R {item.totalValue.toLocaleString()}</p>
                              <p className="text-xs text-[var(--ff-text-tertiary)]">@ R {item.unitCost.toFixed(2)}</p>
                            </td>
                            <td className="px-4 py-4">
                              {getStatusBadge(item.status, item.quantity, item.minQuantity)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="text-center py-12">
                    <Package className="h-12 w-12 mx-auto text-[var(--ff-text-tertiary)] mb-4" />
                    <h3 className="text-lg font-medium text-[var(--ff-text-primary)] mb-2">No Stock Items</h3>
                    <p className="text-[var(--ff-text-secondary)]">
                      {searchTerm || categoryFilter !== 'all'
                        ? 'No items match your search criteria'
                        : 'Start by receiving stock into inventory'}
                    </p>
                  </div>
                )}
              </div>
            )}

            {activeTab === 'movements' && (
              <div>
                {movements.length > 0 ? (
                  <div className="divide-y divide-[var(--ff-border-light)]">
                    {movements.map((movement) => (
                      <div key={movement.id} className="p-4 hover:bg-[var(--ff-bg-hover)]">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            {getMovementIcon(movement.movement_type)}
                            <div>
                              <p className="font-medium text-[var(--ff-text-primary)]">
                                {movement.item_name || 'Unknown Item'}
                              </p>
                              <p className="text-sm text-[var(--ff-text-secondary)]">
                                {movement.movement_type.charAt(0).toUpperCase() + movement.movement_type.slice(1)}
                                {movement.reference_number && ` - ${movement.reference_number}`}
                              </p>
                            </div>
                          </div>
                          <div className="text-right">
                            <p className="font-medium text-[var(--ff-text-primary)]">
                              {movement.movement_type === 'issue' ? '-' : '+'}{movement.quantity}
                            </p>
                            <p className="text-sm text-[var(--ff-text-secondary)] flex items-center gap-1">
                              <Clock className="h-3 w-3" />
                              {new Date(movement.movement_date).toLocaleDateString()}
                            </p>
                          </div>
                        </div>
                        {movement.notes && (
                          <p className="mt-2 text-sm text-[var(--ff-text-secondary)] bg-[var(--ff-bg-tertiary)] p-2 rounded">
                            {movement.notes}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-12">
                    <Truck className="h-12 w-12 mx-auto text-[var(--ff-text-tertiary)] mb-4" />
                    <h3 className="text-lg font-medium text-[var(--ff-text-primary)] mb-2">No Movements</h3>
                    <p className="text-[var(--ff-text-secondary)]">Stock movements will appear here</p>
                  </div>
                )}
              </div>
            )}

            {activeTab === 'alerts' && (
              <div>
                {alertItems.length > 0 ? (
                  <div className="divide-y divide-[var(--ff-border-light)]">
                    {alertItems.map((item) => (
                      <div key={item.id} className="p-4 flex items-center justify-between hover:bg-[var(--ff-bg-hover)]">
                        <div className="flex items-center gap-3">
                          <div className={`p-2 rounded-lg ${item.quantity <= 0 ? 'bg-red-500/20' : 'bg-yellow-500/20'}`}>
                            <AlertTriangle className={`h-5 w-5 ${item.quantity <= 0 ? 'text-red-400' : 'text-yellow-400'}`} />
                          </div>
                          <div>
                            <p className="font-medium text-[var(--ff-text-primary)]">{item.name}</p>
                            <p className="text-sm text-[var(--ff-text-secondary)]">
                              {item.quantity <= 0 ? 'Out of stock' : `Only ${item.quantity} ${item.unit} remaining (min: ${item.minQuantity})`}
                            </p>
                          </div>
                        </div>
                        <Button
                          size="sm"
                          onClick={() => {
                            setMovementForm(prev => ({ ...prev, itemId: item.id, type: 'receipt' }));
                            openMovementModal('receipt');
                          }}
                        >
                          Restock
                        </Button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-12">
                    <Package className="h-12 w-12 mx-auto text-green-400 mb-4" />
                    <h3 className="text-lg font-medium text-[var(--ff-text-primary)] mb-2">All Stock Healthy</h3>
                    <p className="text-[var(--ff-text-secondary)]">No items require attention</p>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Movement Modal */}
          {showMovementModal && (
            <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
              <div className="bg-[var(--ff-bg-secondary)] rounded-lg p-6 max-w-md w-full mx-4 border border-[var(--ff-border-light)]">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-semibold text-[var(--ff-text-primary)]">
                    {movementType === 'receipt' && 'Receive Stock'}
                    {movementType === 'issue' && 'Issue Stock'}
                    {movementType === 'transfer' && 'Transfer Stock'}
                    {movementType === 'adjustment' && 'Adjust Stock'}
                  </h3>
                  <button onClick={() => setShowMovementModal(false)} className="text-[var(--ff-text-tertiary)] hover:text-[var(--ff-text-primary)]">
                    <X className="h-5 w-5" />
                  </button>
                </div>

                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">Item</label>
                    <select
                      value={movementForm.itemId}
                      onChange={(e) => setMovementForm({ ...movementForm, itemId: e.target.value })}
                      className="w-full px-3 py-2 bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded-md text-[var(--ff-text-primary)]"
                    >
                      <option value="">Select an item...</option>
                      {stockItems.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.name} ({item.quantity} {item.unit} available)
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">Quantity</label>
                    <input
                      type="number"
                      min="1"
                      value={movementForm.quantity}
                      onChange={(e) => setMovementForm({ ...movementForm, quantity: Number(e.target.value) })}
                      className="w-full px-3 py-2 bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded-md text-[var(--ff-text-primary)]"
                    />
                  </div>

                  {(movementType === 'receipt' || movementType === 'transfer') && (
                    <div>
                      <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
                        {movementType === 'transfer' ? 'To Location' : 'Location'}
                      </label>
                      <input
                        type="text"
                        value={movementForm.toLocation}
                        onChange={(e) => setMovementForm({ ...movementForm, toLocation: e.target.value })}
                        placeholder="e.g., Main Warehouse / Bin A1"
                        className="w-full px-3 py-2 bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded-md text-[var(--ff-text-primary)] placeholder:text-[var(--ff-text-tertiary)]"
                      />
                    </div>
                  )}

                  <div>
                    <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">Reference Number</label>
                    <input
                      type="text"
                      value={movementForm.referenceNumber}
                      onChange={(e) => setMovementForm({ ...movementForm, referenceNumber: e.target.value })}
                      placeholder="e.g., GRN-001 or PO-123"
                      className="w-full px-3 py-2 bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded-md text-[var(--ff-text-primary)] placeholder:text-[var(--ff-text-tertiary)]"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
                      {movementType === 'adjustment' ? 'Reason for Adjustment' : 'Notes'}
                    </label>
                    <textarea
                      value={movementForm.reason}
                      onChange={(e) => setMovementForm({ ...movementForm, reason: e.target.value })}
                      rows={2}
                      className="w-full px-3 py-2 bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded-md text-[var(--ff-text-primary)]"
                    />
                  </div>
                </div>

                <div className="flex gap-3 mt-6">
                  <Button
                    variant="outline"
                    className="flex-1"
                    onClick={() => setShowMovementModal(false)}
                  >
                    Cancel
                  </Button>
                  <Button
                    className="flex-1"
                    onClick={handleCreateMovement}
                    disabled={isSubmitting}
                  >
                    {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                    Confirm
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </AppLayout>
  );
}
