import { useState, useEffect } from 'react';
import Head from 'next/head';
import { AppLayout } from '@/components/layout';

interface MarketingStats {
  total: number;
  valid: number;
  invalid: number;
}

interface MarketingSubmission {
  dropNumber: string;
  submittedAt: string;
  submittedBy: string;
  userName: string;
  isValid: boolean;
  validationMessage: string;
  latitude?: number;
  longitude?: number;
}

interface MarketingData {
  date: string;
  stats: MarketingStats;
  submissions: MarketingSubmission[];
}

export default function MarketingActivationsPage() {
  const [data, setData] = useState<MarketingData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<string>(
    new Date().toISOString().split('T')[0] ?? ''
  );

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 30000);
    return () => clearInterval(interval);
  }, [selectedDate]);

  const fetchData = async () => {
    try {
      setLoading(true);
      const response = await fetch(`/api/marketing-activations?date=${selectedDate}`);
      const result = await response.json();

      if (result.success) {
        setData(result.data);
        setError(null);
      } else {
        setError(result.error || 'Failed to load data');
      }
    } catch (err: any) {
      setError(err.message || 'Failed to fetch data');
    } finally {
      setLoading(false);
    }
  };

  const exportToCSV = () => {
    if (!data || !data.submissions) return;

    const headers = ['Drop Number', 'Submitted At', 'Submitted By', 'User Name', 'Valid', 'Message', 'Latitude', 'Longitude'];
    const rows = data.submissions.map(sub => [
      sub.dropNumber,
      new Date(sub.submittedAt).toLocaleString(),
      sub.submittedBy,
      sub.userName || '-',
      sub.isValid ? 'Yes' : 'No',
      sub.validationMessage,
      sub.latitude?.toString() || '-',
      sub.longitude?.toString() || '-'
    ]);

    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `marketing-activations-${selectedDate}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
  };

  return (
    <>
      <Head>
        <title>Marketing Activations | FibreFlow</title>
      </Head>

      <AppLayout>
        <div className="container mx-auto px-4 py-8">
          {/* Header */}
          <div className="mb-8">
            <h1 className="text-3xl font-bold text-[var(--ff-text-primary)] mb-2">
              Marketing Activations
            </h1>
            <p className="text-[var(--ff-text-secondary)]">
              Track drop number submissions from marketing team
            </p>
          </div>

          {/* Date Selector & Export */}
          <div className="mb-6 flex items-center justify-between">
            <div>
              <label className="block text-sm font-medium text-[var(--ff-text-primary)] mb-2">
                Select Date
              </label>
              <input
                type="date"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                className="px-4 py-2 border border-[var(--ff-border-light)] rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-primary)]"
              />
            </div>
            <button
              onClick={exportToCSV}
              disabled={!data || data.submissions.length === 0}
              className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-500/50 disabled:cursor-not-allowed"
            >
              Export to CSV
            </button>
          </div>

          {/* Error */}
          {error && (
            <div className="mb-6 p-4 bg-red-500/20 border border-red-500/50 rounded-lg text-red-400">
              {error}
            </div>
          )}

          {/* Loading */}
          {loading && !data && (
            <div className="flex items-center justify-center py-12">
              <div className="text-[var(--ff-text-secondary)]">Loading...</div>
            </div>
          )}

          {/* Stats Cards */}
          {data && (
            <>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
                {/* Total */}
                <div className="bg-[var(--ff-bg-secondary)] rounded-lg shadow p-6 border border-[var(--ff-border-light)]">
                  <div className="text-sm font-medium text-[var(--ff-text-secondary)] mb-2">
                    Total Submissions
                  </div>
                  <div className="text-3xl font-bold text-[var(--ff-text-primary)]">
                    {data.stats.total}
                  </div>
                </div>

                {/* Valid */}
                <div className="bg-[var(--ff-bg-secondary)] rounded-lg shadow p-6 border border-[var(--ff-border-light)]">
                  <div className="text-sm font-medium text-[var(--ff-text-secondary)] mb-2">
                    Valid Drops
                  </div>
                  <div className="text-3xl font-bold text-green-400">
                    {data.stats.valid}
                  </div>
                </div>

                {/* Invalid */}
                <div className="bg-[var(--ff-bg-secondary)] rounded-lg shadow p-6 border border-[var(--ff-border-light)]">
                  <div className="text-sm font-medium text-[var(--ff-text-secondary)] mb-2">
                    Invalid Drops
                  </div>
                  <div className="text-3xl font-bold text-red-400">
                    {data.stats.invalid}
                  </div>
                </div>
              </div>

              {/* Submissions Table */}
              {data.submissions.length > 0 ? (
                <div className="bg-[var(--ff-bg-secondary)] rounded-lg shadow overflow-hidden border border-[var(--ff-border-light)]">
                  <div className="px-6 py-4 border-b border-[var(--ff-border-light)]">
                    <h2 className="text-lg font-semibold text-[var(--ff-text-primary)]">
                      Recent Submissions ({data.submissions.length})
                    </h2>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-[var(--ff-border-light)]">
                      <thead className="bg-[var(--ff-bg-tertiary)]">
                        <tr>
                          <th className="px-6 py-3 text-left text-xs font-medium text-[var(--ff-text-secondary)] tracking-wide">
                            Drop Number
                          </th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-[var(--ff-text-secondary)] tracking-wide">
                            Submitted At
                          </th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-[var(--ff-text-secondary)] tracking-wide">
                            Submitted By
                          </th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-[var(--ff-text-secondary)] tracking-wide">
                            GPS Location
                          </th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-[var(--ff-text-secondary)] tracking-wide">
                            Status
                          </th>
                        </tr>
                      </thead>
                      <tbody className="bg-[var(--ff-bg-secondary)] divide-y divide-[var(--ff-border-light)]">
                        {data.submissions.map((sub, index) => (
                          <tr key={index} className="hover:bg-[var(--ff-bg-hover)]">
                            <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-[var(--ff-text-primary)]">
                              {sub.dropNumber}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-[var(--ff-text-secondary)]">
                              {new Date(sub.submittedAt).toLocaleString()}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-[var(--ff-text-secondary)]">
                              {sub.userName || sub.submittedBy || '-'}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-[var(--ff-text-secondary)]">
                              {sub.latitude && sub.longitude ? (
                                <a
                                  href={`https://www.google.com/maps?q=${sub.latitude},${sub.longitude}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-blue-600 hover:text-blue-400 hover:underline"
                                  title={`${sub.latitude}, ${sub.longitude}`}
                                >
                                  📍 View Map
                                </a>
                              ) : (
                                <span className="text-[var(--ff-text-tertiary)]">-</span>
                              )}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap">
                              <span
                                className={`px-2 py-1 inline-flex text-xs leading-5 font-semibold rounded-full ${
                                  sub.isValid
                                    ? 'bg-green-500/20 text-green-400'
                                    : 'bg-red-500/20 text-red-400'
                                }`}
                              >
                                {sub.isValid ? '✅ Valid' : '❌ Invalid'}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : (
                <div className="bg-[var(--ff-bg-secondary)] rounded-lg shadow p-12 text-center border border-[var(--ff-border-light)]">
                  <div className="text-[var(--ff-text-secondary)]">
                    No submissions for {selectedDate}
                  </div>
                </div>
              )}
            </>
          )}

          {/* Auto-refresh indicator */}
          <div className="mt-4 text-center text-sm text-[var(--ff-text-tertiary)]">
            Auto-refreshing every 30 seconds
          </div>
        </div>
      </AppLayout>
    </>
  );
}
