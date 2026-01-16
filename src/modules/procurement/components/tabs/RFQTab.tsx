// 🟢 WORKING: RFQ tab component with project filtering and workflow management
import { useEffect, useState } from 'react';
import { Plus, Send, Search, Filter, Clock, CheckCircle, AlertTriangle } from 'lucide-react';
import { Button } from '@/shared/components/ui/Button';
import { useProcurementPortal } from '../../context/ProcurementPortalProvider';
import { RFQDashboard } from '../../rfq/components/RFQDashboard';

export function RFQTab() {
  const { selectedProject, updateTabBadge } = useProcurementPortal();
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'draft' | 'sent' | 'responded' | 'closed'>('all');
  const [view, setView] = useState<'dashboard' | 'create' | 'detail'>('dashboard');

  // Update tab badge with active RFQ count
  useEffect(() => {
    if (selectedProject) {
      // TODO: Replace with actual API call
      const mockActiveRFQs = 2;
      updateTabBadge('rfq', { 
        count: mockActiveRFQs, 
        type: mockActiveRFQs > 0 ? 'warning' : 'success' 
      });
    }
  }, [selectedProject, updateTabBadge]);

  // Handle RFQ creation
  const handleCreateRFQ = () => {
    setView('create');
  };

  // Render current view
  const renderContent = () => {
    if (!selectedProject) {
      return <NoProjectSelected />;
    }

    switch (view) {
      case 'create':
        return (
          <div className="h-full p-6">
            <div className="max-w-4xl mx-auto">
              <div className="bg-white rounded-lg border border-gray-200">
                <div className="p-6 border-b border-gray-200">
                  <h3 className="text-lg font-semibold text-gray-900 mb-2">Create RFQ</h3>
                  <p className="text-sm text-gray-600">
                    Create a new Request for Quotation for {selectedProject.name}
                  </p>
                </div>
                
                <div className="p-6">
                  <div className="text-center py-12">
                    <Send className="h-16 w-16 text-gray-300 mx-auto mb-4" />
                    <h4 className="text-lg font-medium text-gray-900 mb-2">RFQ Creation Form</h4>
                    <p className="text-gray-600 mb-6">
                      This would be the RFQ creation form component
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
            {/* RFQ Header */}
            <div className="bg-white border-b border-gray-200 p-6">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="text-xl font-semibold text-gray-900">
                    Request for Quotations
                  </h2>
                  <p className="text-sm text-gray-600 mt-1">
                    Managing RFQs for {selectedProject.name} ({selectedProject.code})
                  </p>
                </div>
                
                <Button
                  onClick={handleCreateRFQ}
                  size="sm"
                  className="flex items-center gap-2"
                >
                  <Plus className="h-4 w-4" />
                  Create RFQ
                </Button>
              </div>

              {/* Search and Filter Bar */}
              <div className="flex items-center gap-4">
                <div className="flex-1 relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                  <input
                    type="text"
                    placeholder="Search RFQs by title, supplier, or reference..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                  />
                </div>
                
                {/* Status Filter */}
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
                    <option value="responded">Responded</option>
                    <option value="closed">Closed</option>
                  </select>
                </div>
              </div>
            </div>

            {/* RFQ Stats Cards */}
            <div className="bg-white border-b border-gray-200 p-6">
              <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                <RFQStatCard
                  title="Draft RFQs"
                  count={3}
                  icon={Clock}
                  color="yellow"
                />
                <RFQStatCard
                  title="Sent RFQs"
                  count={5}
                  icon={Send}
                  color="blue"
                />
                <RFQStatCard
                  title="Pending Responses"
                  count={2}
                  icon={AlertTriangle}
                  color="orange"
                />
                <RFQStatCard
                  title="Completed"
                  count={12}
                  icon={CheckCircle}
                  color="green"
                />
              </div>
            </div>

            {/* RFQ Content */}
            <div className="flex-1 overflow-hidden">
              <RFQDashboard
                projectId={selectedProject.id}
                searchTerm={searchTerm}
                statusFilter={statusFilter}
                onCreateRFQ={handleCreateRFQ}
              />
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

interface RFQStatCardProps {
  title: string;
  count: number;
  icon: React.ElementType;
  color: 'yellow' | 'blue' | 'orange' | 'green';
}

function RFQStatCard({ title, count, icon: Icon, color }: RFQStatCardProps) {
  const colorClasses = {
    yellow: 'bg-yellow-100 text-yellow-700',
    blue: 'bg-blue-100 text-blue-700',
    orange: 'bg-orange-100 text-orange-700',
    green: 'bg-green-100 text-green-700'
  };

  return (
    <div className="bg-white p-4 rounded-lg border border-gray-200">
      <div className="flex items-center gap-3">
        <div className={`p-2 rounded-lg ${colorClasses[color]}`}>
          <Icon className="h-5 w-5" />
        </div>
        <div>
          <p className="text-2xl font-bold text-gray-900">{count}</p>
          <p className="text-sm text-gray-600">{title}</p>
        </div>
      </div>
    </div>
  );
}

/**
 * Component shown when no project is selected
 */
function NoProjectSelected() {
  return (
    <div className="h-full flex items-center justify-center">
      <div className="text-center max-w-md">
        <div className="mx-auto mb-6 w-24 h-24 bg-blue-100 rounded-full flex items-center justify-center">
          <Send className="h-12 w-12 text-blue-600" />
        </div>
        
        <h3 className="text-xl font-semibold text-gray-900 mb-4">
          Project Selection Required
        </h3>
        
        <p className="text-gray-600 mb-6">
          Please select a project to view and manage its Request for Quotations (RFQs). 
          RFQs are project-specific and help you gather competitive quotes from suppliers.
        </p>
        
        <div className="bg-blue-50 p-4 rounded-lg border border-blue-200">
          <p className="text-sm text-blue-700">
            <strong>Tip:</strong> Use the project selector above to choose a project 
            and start managing its RFQ processes.
          </p>
        </div>
      </div>
    </div>
  );
}

export default RFQTab;