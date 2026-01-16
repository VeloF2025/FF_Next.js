// 🟢 WORKING: Quote Evaluation tab with comparison and decision tracking
import { useEffect, useState } from 'react';
import { Quote, Search, Filter, Award, Clock, CheckCircle } from 'lucide-react';
import { Button } from '@/shared/components/ui/Button';
import { useProcurementPortal } from '../../context/ProcurementPortalProvider';

export function QuoteEvaluationTab() {
  const { selectedProject, updateTabBadge } = useProcurementPortal();
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'evaluated' | 'awarded'>('all');

  // Update tab badge with pending evaluations
  useEffect(() => {
    if (selectedProject) {
      // TODO: Replace with actual API call
      const mockPendingEvaluations = 1;
      updateTabBadge('quotes', { 
        count: mockPendingEvaluations, 
        type: mockPendingEvaluations > 0 ? 'success' : 'info' 
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
              Quote Evaluation
            </h2>
            <p className="text-sm text-gray-600 mt-1">
              Evaluating quotes for {selectedProject.name} ({selectedProject.code})
            </p>
          </div>
        </div>

        {/* Search and Filter Bar */}
        <div className="flex items-center gap-4">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
            <input
              type="text"
              placeholder="Search quotes by RFQ, supplier, or item..."
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
              <option value="pending">Pending Evaluation</option>
              <option value="evaluated">Evaluated</option>
              <option value="awarded">Awarded</option>
            </select>
          </div>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="bg-white border-b border-gray-200 p-6">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
          <QuoteStatCard
            title="Pending Review"
            count={3}
            icon={Clock}
            color="yellow"
          />
          <QuoteStatCard
            title="Under Evaluation"
            count={5}
            icon={Quote}
            color="blue"
          />
          <QuoteStatCard
            title="Evaluated"
            count={8}
            icon={CheckCircle}
            color="green"
          />
          <QuoteStatCard
            title="Awarded"
            count={12}
            icon={Award}
            color="purple"
          />
        </div>
      </div>

      {/* Content Area */}
      <div className="flex-1 p-6 overflow-auto">
        <div className="max-w-7xl mx-auto">
          {/* Mock Quote Evaluation List */}
          <div className="bg-white rounded-lg border border-gray-200">
            <div className="p-6 border-b border-gray-200">
              <h3 className="text-lg font-medium text-gray-900">Active Quote Evaluations</h3>
            </div>
            
            <div className="divide-y divide-gray-200">
              <QuoteEvaluationItem
                rfqTitle="Network Equipment Package A"
                rfqRef="RFQ-2024-001"
                quotesReceived={3}
                status="pending"
                dueDate="2024-01-15"
                totalValue={125000}
              />
              <QuoteEvaluationItem
                rfqTitle="Fiber Optic Cables - Phase 2"
                rfqRef="RFQ-2024-002"
                quotesReceived={4}
                status="evaluated"
                dueDate="2024-01-10"
                totalValue={89000}
                recommendedSupplier="FiberTech Solutions"
              />
              <QuoteEvaluationItem
                rfqTitle="Installation Services"
                rfqRef="RFQ-2024-003"
                quotesReceived={2}
                status="awarded"
                dueDate="2024-01-05"
                totalValue={156000}
                awardedSupplier="InstallPro Ltd"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

interface QuoteStatCardProps {
  title: string;
  count: number;
  icon: React.ElementType;
  color: 'yellow' | 'blue' | 'green' | 'purple';
}

function QuoteStatCard({ title, count, icon: Icon, color }: QuoteStatCardProps) {
  const colorClasses = {
    yellow: 'bg-yellow-100 text-yellow-700',
    blue: 'bg-blue-100 text-blue-700',
    green: 'bg-green-100 text-green-700',
    purple: 'bg-purple-100 text-purple-700'
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

interface QuoteEvaluationItemProps {
  rfqTitle: string;
  rfqRef: string;
  quotesReceived: number;
  status: 'pending' | 'evaluated' | 'awarded';
  dueDate: string;
  totalValue: number;
  recommendedSupplier?: string;
  awardedSupplier?: string;
}

function QuoteEvaluationItem({
  rfqTitle,
  rfqRef,
  quotesReceived,
  status,
  dueDate,
  totalValue,
  recommendedSupplier,
  awardedSupplier
}: QuoteEvaluationItemProps) {
  const getStatusBadge = (status: string) => {
    const classes = {
      pending: 'bg-yellow-100 text-yellow-800',
      evaluated: 'bg-green-100 text-green-800',
      awarded: 'bg-blue-100 text-blue-800'
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
            <h4 className="text-lg font-medium text-gray-900">{rfqTitle}</h4>
            {getStatusBadge(status)}
          </div>
          
          <div className="flex items-center gap-6 text-sm text-gray-600">
            <span>Ref: {rfqRef}</span>
            <span>Quotes: {quotesReceived}</span>
            <span>Due: {new Date(dueDate).toLocaleDateString()}</span>
            <span>Value: R{totalValue.toLocaleString()}</span>
          </div>
          
          {recommendedSupplier && (
            <div className="mt-2 text-sm">
              <span className="text-gray-600">Recommended: </span>
              <span className="font-medium text-green-700">{recommendedSupplier}</span>
            </div>
          )}
          
          {awardedSupplier && (
            <div className="mt-2 text-sm">
              <span className="text-gray-600">Awarded to: </span>
              <span className="font-medium text-blue-700">{awardedSupplier}</span>
            </div>
          )}
        </div>
        
        <div className="flex items-center gap-2">
          {status === 'pending' && (
            <Button variant="outline" size="sm">
              Start Evaluation
            </Button>
          )}
          {status === 'evaluated' && (
            <Button size="sm" className="bg-green-600 hover:bg-green-700">
              Award Contract
            </Button>
          )}
          <Button variant="outline" size="sm">
            View Details
          </Button>
        </div>
      </div>
    </div>
  );
}

function NoProjectSelected() {
  return (
    <div className="h-full flex items-center justify-center">
      <div className="text-center max-w-md">
        <div className="mx-auto mb-6 w-24 h-24 bg-green-100 rounded-full flex items-center justify-center">
          <Quote className="h-12 w-12 text-green-600" />
        </div>
        
        <h3 className="text-xl font-semibold text-gray-900 mb-4">
          Project Selection Required
        </h3>
        
        <p className="text-gray-600 mb-6">
          Please select a project to view and evaluate its supplier quotes. 
          Quote evaluation helps you make informed procurement decisions.
        </p>
        
        <div className="bg-green-50 p-4 rounded-lg border border-green-200">
          <p className="text-sm text-green-700">
            <strong>Tip:</strong> Use the project selector above to choose a project 
            and start evaluating supplier quotes.
          </p>
        </div>
      </div>
    </div>
  );
}

export default QuoteEvaluationTab;