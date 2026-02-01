/**
 * Field Installations Viewer Component
 * Displays poles and drops data from QFieldCloud and FibreFlow
 */

import React, { useState, useEffect } from 'react';
import {
  MapPin,
  Home,
  Activity,
  CheckCircle,
  Clock,
  AlertCircle,
  RefreshCw,
  Download,
  Camera,
  Ruler,
  Users
} from 'lucide-react';

type DataType = 'poles' | 'drops';
type ViewType = 'summary' | 'comparison' | 'details';

interface PoleData {
  pole_number: string;
  pole_type?: string;
  height?: number;
  material?: string;
  status?: string;
  installation_date?: string;
  latitude?: number;
  longitude?: number;
  address?: string;
  image_count?: number;
  source: 'qfieldcloud' | 'fibreflow' | 'both';
  sync_status?: 'synced' | 'pending' | 'conflict';
}

interface DropData {
  drop_number: string;
  pole_number?: string;
  address?: string;
  customer_name?: string;
  cable_length?: string;
  status?: string;
  qc_status?: string;
  installation_date?: string;
  source: 'qfieldcloud' | 'fibreflow' | 'both';
  sync_status?: 'synced' | 'pending' | 'conflict';
}

interface Stats {
  qfieldcloud_total: number;
  fibreflow_total: number;
  synchronized: number;
  needs_sync: number;
  status_counts: {
    installed?: number;
    pending?: number;
    planned?: number;
    in_progress?: number;
    damaged?: number;
    verified?: number;
    qc_approved?: number;
    qc_pending?: number;
    qc_failed?: number;
  };
}

export function FieldInstallationsViewer() {
  const [dataType, setDataType] = useState<DataType>('poles');
  const [viewType, setViewType] = useState<ViewType>('summary');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Poles data
  const [poleStats, setPoleStats] = useState<Stats | null>(null);
  const [poles, setPoles] = useState<PoleData[]>([]);
  const [qfieldPoles, setQfieldPoles] = useState<PoleData[]>([]);
  const [fibreflowPoles, setFibreflowPoles] = useState<PoleData[]>([]);

  // Drops data
  const [dropStats, setDropStats] = useState<Stats | null>(null);
  const [drops, setDrops] = useState<DropData[]>([]);
  const [qfieldDrops, setQfieldDrops] = useState<DropData[]>([]);
  const [fibreflowDrops, setFibreflowDrops] = useState<DropData[]>([]);

  useEffect(() => {
    fetchData();
  }, [dataType]);

  const fetchData = async () => {
    setLoading(true);
    setError(null);

    try {
      const endpoint = dataType === 'poles' ? '/api/qfield-sync-poles' : '/api/qfield-sync-drops';
      const response = await fetch(endpoint);

      if (!response.ok) {
        throw new Error(`Failed to fetch ${dataType} data`);
      }

      const result = await response.json();

      if (result.success && result.data) {
        if (dataType === 'poles') {
          setPoleStats(result.data.summary);
          setQfieldPoles(result.data.qfieldcloud_poles || []);
          setFibreflowPoles(result.data.fibreflow_poles || []);

          // Combine all poles
          const allPoles: PoleData[] = [];
          result.data.synchronized_poles?.forEach((pole: any) => {
            allPoles.push({ ...pole, sync_status: 'synced', source: 'both' });
          });
          result.data.qfieldcloud_only?.forEach((pole: any) => {
            allPoles.push({ ...pole, sync_status: 'pending', source: 'qfieldcloud' });
          });
          result.data.fibreflow_only?.forEach((pole: any) => {
            allPoles.push({ ...pole, sync_status: 'pending', source: 'fibreflow' });
          });
          result.data.needs_sync?.forEach((pole: any) => {
            allPoles.push({ ...pole, sync_status: 'conflict', source: 'both' });
          });
          setPoles(allPoles);
        } else {
          setDropStats(result.data.summary);
          setQfieldDrops(result.data.qfieldcloud_drops || []);
          setFibreflowDrops(result.data.fibreflow_drops || []);

          // Combine all drops
          const allDrops: DropData[] = [];
          result.data.synchronized_drops?.forEach((drop: any) => {
            allDrops.push({ ...drop, sync_status: 'synced', source: 'both' });
          });
          result.data.qfieldcloud_only?.forEach((drop: any) => {
            allDrops.push({ ...drop, sync_status: 'pending', source: 'qfieldcloud' });
          });
          result.data.fibreflow_only?.forEach((drop: any) => {
            allDrops.push({ ...drop, sync_status: 'pending', source: 'fibreflow' });
          });
          result.data.needs_sync?.forEach((drop: any) => {
            allDrops.push({ ...drop, sync_status: 'conflict', source: 'both' });
          });
          setDrops(allDrops);
        }
      }
    } catch (err) {
      console.error(`Error fetching ${dataType} data:`, err);
      setError(err instanceof Error ? err.message : `Failed to fetch ${dataType} data`);
    } finally {
      setLoading(false);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status?.toLowerCase()) {
      case 'installed':
      case 'completed':
      case 'approved':
        return 'bg-green-100 text-green-800';
      case 'in_progress':
      case 'pending':
        return 'bg-yellow-100 text-yellow-800';
      case 'planned':
        return 'bg-blue-100 text-blue-800';
      case 'damaged':
      case 'failed':
      case 'rejected':
        return 'bg-red-100 text-red-800';
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

  const currentStats = dataType === 'poles' ? poleStats : dropStats;

  if (loading) {
    return (
      <div className="bg-white rounded-lg shadow p-8">
        <div className="flex flex-col items-center justify-center">
          <Activity className="h-8 w-8 animate-spin text-blue-600 mb-4" />
          <p className="text-gray-600">Loading {dataType} data...</p>
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
          onClick={fetchData}
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
              {dataType === 'poles' ? <MapPin className="h-7 w-7 text-blue-600" /> : <Home className="h-7 w-7 text-green-600" />}
              Field Installations - {dataType === 'poles' ? 'Poles' : 'Drops'}
            </h2>
            <p className="text-gray-600 mt-1">
              Track and sync {dataType} installations between field and office
            </p>
          </div>

          <button
            onClick={fetchData}
            className="px-4 py-2 bg-white border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50 flex items-center gap-2"
          >
            <RefreshCw className="h-4 w-4" />
            Refresh
          </button>
        </div>

        {/* Data Type Toggle */}
        <div className="flex space-x-3 mb-4">
          <button
            onClick={() => setDataType('poles')}
            className={`px-4 py-2 rounded-lg font-medium ${
              dataType === 'poles'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
            }`}
          >
            <MapPin className="h-4 w-4 inline mr-2" />
            Poles
          </button>
          <button
            onClick={() => setDataType('drops')}
            className={`px-4 py-2 rounded-lg font-medium ${
              dataType === 'drops'
                ? 'bg-green-600 text-white'
                : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
            }`}
          >
            <Home className="h-4 w-4 inline mr-2" />
            Drops
          </button>
        </div>

        {/* View Type Tabs */}
        <div className="flex space-x-4 border-b border-gray-200">
          <button
            onClick={() => setViewType('summary')}
            className={`py-2 px-1 border-b-2 font-medium text-sm ${
              viewType === 'summary'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            Summary
          </button>
          <button
            onClick={() => setViewType('comparison')}
            className={`py-2 px-1 border-b-2 font-medium text-sm ${
              viewType === 'comparison'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            Comparison
          </button>
          <button
            onClick={() => setViewType('details')}
            className={`py-2 px-1 border-b-2 font-medium text-sm ${
              viewType === 'details'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            Details
          </button>
        </div>
      </div>

      {/* Summary View */}
      {viewType === 'summary' && currentStats && (
        <div className="space-y-4">
          {/* Statistics Cards */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="bg-white rounded-lg shadow p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-600">QFieldCloud</p>
                  <p className="text-2xl font-semibold text-gray-900 mt-1">
                    {currentStats.qfieldcloud_total}
                  </p>
                </div>
                <div className="bg-blue-100 p-3 rounded-full">
                  <MapPin className="h-6 w-6 text-blue-600" />
                </div>
              </div>
            </div>

            <div className="bg-white rounded-lg shadow p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-600">FibreFlow</p>
                  <p className="text-2xl font-semibold text-gray-900 mt-1">
                    {currentStats.fibreflow_total}
                  </p>
                </div>
                <div className="bg-green-100 p-3 rounded-full">
                  <Home className="h-6 w-6 text-green-600" />
                </div>
              </div>
            </div>

            <div className="bg-white rounded-lg shadow p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-600">Synchronized</p>
                  <p className="text-2xl font-semibold text-gray-900 mt-1">
                    {currentStats.synchronized}
                  </p>
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
                  <p className="text-2xl font-semibold text-gray-900 mt-1">
                    {currentStats.needs_sync}
                  </p>
                </div>
                <div className="bg-yellow-100 p-3 rounded-full">
                  <Clock className="h-6 w-6 text-yellow-600" />
                </div>
              </div>
            </div>
          </div>

          {/* Status Distribution */}
          <div className="bg-white rounded-lg shadow p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Status Distribution</h3>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              {dataType === 'poles' ? (
                <>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-600">Installed</span>
                    <span className="font-semibold">{currentStats.status_counts.installed || 0}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-600">Pending</span>
                    <span className="font-semibold">{currentStats.status_counts.pending || 0}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-600">Verified</span>
                    <span className="font-semibold">{currentStats.status_counts.verified || 0}</span>
                  </div>
                </>
              ) : (
                <>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-600">Installed</span>
                    <span className="font-semibold">{currentStats.status_counts.installed || 0}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-600">Planned</span>
                    <span className="font-semibold">{currentStats.status_counts.planned || 0}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-600">QC Approved</span>
                    <span className="font-semibold">{currentStats.status_counts.qc_approved || 0}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-600">QC Pending</span>
                    <span className="font-semibold">{currentStats.status_counts.qc_pending || 0}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-600">QC Failed</span>
                    <span className="font-semibold">{currentStats.status_counts.qc_failed || 0}</span>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Comparison View */}
      {viewType === 'comparison' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* QFieldCloud Data */}
          <div className="bg-white rounded-lg shadow overflow-hidden">
            <div className="bg-blue-600 px-6 py-4">
              <h3 className="text-lg font-semibold text-white">QFieldCloud Data</h3>
              <p className="text-sm text-blue-100 mt-1">
                {dataType === 'poles' ? qfieldPoles.length : qfieldDrops.length} items from field
              </p>
            </div>
            <div className="p-6">
              <div className="space-y-3 max-h-96 overflow-y-auto">
                {dataType === 'poles' ? (
                  qfieldPoles.slice(0, 10).map((pole) => (
                    <div key={pole.pole_number} className="border border-gray-200 rounded-lg p-3">
                      <div className="flex justify-between items-start">
                        <div>
                          <p className="font-medium text-gray-900">{pole.pole_number}</p>
                          <p className="text-sm text-gray-600">
                            {pole.pole_type} - {pole.height}m
                          </p>
                          <div className="flex items-center gap-2 mt-1 text-xs text-gray-500">
                            <MapPin className="h-3 w-3" />
                            {pole.address || 'GPS Captured'}
                            {pole.image_count > 0 && (
                              <>
                                <Camera className="h-3 w-3 ml-2" />
                                {pole.image_count} photos
                              </>
                            )}
                          </div>
                        </div>
                        <span className={`px-2 py-1 text-xs font-medium rounded-full ${getStatusColor(pole.status || '')}`}>
                          {pole.status || 'Unknown'}
                        </span>
                      </div>
                    </div>
                  ))
                ) : (
                  qfieldDrops.slice(0, 10).map((drop) => (
                    <div key={drop.drop_number} className="border border-gray-200 rounded-lg p-3">
                      <div className="flex justify-between items-start">
                        <div>
                          <p className="font-medium text-gray-900">{drop.drop_number}</p>
                          <p className="text-sm text-gray-600">{drop.customer_name}</p>
                          <div className="flex items-center gap-2 mt-1 text-xs text-gray-500">
                            <Ruler className="h-3 w-3" />
                            {drop.cable_length || 'N/A'}
                            <span className={`ml-2 px-2 py-0.5 text-xs rounded ${getStatusColor(drop.qc_status || '')}`}>
                              QC: {drop.qc_status || 'Pending'}
                            </span>
                          </div>
                        </div>
                        <span className={`px-2 py-1 text-xs font-medium rounded-full ${getStatusColor(drop.status || '')}`}>
                          {drop.status || 'Unknown'}
                        </span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

          {/* FibreFlow Data */}
          <div className="bg-white rounded-lg shadow overflow-hidden">
            <div className="bg-green-600 px-6 py-4">
              <h3 className="text-lg font-semibold text-white">FibreFlow Data</h3>
              <p className="text-sm text-green-100 mt-1">
                {dataType === 'poles' ? fibreflowPoles.length : fibreflowDrops.length} items in system
              </p>
            </div>
            <div className="p-6">
              <div className="space-y-3 max-h-96 overflow-y-auto">
                {dataType === 'poles' ? (
                  fibreflowPoles.slice(0, 10).map((pole) => (
                    <div key={pole.pole_number} className="border border-gray-200 rounded-lg p-3">
                      <div className="flex justify-between items-start">
                        <div>
                          <p className="font-medium text-gray-900">{pole.pole_number}</p>
                          <p className="text-sm text-gray-600">
                            {pole.pole_type} - {pole.height}m
                          </p>
                          <div className="flex items-center gap-2 mt-1 text-xs text-gray-500">
                            <MapPin className="h-3 w-3" />
                            {pole.address || 'No address'}
                          </div>
                        </div>
                        <span className={`px-2 py-1 text-xs font-medium rounded-full ${getStatusColor(pole.status || '')}`}>
                          {pole.status || 'Unknown'}
                        </span>
                      </div>
                    </div>
                  ))
                ) : (
                  fibreflowDrops.slice(0, 10).map((drop) => (
                    <div key={drop.drop_number} className="border border-gray-200 rounded-lg p-3">
                      <div className="flex justify-between items-start">
                        <div>
                          <p className="font-medium text-gray-900">{drop.drop_number}</p>
                          <p className="text-sm text-gray-600">{drop.customer_name}</p>
                          <div className="flex items-center gap-2 mt-1 text-xs text-gray-500">
                            <Ruler className="h-3 w-3" />
                            {drop.cable_length || 'N/A'}
                            <span className={`ml-2 px-2 py-0.5 text-xs rounded ${getStatusColor(drop.qc_status || '')}`}>
                              QC: {drop.qc_status || 'Pending'}
                            </span>
                          </div>
                        </div>
                        <span className={`px-2 py-1 text-xs font-medium rounded-full ${getStatusColor(drop.status || '')}`}>
                          {drop.status || 'Unknown'}
                        </span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Details View */}
      {viewType === 'details' && (
        <div className="bg-white rounded-lg shadow">
          <div className="px-6 py-4 border-b border-gray-200">
            <h3 className="text-lg font-semibold text-gray-900">
              All {dataType === 'poles' ? 'Poles' : 'Drops'} ({dataType === 'poles' ? poles.length : drops.length})
            </h3>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 tracking-wide">
                    {dataType === 'poles' ? 'Pole Number' : 'Drop Number'}
                  </th>
                  {dataType === 'poles' ? (
                    <>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 tracking-wide">
                        Type/Height
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 tracking-wide">
                        Location
                      </th>
                    </>
                  ) : (
                    <>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 tracking-wide">
                        Customer
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 tracking-wide">
                        Cable/QC
                      </th>
                    </>
                  )}
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
                {dataType === 'poles' ? (
                  poles.slice(0, 50).map((pole) => (
                    <tr key={pole.pole_number}>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                        {pole.pole_number}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {pole.pole_type} / {pole.height}m
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {pole.address || 'GPS Available'}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className={`px-2 py-1 text-xs font-medium rounded-full ${getStatusColor(pole.status || '')}`}>
                          {pole.status || 'Unknown'}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        {getSyncStatusBadge(pole.sync_status || 'pending')}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {pole.source === 'both' ? 'Both' :
                         pole.source === 'qfieldcloud' ? 'QFieldCloud' : 'FibreFlow'}
                      </td>
                    </tr>
                  ))
                ) : (
                  drops.slice(0, 50).map((drop) => (
                    <tr key={drop.drop_number}>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                        {drop.drop_number}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {drop.customer_name || 'N/A'}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {drop.cable_length || 'N/A'} / {drop.qc_status || 'Pending'}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className={`px-2 py-1 text-xs font-medium rounded-full ${getStatusColor(drop.status || '')}`}>
                          {drop.status || 'Unknown'}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        {getSyncStatusBadge(drop.sync_status || 'pending')}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {drop.source === 'both' ? 'Both' :
                         drop.source === 'qfieldcloud' ? 'QFieldCloud' : 'FibreFlow'}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

export default FieldInstallationsViewer;