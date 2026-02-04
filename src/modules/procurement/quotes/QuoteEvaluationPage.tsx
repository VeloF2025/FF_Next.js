import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import { AlertTriangle } from 'lucide-react';

// Types
interface QuoteEvaluation {
  id: string;
  rfqId: string;
  rfqTitle: string;
  status: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'AWARDED';
  totalQuotes: number;
  lowestBid: number;
  averageBid: number;
  highestBid: number;
  currency: string;
}

interface QuoteStats {
  total: number;
  pending: number;
  inProgress: number;
  completed: number;
  awarded: number;
}

const QuoteEvaluationPage: React.FC = () => {
  const router = useRouter();
  const [evaluations, setEvaluations] = useState<QuoteEvaluation[]>([]);
  const [stats, setStats] = useState<QuoteStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);
      setError(null);

      const response = await fetch('/api/procurement/quote-evaluations');
      if (!response.ok) throw new Error('Failed to load data');

      const result = await response.json();
      const data = result.data || result;

      setEvaluations(data.evaluations || []);
      setStats(data.stats || null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load data');
    } finally {
      setLoading(false);
    }
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-ZA', {
      style: 'currency',
      currency: 'ZAR'
    }).format(amount);
  };

  if (loading) {
    return (
      <div className="p-8 text-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
        <p className="mt-4 text-gray-600">Loading evaluations...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-8">
        <div className="bg-red-50 border border-red-200 rounded-lg p-6 text-center">
          <AlertTriangle className="h-12 w-12 text-red-600 mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-red-800 mb-2">Error Loading Evaluations</h3>
          <p className="text-red-600 mb-4">{error}</p>
          <button
            onClick={loadData}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900 dark:text-white">Quote Evaluation</h1>
          <p className="text-gray-600 dark:text-gray-400 mt-1">Evaluate and compare supplier quotes</p>
        </div>
        <button
          onClick={() => router.push('/procurement/rfq')}
          className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
        >
          New RFQ
        </button>
      </div>

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-5 gap-4">
          <div className="bg-white dark:bg-gray-800 p-4 rounded-lg shadow">
            <div className="text-2xl font-bold text-blue-600">{stats.total}</div>
            <div className="text-sm text-gray-500">Total</div>
          </div>
          <div className="bg-white dark:bg-gray-800 p-4 rounded-lg shadow">
            <div className="text-2xl font-bold text-yellow-600">{stats.pending}</div>
            <div className="text-sm text-gray-500">Pending</div>
          </div>
          <div className="bg-white dark:bg-gray-800 p-4 rounded-lg shadow">
            <div className="text-2xl font-bold text-orange-600">{stats.inProgress}</div>
            <div className="text-sm text-gray-500">In Progress</div>
          </div>
          <div className="bg-white dark:bg-gray-800 p-4 rounded-lg shadow">
            <div className="text-2xl font-bold text-green-600">{stats.completed}</div>
            <div className="text-sm text-gray-500">Completed</div>
          </div>
          <div className="bg-white dark:bg-gray-800 p-4 rounded-lg shadow">
            <div className="text-2xl font-bold text-purple-600">{stats.awarded}</div>
            <div className="text-sm text-gray-500">Awarded</div>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden">
        <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
          <thead className="bg-gray-50 dark:bg-gray-900">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">RFQ</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Quotes</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Lowest Bid</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
            {evaluations.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-6 py-8 text-center text-gray-500">
                  No evaluations found
                </td>
              </tr>
            ) : (
              evaluations.map((evaluation) => (
                <tr key={evaluation.id} className="hover:bg-gray-50 dark:hover:bg-gray-700">
                  <td className="px-6 py-4">
                    <div className="font-medium text-gray-900 dark:text-white">{evaluation.rfqTitle}</div>
                    <div className="text-sm text-gray-500">{evaluation.rfqId}</div>
                  </td>
                  <td className="px-6 py-4">
                    <span className={`px-2 py-1 rounded text-xs font-medium ${
                      evaluation.status === 'AWARDED' ? 'bg-green-100 text-green-800' :
                      evaluation.status === 'COMPLETED' ? 'bg-blue-100 text-blue-800' :
                      evaluation.status === 'IN_PROGRESS' ? 'bg-yellow-100 text-yellow-800' :
                      'bg-gray-100 text-gray-800'
                    }`}>
                      {evaluation.status}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-gray-700 dark:text-gray-300">
                    {evaluation.totalQuotes}
                  </td>
                  <td className="px-6 py-4 text-green-600 font-medium">
                    {formatCurrency(evaluation.lowestBid)}
                  </td>
                  <td className="px-6 py-4">
                    <button
                      onClick={() => router.push(`/procurement/rfq/${evaluation.rfqId}`)}
                      className="text-blue-600 hover:text-blue-800"
                    >
                      View
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default QuoteEvaluationPage;
