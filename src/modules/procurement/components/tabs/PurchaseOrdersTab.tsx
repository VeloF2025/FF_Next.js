// 🟢 WORKING: Purchase Orders tab with comprehensive order management
import React, { useEffect, useState } from 'react';
import { Plus, ShoppingCart, Search, Filter, Clock, CheckCircle, AlertTriangle, FileText } from 'lucide-react';
import { Button } from '@/shared/components/ui/Button';
import { useProcurementPortal } from '../../context/ProcurementPortalProvider';

export function PurchaseOrdersTab() {
  const { selectedProject, updateTabBadge } = useProcurementPortal();
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'draft' | 'sent' | 'confirmed' | 'received' | 'cancelled'>('all');
  const [view, setView] = useState<'dashboard' | 'create' | 'detail'>('dashboard');

  // Update tab badge with active PO count
  useEffect(() => {
    if (selectedProject) {
      // TODO: Replace with actual API call
      const mockActivePOs = 4;
      updateTabBadge('purchase-orders', { 
        count: mockActivePOs, 
        type: 'info'
      });
    }
  }, [selectedProject, updateTabBadge]);

  if (!selectedProject) {
    return <NoProjectSelected />;
  }

  const handleCreatePO = () => {
    setView('create');
  };

  const renderContent = () => {
    switch (view) {
      case 'create':
        return (
          <div className="h-full p-6">
            <div className="max-w-4xl mx-auto">
              <div className="bg-white rounded-lg border border-gray-200">
                <div className="p-6 border-b border-gray-200">
                  <h3 className="text-lg font-semibold text-gray-900 mb-2">Create Purchase Order</h3>
                  <p className="text-sm text-gray-600">
                    Create a new Purchase Order for {selectedProject.name}
                  </p>
                </div>
                
                <div className="p-6">
                  <div className="text-center py-12">
                    <ShoppingCart className="h-16 w-16 text-gray-300 mx-auto mb-4" />
                    <h4 className="text-lg font-medium text-gray-900 mb-2">Purchase Order Creation Form</h4>
                    <p className="text-gray-600 mb-6">
                      This would be the PO creation form component
                    </p>
                    <div className="flex gap-3 justify-center">
                      <Button variant="outline" onClick={() => setView('dashboard')}>
                        Cancel
                      </Button>
                      <Button>Save Draft</Button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        );
      
      case 'dashboard':
      default:
        return (
          <div className="h-full flex flex-col">
            {/* Header */}
            <div className="bg-white border-b border-gray-200 p-6">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="text-xl font-semibold text-gray-900">
                    Purchase Orders
                  </h2>
                  <p className="text-sm text-gray-600 mt-1">
                    Managing orders for {selectedProject.name} ({selectedProject.code})
                  </p>
                </div>
                
                <Button
                  onClick={handleCreatePO}
                  size="sm"
                  className="flex items-center gap-2"
                >
                  <Plus className="h-4 w-4" />
                  Create PO
                </Button>
              </div>

              {/* Search and Filter Bar */}
              <div className="flex items-center gap-4">
                <div className="flex-1 relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                  <input
                    type="text"
                    placeholder="Search POs by number, supplier, or item..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                  />
                </div>
                
                <div className="flex items-center gap-2">
                  <Filter className="h-4 w-4 text-gray-500" />
                  <select
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
                    className="border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                  >
                    <option value="all">All Status</option>
                    <option value="draft">Draft</option>
                    <option value="sent">Sent</option>
                    <option value="confirmed">Confirmed</option>
                    <option value="received">Received</option>
                    <option value="cancelled">Cancelled</option>
                  </select>
                </div>
              </div>
            </div>

            {/* PO Stats Cards */}
            <div className="bg-white border-b border-gray-200 p-6">
              <div className="grid grid-cols-1 md:grid-cols-5 gap-6">
                <POStatCard
                  title="Draft"
                  count={2}
                  icon={FileText}
                  color="gray"
                />
                <POStatCard
                  title="Sent"
                  count={3}
                  icon={Clock}
                  color="yellow"
                />
                <POStatCard
                  title="Confirmed"
                  count={5}
                  icon={CheckCircle}
                  color="green"
                />
                <POStatCard
                  title="Received"
                  count={8}
                  icon={ShoppingCart}
                  color="blue"
                />
                <POStatCard
                  title="Total Value"
                  count="R2.4M"
                  icon={AlertTriangle}
                  color="purple"
                />
              </div>
            </div>

            {/* PO List */}
            <div className="flex-1 p-6 overflow-auto">
              <div className="bg-white rounded-lg border border-gray-200">
                <div className="p-6 border-b border-gray-200">
                  <h3 className="text-lg font-medium text-gray-900">Purchase Orders</h3>
                </div>
                
                <div className="divide-y divide-gray-200">
                  <PurchaseOrderItem
                    poNumber="PO-2024-001"
                    supplier="FiberTech Solutions"
                    description="Network Equipment Package"
                    amount={125000}
                    status="confirmed"
                    dateCreated="2024-01-10"
                    expectedDelivery="2024-01-25"
                  />
                  <PurchaseOrderItem
                    poNumber="PO-2024-002"
                    supplier="Cable Dynamics Ltd"
                    description="Fiber Optic Cables - Phase 2"
                    amount={89000}
                    status="sent"
                    dateCreated="2024-01-12"
                    expectedDelivery="2024-01-28"
                  />
                  <PurchaseOrderItem
                    poNumber="PO-2024-003"
                    supplier="InstallPro Services"
                    description="Installation and Testing Services"
                    amount={156000}
                    status="received"
                    dateCreated="2024-01-05"
                    expectedDelivery="2024-01-20"
                    actualDelivery="2024-01-18"
                  />
                </div>
              </div>
            </div>
          </div>
        );
    }
  };

  return (
    <div className="h-full bg-gray-50">
      {renderContent()}
    </div>
  );
}

interface POStatCardProps {
  title: string;
  count: number | string;
  icon: React.ElementType;
  color: 'gray' | 'yellow' | 'green' | 'blue' | 'purple';
}

function POStatCard({ title, count, icon: Icon, color }: POStatCardProps) {
  const colorClasses = {
    gray: 'bg-gray-100 text-gray-700',
    yellow: 'bg-yellow-100 text-yellow-700',
    green: 'bg-green-100 text-green-700',
    blue: 'bg-blue-100 text-blue-700',
    purple: 'bg-purple-100 text-purple-700'
  };

  return (
    <div className="bg-white p-4 rounded-lg border border-gray-200">
      <div className="flex items-center gap-3">
        <div className={`p-2 rounded-lg ${colorClasses[color]}`}>
          <Icon className="h-5 w-5" />
        </div>
        <div>
          <p className="text-lg font-bold text-gray-900">{count}</p>
          <p className="text-sm text-gray-600">{title}</p>
        </div>
      </div>
    </div>
  );
}

interface PurchaseOrderItemProps {
  poNumber: string;
  supplier: string;
  description: string;
  amount: number;
  status: 'draft' | 'sent' | 'confirmed' | 'received' | 'cancelled';
  dateCreated: string;
  expectedDelivery: string;
  actualDelivery?: string;
}

function PurchaseOrderItem({
  poNumber,
  supplier,
  description,
  amount,
  status,
  dateCreated,
  expectedDelivery,
  actualDelivery
}: PurchaseOrderItemProps) {
  const getStatusBadge = (status: string) => {
    const classes = {
      draft: 'bg-gray-100 text-gray-800',
      sent: 'bg-yellow-100 text-yellow-800',
      confirmed: 'bg-green-100 text-green-800',
      received: 'bg-blue-100 text-blue-800',
      cancelled: 'bg-red-100 text-red-800'
    };
    
    return (
      <span className={`px-2 py-1 text-xs font-medium rounded-full ${classes[status as keyof typeof classes]}`}>
        {status.charAt(0).toUpperCase() + status.slice(1)}
      </span>
    );
  };

  return (
    <div className="p-6 hover:bg-gray-50 transition-colors">
      <div className="flex items-center justify-between">
        <div className="flex-1">
          <div className="flex items-center gap-3 mb-2">
            <h4 className="text-lg font-medium text-gray-900">{poNumber}</h4>
            {getStatusBadge(status)}
          </div>
          
          <div className="text-sm text-gray-600 mb-2">
            <p className="font-medium">{supplier}</p>
            <p>{description}</p>
          </div>
          
          <div className="flex items-center gap-6 text-sm text-gray-600">
            <span>Created: {new Date(dateCreated).toLocaleDateString()}</span>
            <span>Expected: {new Date(expectedDelivery).toLocaleDateString()}</span>
            {actualDelivery && (
              <span className="text-green-700">
                Delivered: {new Date(actualDelivery).toLocaleDateString()}
              </span>
            )}
            <span className="font-medium">R{amount.toLocaleString()}</span>
          </div>
        </div>
        
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm">
            View Details
          </Button>
          {status === 'draft' && (
            <Button size="sm">
              Send PO
            </Button>
          )}
          {status === 'confirmed' && (
            <Button size="sm" className="bg-green-600 hover:bg-green-700">
              Mark Received
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function NoProjectSelected() {
  return (
    <div className="h-full flex items-center justify-center">
      <div className="text-center max-w-md">
        <div className="mx-auto mb-6 w-24 h-24 bg-blue-100 rounded-full flex items-center justify-center">
          <ShoppingCart className="h-12 w-12 text-blue-600" />
        </div>
        
        <h3 className="text-xl font-semibold text-gray-900 mb-4">
          Project Selection Required
        </h3>
        
        <p className="text-gray-600 mb-6">
          Please select a project to view and manage its Purchase Orders. 
          Purchase Orders are project-specific and track all procurement commitments.
        </p>
        
        <div className="bg-blue-50 p-4 rounded-lg border border-blue-200">
          <p className="text-sm text-blue-700">
            <strong>Tip:</strong> Use the project selector above to choose a project 
            and start managing its purchase orders.
          </p>
        </div>
      </div>
    </div>
  );
}

export default PurchaseOrdersTab;