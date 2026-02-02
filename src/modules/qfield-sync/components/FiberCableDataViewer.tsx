/**
 * Fiber Cable Data Viewer Component
 * Displays actual fiber cable data from QFieldCloud and FibreFlow
 */

import React, { useState, useEffect } from 'react';
import { Cable, MapPin, Activity, CheckCircle, Clock, AlertCircle, RefreshCw, Download } from 'lucide-react';
import { log } from '@/lib/logger';

interface FiberCable {
  cable_id: string;
  cable_type?: string;
  cable_size?: string;
  from_chamber?: string;
  to_chamber?: string;
  length_m?: number;
  installation_date?: string;
  installation_status?: string;
  contractor?: string;
  source: 'qfieldcloud' | 'fibreflow' | 'both';
  sync_status?: 'synced' | 'pending' | 'conflict';
  created_at?: string;
  updated_at?: string;
}

interface CableStats {
  qfieldcloud_total: number;
  fibreflow_total: number;
  synchronized: number;
  needs_sync: number;
  qfieldcloud_only: number;
  fibreflow_only: number;
}

export function FiberCableDataViewer() {
  const [view, setView] = useState<'comparison' | 'details'>('comparison');
  const [filter, setFilter] = useState<'all' | 'qfield_only' | 'fibreflow_only' | 'synced'>('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<CableStats>({
    qfieldcloud_total: 0,
    fibreflow_total: 0,
    synchronized: 0,
    needs_sync: 0,
    qfieldcloud_only: 0,
    fibreflow_only: 0
  });
  const [cables, setCables] = useState<FiberCable[]>([]);
  const [qfieldCables, setQfieldCables] = useState<FiberCable[]>([]);
  const [fibreflowCables, setFibreflowCables] = useState<FiberCable[]>([]);

  useEffect(() => {
    fetchCableData();
  }, []);

  const fetchCableData = async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/qfield-sync-cables');

      if (!response.ok) {
        throw new Error(`Failed to fetch cable data: ${response.statusText}`);
      }

      const result = await response.json();

      if (result.success && result.data) {
        setStats(result.data.summary);
        setQfieldCables(result.data.qfieldcloud_cables || []);
        setFibreflowCables(result.data.fibreflow_cables || []);

        // Combine all cables for the details view
        const allCables: FiberCable[] = [];

        // Add synchronized cables
        if (result.data.synchronized_cables) {
          result.data.synchronized_cables.forEach((cable: any) => {
            allCables.push({
              ...cable,
              sync_status: 'synced',
              source: 'both'
            });
          });
        }

        // Add QFieldCloud only cables
        if (result.data.qfieldcloud_only) {
          result.data.qfieldcloud_only.forEach((cable: any) => {
            allCables.push({
              ...cable,
              sync_status: 'pending',
              source: 'qfieldcloud'
            });
          });
        }

        // Add FibreFlow only cables
        if (result.data.fibreflow_only) {
          result.data.fibreflow_only.forEach((cable: any) => {
            allCables.push({
              ...cable,
              sync_status: 'pending',
              source: 'fibreflow'
            });
          });
        }

        // Add cables that need sync
        if (result.data.needs_sync) {
          result.data.needs_sync.forEach((cable: any) => {
            allCables.push({
              ...cable,
              sync_status: 'conflict',
              source: 'both'
            });
          });
        }

        setCables(allCables);
      }
    } catch (err) {
      log.error('Error fetching cable data', { error: err }, 'FiberCableDataViewer');
      setError(err instanceof Error ? err.message : 'Failed to fetch cable data');
    } finally {
      setLoading(false);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status?.toLowerCase()) {
      case 'completed':
      case 'installed':
        return 'bg-green-100 text-green-800';
      case 'in_progress':
      case 'ongoing':
        return 'bg-yellow-100 text-yellow-800';
      case 'pending':
        return 'bg-gray-100 text-gray-800';
      default:
        return 'bg-gray-100 text-gray-600';
    }
  };

  const getSyncStatusBadge = (syncStatus: string) => {
    switch (syncStatus) {
      case 'synced':
        return (
          <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800">
            <CheckCircle className="h-3 w-3 mr-1" />
            Synced
          </span>
        );
      case 'conflict':
        return (
          <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-red-100 text-red-800">
            <AlertCircle className="h-3 w-3 mr-1" />
            Conflict
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">
            <Clock className="h-3 w-3 mr-1" />
            Pending
          </span>
        );
    }
  };

  const handleExport = () => {
    const csvData = cables.map(cable => ({
      'Cable ID': cable.cable_id,
      'Type': cable.cable_type || cable.cable_size || '-',
      'From': cable.from_chamber || '-',
      'To': cable.to_chamber || '-',
      'Length (m)': cable.length_m || '-',
      'Status': cable.installation_status || '-',
      'Contractor': cable.contractor || '-',
      'Source': cable.source,
      'Sync Status': cable.sync_status || '-'
    }));

    const csvContent = [
      Object.keys(csvData[0] || {}).join(','),
      ...csvData.map(row => Object.values(row).join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `fiber-cables-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
  };

  if (loading) {
    return (
      <div className="bg-white rounded-lg shadow p-8">
        <div className="flex flex-col items-center justify-center">
          <Activity className="h-8 w-8 animate-spin text-blue-600 mb-4" />
          <p className="text-gray-600">Loading fiber cable data...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-white rounded-lg shadow p-6">
        <div className="flex items-center space-x-2 text-red-600 mb-4">
          <AlertCircle className="h-5 w-5" />
          <span>Error: {error}</span>
        </div>
        <button
          onClick={fetchCableData}
          className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 flex items-center gap-2"
        >
          <RefreshCw className="h-4 w-4" />
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white rounded-lg shadow p-6">
        <div className="flex justify-between items-center mb-6">
          <div>
            <h2 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
              <Cable className="h-7 w-7 text-blue-600" />
              Fiber Cable Data
            </h2>
            <p className="text-gray-600 mt-1">Compare and sync fiber cable data between systems</p>
          </div>

          <div className="flex gap-3">
            <button
              onClick={fetchCableData}
              className="px-4 py-2 bg-white border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50 flex items-center gap-2"
            >
              <RefreshCw className="h-4 w-4" />
              Refresh
            </button>
            <button
              onClick={handleExport}
              disabled={cables.length === 0}
              className="px-4 py-2 bg-white border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50 disabled:bg-gray-100 disabled:cursor-not-allowed flex items-center gap-2"
            >
              <Download className="h-4 w-4" />
              Export CSV
            </button>
          </div>
        </div>

        {/* View Tabs */}
        <div className="flex space-x-4 border-b border-gray-200">
          <button
            onClick={() => setView('comparison')}
            className={`py-2 px-1 border-b-2 font-medium text-sm ${
              view === 'comparison'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            Comparison View
          </button>
          <button
            onClick={() => setView('details')}
            className={`py-2 px-1 border-b-2 font-medium text-sm ${
              view === 'details'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            Details View
          </button>
        </div>
      </div>

      {view === 'comparison' && (
        <>
          {/* Filter Buttons */}
          <div className="flex space-x-3">
            {[
              { value: 'all', label: 'All Cables' },
              { value: 'qfield_only', label: 'QFieldCloud Only' },
              { value: 'fibreflow_only', label: 'FibreFlow Only' },
              { value: 'synced', label: 'Synchronized' }
            ].map((option) => (
              <button
                key={option.value}
                onClick={() => setFilter(option.value as any)}
                className={`px-4 py-2 rounded-lg ${
                  filter === option.value
                    ? 'bg-blue-600 text-white'
                    : 'bg-white border border-gray-300 text-gray-700 hover:bg-gray-50'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>

          {/* Statistics Cards */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="bg-white rounded-lg shadow p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-600">QFieldCloud Cables</p>
                  <p className="text-2xl font-semibold text-gray-900 mt-1">{stats.qfieldcloud_total}</p>
                </div>
                <div className="bg-blue-100 p-3 rounded-full">
                  <Cable className="h-6 w-6 text-blue-600" />
                </div>
              </div>
            </div>

            <div className="bg-white rounded-lg shadow p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-600">FibreFlow Cables</p>
                  <p className="text-2xl font-semibold text-gray-900 mt-1">{stats.fibreflow_total}</p>
                </div>
                <div className="bg-green-100 p-3 rounded-full">
                  <Cable className="h-6 w-6 text-green-600" />
                </div>
              </div>
            </div>

            <div className="bg-white rounded-lg shadow p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-600">Synchronized</p>
                  <p className="text-2xl font-semibold text-gray-900 mt-1">{stats.synchronized}</p>
                </div>
                <div className="bg-green-100 p-3 rounded-full">
                  <CheckCircle className="h-6 w-6 text-green-600" />
                </div>
              </div>
            </div>

            <div className="bg-white rounded-lg shadow p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-600">Need Sync</p>
                  <p className="text-2xl font-semibold text-gray-900 mt-1">{stats.needs_sync}</p>
                </div>
                <div className="bg-yellow-100 p-3 rounded-full">
                  <Clock className="h-6 w-6 text-yellow-600" />
                </div>
              </div>
            </div>
          </div>

          {/* Data Tables */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* QFieldCloud Data */}
            <div className="bg-white rounded-lg shadow overflow-hidden">
              <div className="bg-blue-600 px-6 py-4">
                <h3 className="text-lg font-semibold text-white">QFieldCloud Data</h3>
                <p className="text-sm text-blue-100 mt-1">{qfieldCables.length} cables found</p>
              </div>
              <div className="p-6">
                {qfieldCables.length > 0 ? (
                  <div className="space-y-3 max-h-96 overflow-y-auto">
                    {qfieldCables.slice(0, 10).map((cable) => (
                      <div key={cable.cable_id} className="border border-gray-200 rounded-lg p-3">
                        <div className="flex justify-between items-start">
                          <div>
                            <p className="font-medium text-gray-900">{cable.cable_id}</p>
                            <p className="text-sm text-gray-600">
                              {cable.cable_type || cable.cable_size || 'Unknown type'}
                            </p>
                            <div className="flex items-center gap-2 mt-1 text-xs text-gray-500">
                              <MapPin className="h-3 w-3" />
                              {cable.from_chamber || 'N/A'} → {cable.to_chamber || 'N/A'}
                            </div>
                          </div>
                          <span className={`px-2 py-1 text-xs font-medium rounded-full ${getStatusColor(cable.installation_status || '')}`}>
                            {cable.installation_status || 'Unknown'}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-gray-500 text-center py-8">No fiber cable data available</p>
                )}
              </div>
            </div>

            {/* FibreFlow Data */}
            <div className="bg-white rounded-lg shadow overflow-hidden">
              <div className="bg-green-600 px-6 py-4">
                <h3 className="text-lg font-semibold text-white">FibreFlow Data</h3>
                <p className="text-sm text-green-100 mt-1">{fibreflowCables.length} cables found</p>
              </div>
              <div className="p-6">
                {fibreflowCables.length > 0 ? (
                  <div className="space-y-3 max-h-96 overflow-y-auto">
                    {fibreflowCables.slice(0, 10).map((cable) => (
                      <div key={cable.cable_id} className="border border-gray-200 rounded-lg p-3">
                        <div className="flex justify-between items-start">
                          <div>
                            <p className="font-medium text-gray-900">{cable.cable_id}</p>
                            <p className="text-sm text-gray-600">
                              {cable.cable_type || cable.cable_size || 'Unknown type'}
                            </p>
                            <div className="flex items-center gap-2 mt-1 text-xs text-gray-500">
                              <MapPin className="h-3 w-3" />
                              {cable.from_chamber || 'N/A'} → {cable.to_chamber || 'N/A'}
                            </div>
                          </div>
                          <span className={`px-2 py-1 text-xs font-medium rounded-full ${getStatusColor(cable.installation_status || '')}`}>
                            {cable.installation_status || 'Unknown'}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-gray-500 text-center py-8">No fiber cable data available</p>
                )}
              </div>
            </div>
          </div>
        </>
      )}

      {view === 'details' && (
        <div className="bg-white rounded-lg shadow">
          <div className="px-6 py-4 border-b border-gray-200">
            <h3 className="text-lg font-semibold text-gray-900">All Cables ({cables.length})</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 tracking-wide">
                    Cable ID
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 tracking-wide">
                    Type
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 tracking-wide">
                    Route
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 tracking-wide">
                    Length (m)
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 tracking-wide">
                    Status
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 tracking-wide">
                    Sync
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 tracking-wide">
                    Source
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {cables.length > 0 ? (
                  cables.map((cable) => (
                    <tr key={cable.cable_id}>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                        {cable.cable_id}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {cable.cable_type || cable.cable_size || '-'}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {cable.from_chamber && cable.to_chamber
                          ? `${cable.from_chamber} → ${cable.to_chamber}`
                          : '-'}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {cable.length_m || '-'}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className={`px-2 py-1 text-xs font-medium rounded-full ${getStatusColor(cable.installation_status || '')}`}>
                          {cable.installation_status || 'Unknown'}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        {getSyncStatusBadge(cable.sync_status || 'pending')}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {cable.source === 'both' ? 'Both' :
                         cable.source === 'qfieldcloud' ? 'QFieldCloud' : 'FibreFlow'}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={7} className="px-6 py-8 text-center text-gray-500">
                      No cable data available
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

export default FiberCableDataViewer;