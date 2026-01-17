/**
 * Asset Calibration Page - Server Component
 * Shows calibration schedule for test equipment
 */

import Link from 'next/link';
import {
  Gauge,
  Plus,
  Calendar,
  AlertTriangle,
  CheckCircle,
  Clock,
  FileText,
} from 'lucide-react';

interface CalibrationRecord {
  id: string;
  assetId: string;
  assetName: string;
  assetNumber: string;
  status: string;
  scheduledDate: string;
  completedDate?: string;
  providerName?: string;
  calibrationCertificateNumber?: string;
  passFail?: string;
  nextCalibrationDate?: string;
}

interface Asset {
  id: string;
  name: string;
  assetNumber: string;
  manufacturer?: string;
  model?: string;
  requiresCalibration: boolean;
  lastCalibrationDate?: string;
  nextCalibrationDate?: string;
  calibrationProvider?: string;
}

async function getCalibrationDue(): Promise<Asset[]> {
  try {
    const response = await fetch(
      `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3005'}/api/assets/maintenance/upcoming?type=calibration&limit=30`,
      { cache: 'no-store' }
    );
    if (!response.ok) return [];
    const data = await response.json();
    return data.data || [];
  } catch (error) {
    console.error('Error fetching calibrations:', error);
    return [];
  }
}

async function getAssetsRequiringCalibration(): Promise<Asset[]> {
  try {
    const response = await fetch(
      `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3005'}/api/assets?requiresCalibration=true&limit=50`,
      { cache: 'no-store' }
    );
    if (!response.ok) return [];
    const data = await response.json();
    return data.data || [];
  } catch (error) {
    console.error('Error fetching assets:', error);
    return [];
  }
}

function getDaysUntil(dateStr: string): number {
  const date = new Date(dateStr);
  const now = new Date();
  const diffTime = date.getTime() - now.getTime();
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
}

function getCalibrationStatus(asset: Asset): { status: string; color: string; label: string } {
  if (!asset.nextCalibrationDate) {
    return { status: 'never', color: 'bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-300', label: 'Never Calibrated' };
  }

  const daysUntil = getDaysUntil(asset.nextCalibrationDate);

  if (daysUntil < 0) {
    return { status: 'overdue', color: 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-300', label: 'Overdue' };
  }
  if (daysUntil <= 30) {
    return { status: 'due_soon', color: 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-300', label: 'Due Soon' };
  }
  return { status: 'current', color: 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300', label: 'Current' };
}

export default async function CalibrationPage() {
  const assets = await getAssetsRequiringCalibration();

  // Categorize assets
  const overdue = assets.filter((a) => getCalibrationStatus(a).status === 'overdue');
  const dueSoon = assets.filter((a) => getCalibrationStatus(a).status === 'due_soon');
  const current = assets.filter((a) => getCalibrationStatus(a).status === 'current');
  const neverCalibrated = assets.filter((a) => getCalibrationStatus(a).status === 'never');

  return (
    <div className="p-6">
      <div className="mb-6 flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Calibration Tracking</h1>
          <p className="text-gray-600 dark:text-gray-400">Monitor and schedule equipment calibrations</p>
        </div>
        <Link
          href="/inventory/maintenance/new?type=calibration"
          className="inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
        >
          <Plus className="h-5 w-5 mr-2" />
          Schedule Calibration
        </Link>
      </div>

      {/* Alert Banner */}
      {overdue.length > 0 && (
        <div className="mb-6 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
          <div className="flex items-center">
            <AlertTriangle className="h-5 w-5 text-red-500 mr-2" />
            <span className="font-medium text-red-800 dark:text-red-300">
              {overdue.length} {overdue.length === 1 ? 'asset requires' : 'assets require'} immediate calibration
            </span>
          </div>
        </div>
      )}

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-900/50 p-4">
          <div className="flex items-center">
            <div className="h-10 w-10 bg-red-100 dark:bg-red-900/30 rounded-lg flex items-center justify-center">
              <AlertTriangle className="h-5 w-5 text-red-500" />
            </div>
            <div className="ml-4">
              <p className="text-2xl font-bold text-gray-900 dark:text-white">{overdue.length}</p>
              <p className="text-sm text-gray-500 dark:text-gray-400">Overdue</p>
            </div>
          </div>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-900/50 p-4">
          <div className="flex items-center">
            <div className="h-10 w-10 bg-yellow-100 dark:bg-yellow-900/30 rounded-lg flex items-center justify-center">
              <Clock className="h-5 w-5 text-yellow-500" />
            </div>
            <div className="ml-4">
              <p className="text-2xl font-bold text-gray-900 dark:text-white">{dueSoon.length}</p>
              <p className="text-sm text-gray-500 dark:text-gray-400">Due in 30 days</p>
            </div>
          </div>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-900/50 p-4">
          <div className="flex items-center">
            <div className="h-10 w-10 bg-green-100 dark:bg-green-900/30 rounded-lg flex items-center justify-center">
              <CheckCircle className="h-5 w-5 text-green-500" />
            </div>
            <div className="ml-4">
              <p className="text-2xl font-bold text-gray-900 dark:text-white">{current.length}</p>
              <p className="text-sm text-gray-500 dark:text-gray-400">Current</p>
            </div>
          </div>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-900/50 p-4">
          <div className="flex items-center">
            <div className="h-10 w-10 bg-gray-100 dark:bg-gray-700 rounded-lg flex items-center justify-center">
              <Gauge className="h-5 w-5 text-gray-500 dark:text-gray-400" />
            </div>
            <div className="ml-4">
              <p className="text-2xl font-bold text-gray-900 dark:text-white">{assets.length}</p>
              <p className="text-sm text-gray-500 dark:text-gray-400">Total Tracked</p>
            </div>
          </div>
        </div>
      </div>

      {/* Asset Lists */}
      <div className="space-y-6">
        {/* Overdue */}
        {overdue.length > 0 && (
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-900/50">
            <div className="px-6 py-4 border-b border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 rounded-t-lg">
              <h2 className="text-lg font-semibold text-red-800 dark:text-red-300 flex items-center">
                <AlertTriangle className="h-5 w-5 mr-2" />
                Overdue Calibrations
              </h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 dark:bg-gray-700">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Asset</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Manufacturer</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Last Calibrated</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Due Date</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Days Overdue</th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                  {overdue.map((asset) => (
                    <tr key={asset.id} className="hover:bg-gray-50 dark:hover:bg-gray-700">
                      <td className="px-6 py-4">
                        <Link href={`/inventory/${asset.id}`} className="hover:text-blue-600 dark:hover:text-blue-400">
                          <p className="font-medium text-gray-900 dark:text-white">{asset.name}</p>
                          <p className="text-sm text-gray-500 dark:text-gray-400 font-mono">{asset.assetNumber}</p>
                        </Link>
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-500 dark:text-gray-400">
                        {asset.manufacturer} {asset.model}
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-500 dark:text-gray-400">
                        {asset.lastCalibrationDate
                          ? new Date(asset.lastCalibrationDate).toLocaleDateString()
                          : 'Never'}
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-500 dark:text-gray-400">
                        {asset.nextCalibrationDate
                          ? new Date(asset.nextCalibrationDate).toLocaleDateString()
                          : '-'}
                      </td>
                      <td className="px-6 py-4">
                        <span className="text-red-600 dark:text-red-400 font-medium">
                          {asset.nextCalibrationDate
                            ? Math.abs(getDaysUntil(asset.nextCalibrationDate))
                            : '-'} days
                        </span>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <Link
                          href={`/inventory/maintenance/new?assetId=${asset.id}&type=calibration`}
                          className="text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 text-sm font-medium"
                        >
                          Schedule
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Due Soon */}
        {dueSoon.length > 0 && (
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-900/50">
            <div className="px-6 py-4 border-b border-yellow-200 dark:border-yellow-800 bg-yellow-50 dark:bg-yellow-900/20 rounded-t-lg">
              <h2 className="text-lg font-semibold text-yellow-800 dark:text-yellow-300 flex items-center">
                <Clock className="h-5 w-5 mr-2" />
                Due Within 30 Days
              </h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 dark:bg-gray-700">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Asset</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Manufacturer</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Provider</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Due Date</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Days Left</th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                  {dueSoon.map((asset) => (
                    <tr key={asset.id} className="hover:bg-gray-50 dark:hover:bg-gray-700">
                      <td className="px-6 py-4">
                        <Link href={`/inventory/${asset.id}`} className="hover:text-blue-600 dark:hover:text-blue-400">
                          <p className="font-medium text-gray-900 dark:text-white">{asset.name}</p>
                          <p className="text-sm text-gray-500 dark:text-gray-400 font-mono">{asset.assetNumber}</p>
                        </Link>
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-500 dark:text-gray-400">
                        {asset.manufacturer} {asset.model}
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-500 dark:text-gray-400">
                        {asset.calibrationProvider || '-'}
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-500 dark:text-gray-400">
                        {asset.nextCalibrationDate
                          ? new Date(asset.nextCalibrationDate).toLocaleDateString()
                          : '-'}
                      </td>
                      <td className="px-6 py-4">
                        <span className="text-yellow-600 dark:text-yellow-400 font-medium">
                          {asset.nextCalibrationDate
                            ? getDaysUntil(asset.nextCalibrationDate)
                            : '-'} days
                        </span>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <Link
                          href={`/inventory/maintenance/new?assetId=${asset.id}&type=calibration`}
                          className="text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 text-sm font-medium"
                        >
                          Schedule
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* All Calibration-Required Assets */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-900/50">
          <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center">
              <Gauge className="h-5 w-5 mr-2 text-blue-500" />
              All Calibration-Required Assets
            </h2>
          </div>
          <div className="overflow-x-auto">
            {assets.length === 0 ? (
              <div className="p-8 text-center text-gray-500 dark:text-gray-400">
                <Gauge className="h-12 w-12 mx-auto text-gray-300 dark:text-gray-600 mb-4" />
                <p>No assets require calibration tracking</p>
              </div>
            ) : (
              <table className="w-full">
                <thead className="bg-gray-50 dark:bg-gray-700">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Asset</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Status</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Last Calibrated</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Next Due</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Provider</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                  {assets.map((asset) => {
                    const status = getCalibrationStatus(asset);
                    return (
                      <tr key={asset.id} className="hover:bg-gray-50 dark:hover:bg-gray-700">
                        <td className="px-6 py-4">
                          <Link href={`/inventory/${asset.id}`} className="hover:text-blue-600 dark:hover:text-blue-400">
                            <p className="font-medium text-gray-900 dark:text-white">{asset.name}</p>
                            <p className="text-sm text-gray-500 dark:text-gray-400">
                              {asset.manufacturer} {asset.model}
                            </p>
                          </Link>
                        </td>
                        <td className="px-6 py-4">
                          <span className={`px-2 py-1 text-xs font-medium rounded-full ${status.color}`}>
                            {status.label}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-sm text-gray-500 dark:text-gray-400">
                          {asset.lastCalibrationDate
                            ? new Date(asset.lastCalibrationDate).toLocaleDateString()
                            : 'Never'}
                        </td>
                        <td className="px-6 py-4 text-sm text-gray-500 dark:text-gray-400">
                          {asset.nextCalibrationDate
                            ? new Date(asset.nextCalibrationDate).toLocaleDateString()
                            : '-'}
                        </td>
                        <td className="px-6 py-4 text-sm text-gray-500 dark:text-gray-400">
                          {asset.calibrationProvider || '-'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
