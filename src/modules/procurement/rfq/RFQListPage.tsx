import { useState } from 'react';
import { Plus, Send, Search, TrendingUp } from 'lucide-react';
import { useRFQs } from '../hooks/useRFQ';
import { RFQStatus } from '@/types/procurement.types';
import { RFQCard } from '../components/RFQCard';
import { Button } from '@/shared/components/ui/Button';
import { Input } from '@/shared/components/ui/Input';
import { useNavigate } from 'react-router-dom';

export function RFQListPage() {
  const navigate = useNavigate();
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<RFQStatus | 'all'>('all');
  
  const { data: rfqs, isLoading, error } = useRFQs(
    statusFilter === 'all' 
      ? {} 
      : { status: statusFilter }
  );

  const filteredRFQs = rfqs?.filter(rfq => {
    if (searchTerm) {
      const search = searchTerm.toLowerCase();
      return (
        (rfq.rfqNumber || '').toLowerCase().includes(search) ||
        rfq.title.toLowerCase().includes(search) ||
        rfq.title.toLowerCase().includes(search) // Note: projectName not available in RFQ type
      );
    }
    return true;
  });

  const handleCreate = () => {
    navigate('/procurement/rfq/new');
  };

  const handleCompare = () => {
    navigate('/procurement/rfq/compare');
  };

  if (error) {
    return (
      <div className="p-6">
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
          Error loading RFQs: {error.message}
        </div>
      </div>
    );
  }

  // Calculate stats
  const stats = {
    total: rfqs?.length || 0,
    sent: rfqs?.filter(r => r.status === RFQStatus.ISSUED).length || 0,
    responsesReceived: rfqs?.filter(r => r.status === RFQStatus.RESPONSES_RECEIVED).length || 0,
    awarded: rfqs?.filter(r => r.status === RFQStatus.AWARDED).length || 0,
  };

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Request for Quotes</h1>
          <p className="text-sm text-gray-500 mt-1">
            Manage RFQs, supplier responses, and comparisons
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            onClick={handleCompare}
            variant="outline"
            className="flex items-center gap-2"
          >
            <TrendingUp className="h-4 w-4" />
            Compare Responses
          </Button>
          <Button
            onClick={handleCreate}
            className="flex items-center gap-2"
          >
            <Plus className="h-4 w-4" />
            New RFQ
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="flex-1">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
            <Input
              type="text"
              placeholder="Search RFQs..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10"
            />
          </div>
        </div>
        <div className="flex gap-2">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as RFQStatus | 'all')}
            className="px-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
          >
            <option value="all">All Status</option>
            <option value={RFQStatus.DRAFT}>Draft</option>
            <option value={RFQStatus.ISSUED}>Issued</option>
            <option value={RFQStatus.RESPONSES_RECEIVED}>Responses Received</option>
            <option value={RFQStatus.EVALUATED}>Evaluated</option>
            <option value={RFQStatus.AWARDED}>Awarded</option>
            <option value={RFQStatus.CANCELLED}>Cancelled</option>
          </select>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white p-4 rounded-lg border border-gray-200">
          <p className="text-sm text-gray-500">Total RFQs</p>
          <p className="text-2xl font-bold text-gray-900">{stats.total}</p>
        </div>
        <div className="bg-white p-4 rounded-lg border border-gray-200">
          <p className="text-sm text-gray-500">Sent to Suppliers</p>
          <p className="text-2xl font-bold text-blue-600">{stats.sent}</p>
        </div>
        <div className="bg-white p-4 rounded-lg border border-gray-200">
          <p className="text-sm text-gray-500">Responses Received</p>
          <p className="text-2xl font-bold text-yellow-600">{stats.responsesReceived}</p>
        </div>
        <div className="bg-white p-4 rounded-lg border border-gray-200">
          <p className="text-sm text-gray-500">Awarded</p>
          <p className="text-2xl font-bold text-green-600">{stats.awarded}</p>
        </div>
      </div>

      {/* RFQ List */}
      {isLoading ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="bg-white p-6 rounded-lg border border-gray-200 animate-pulse">
              <div className="h-4 bg-gray-200 rounded w-3/4 mb-2"></div>
              <div className="h-3 bg-gray-200 rounded w-1/2 mb-4"></div>
              <div className="space-y-2">
                <div className="h-3 bg-gray-200 rounded"></div>
                <div className="h-3 bg-gray-200 rounded"></div>
              </div>
            </div>
          ))}
        </div>
      ) : filteredRFQs && filteredRFQs.length > 0 ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
          {filteredRFQs.map((rfq) => (
            <RFQCard key={rfq.id} rfq={rfq} />
          ))}
        </div>
      ) : (
        <div className="bg-white p-12 rounded-lg border border-gray-200 text-center">
          <Send className="h-12 w-12 text-gray-400 mx-auto mb-4" />
          <p className="text-gray-500">No RFQs found</p>
          <Button
            onClick={handleCreate}
            className="mt-4"
          >
            Create First RFQ
          </Button>
        </div>
      )}
    </div>
  );
}