/**
 * Asset Detail Page - Server Component
 * Shows detailed information about a single asset
 */

import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  ArrowLeft,
  Edit,
  Package,
  Calendar,
  MapPin,
  User,
  Wrench,
  History,
  FileText,
  DollarSign,
  TrendingDown,
  Shield,
  Upload,
  File,
  Download,
  AlertTriangle
} from 'lucide-react';
import { DOCUMENT_TYPE_CONFIG, type DocumentTypeValue } from '@/modules/assets/types/document';
import { ASSET_STATUS_CONFIG } from '@/modules/assets/constants/assetStatus';
import { CheckInButton } from './CheckInButton';
import { DeleteDocumentButton } from './DeleteDocumentButton';

interface PageProps {
  params: Promise<{ id: string }>;
}

async function getAsset(id: string) {
  try {
    const response = await fetch(
      `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3005'}/api/assets/${id}`,
      { cache: 'no-store' }
    );
    if (!response.ok) return null;
    const data = await response.json();
    return data.data;
  } catch (error) {
    console.error('Error fetching asset:', error);
    return null;
  }
}

async function getAssignmentHistory(id: string) {
  try {
    const response = await fetch(
      `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3005'}/api/assets/${id}/history`,
      { cache: 'no-store' }
    );
    if (!response.ok) return [];
    const data = await response.json();
    return data.data || [];
  } catch (error) {
    console.error('Error fetching history:', error);
    return [];
  }
}

async function getDocuments(id: string) {
  try {
    const response = await fetch(
      `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3005'}/api/assets/${id}/documents`,
      { cache: 'no-store' }
    );
    if (!response.ok) return [];
    const data = await response.json();
    return data.data || [];
  } catch (error) {
    console.error('Error fetching documents:', error);
    return [];
  }
}

function formatCurrency(amount: number | null | undefined, currency = 'ZAR'): string {
  if (amount == null) return '-';
  return new Intl.NumberFormat('en-ZA', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
  }).format(amount);
}

function calculateAge(purchaseDate: string | null | undefined): string {
  if (!purchaseDate) return '-';
  const purchase = new Date(purchaseDate);
  const now = new Date();
  const years = Math.floor((now.getTime() - purchase.getTime()) / (365.25 * 24 * 60 * 60 * 1000));
  const months = Math.floor(((now.getTime() - purchase.getTime()) % (365.25 * 24 * 60 * 60 * 1000)) / (30.44 * 24 * 60 * 60 * 1000));
  if (years === 0) return `${months} months`;
  if (months === 0) return `${years} year${years !== 1 ? 's' : ''}`;
  return `${years}y ${months}m`;
}

function getWarrantyStatus(warrantyEndDate: string | null | undefined): { status: string; color: string; daysLeft?: number } {
  if (!warrantyEndDate) return { status: 'No warranty', color: 'gray' };
  const end = new Date(warrantyEndDate);
  const now = new Date();
  const daysLeft = Math.ceil((end.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));

  if (daysLeft < 0) return { status: 'Expired', color: 'red' };
  if (daysLeft <= 30) return { status: `${daysLeft} days left`, color: 'orange', daysLeft };
  if (daysLeft <= 90) return { status: `${daysLeft} days left`, color: 'yellow', daysLeft };
  return { status: 'Active', color: 'green', daysLeft };
}

/**
 * Convert VF Storage URL to proxy URL for browser access
 * e.g., http://100.96.203.105:8091/assets/documents/file.pdf -> /api/uploads/assets/documents/file.pdf
 */
function getProxyUrl(vfStorageUrl: string | null | undefined): string | null {
  if (!vfStorageUrl) return null;
  // Extract path after the VF Storage base URL
  const match = vfStorageUrl.match(/100\.96\.203\.105:8091\/(.+)/);
  if (match) {
    return `/api/uploads/${match[1]}`;
  }
  // If it's already a relative URL or different format, return as-is
  return vfStorageUrl;
}

function getStatusBadge(status: string) {
  const config = ASSET_STATUS_CONFIG[status as keyof typeof ASSET_STATUS_CONFIG];
  if (!config) return null;

  const colorClasses: Record<string, string> = {
    green: 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300',
    blue: 'bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-300',
    yellow: 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-300',
    orange: 'bg-orange-100 dark:bg-orange-900/30 text-orange-800 dark:text-orange-300',
    red: 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-300',
    gray: 'bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-300',
  };

  return (
    <span className={`px-3 py-1 text-sm font-medium rounded-full ${colorClasses[config.color] || 'bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-300'}`}>
      {config.label}
    </span>
  );
}

export default async function AssetDetailPage({ params }: PageProps) {
  const { id } = await params;
  const [asset, history, documents] = await Promise.all([
    getAsset(id),
    getAssignmentHistory(id),
    getDocuments(id),
  ]);

  if (!asset) {
    notFound();
  }

  const warrantyStatus = getWarrantyStatus(asset.warrantyEndDate);
  const assetAge = calculateAge(asset.purchaseDate);

  return (
    <div className="p-6">
      {/* Header */}
      <div className="mb-6">
        <Link
          href="/assets/list"
          className="inline-flex items-center text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white mb-4"
        >
          <ArrowLeft className="h-4 w-4 mr-1" />
          Back to Assets
        </Link>

        <div className="flex justify-between items-start">
          <div className="flex items-start space-x-4">
            <div className="h-16 w-16 bg-gray-100 dark:bg-gray-700 rounded-lg flex items-center justify-center">
              <Package className="h-8 w-8 text-gray-400 dark:text-gray-500" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{asset.name}</h1>
              <p className="text-gray-600 dark:text-gray-400 font-mono">{asset.assetNumber}</p>
              <div className="mt-2">{getStatusBadge(asset.status)}</div>
            </div>
          </div>

          <div className="flex space-x-3">
            <Link
              href={`/assets/${id}/edit`}
              className="inline-flex items-center px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
            >
              <Edit className="h-4 w-4 mr-2" />
              Edit
            </Link>
            {asset.status === 'available' && (
              <Link
                href={`/assets/checkout?assetId=${id}`}
                className="inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
              >
                Check Out
              </Link>
            )}
            {asset.status === 'assigned' && (
              <CheckInButton assetId={id} />
            )}
          </div>
        </div>
      </div>

      {/* Details Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Info */}
        <div className="lg:col-span-2 space-y-6">
          {/* Basic Info */}
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-900/50 p-6">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
              Basic Information
            </h2>
            <dl className="grid grid-cols-2 gap-4">
              <div>
                <dt className="text-sm text-gray-500 dark:text-gray-400">Manufacturer</dt>
                <dd className="text-sm font-medium text-gray-900 dark:text-white">
                  {asset.manufacturer || '-'}
                </dd>
              </div>
              <div>
                <dt className="text-sm text-gray-500 dark:text-gray-400">Model</dt>
                <dd className="text-sm font-medium text-gray-900 dark:text-white">
                  {asset.model || '-'}
                </dd>
              </div>
              <div>
                <dt className="text-sm text-gray-500 dark:text-gray-400">Serial Number</dt>
                <dd className="text-sm font-medium text-gray-900 dark:text-white font-mono">
                  {asset.serialNumber || '-'}
                </dd>
              </div>
              <div>
                <dt className="text-sm text-gray-500 dark:text-gray-400">Barcode</dt>
                <dd className="text-sm font-medium text-gray-900 dark:text-white font-mono">
                  {asset.barcode || '-'}
                </dd>
              </div>
              <div>
                <dt className="text-sm text-gray-500 dark:text-gray-400">Condition</dt>
                <dd className="text-sm font-medium text-gray-900 dark:text-white capitalize">
                  {asset.condition?.replace('_', ' ') || '-'}
                </dd>
              </div>
              <div>
                <dt className="text-sm text-gray-500 dark:text-gray-400">Purchase Date</dt>
                <dd className="text-sm font-medium text-gray-900 dark:text-white">
                  {asset.purchaseDate
                    ? new Date(asset.purchaseDate).toLocaleDateString()
                    : '-'}
                </dd>
              </div>
            </dl>
          </div>

          {/* Current Assignment */}
          {asset.currentAssigneeName && (
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-900/50 p-6">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4 flex items-center">
                <User className="h-5 w-5 mr-2 text-blue-500" />
                Current Assignment
              </h2>
              <dl className="grid grid-cols-2 gap-4">
                <div>
                  <dt className="text-sm text-gray-500 dark:text-gray-400">Assigned To</dt>
                  <dd className="text-sm font-medium text-gray-900 dark:text-white">
                    {asset.currentAssigneeName}
                  </dd>
                </div>
                <div>
                  <dt className="text-sm text-gray-500 dark:text-gray-400">Type</dt>
                  <dd className="text-sm font-medium text-gray-900 dark:text-white capitalize">
                    {asset.currentAssigneeType}
                  </dd>
                </div>
                <div>
                  <dt className="text-sm text-gray-500 dark:text-gray-400">Assigned Since</dt>
                  <dd className="text-sm font-medium text-gray-900 dark:text-white">
                    {asset.assignedSince
                      ? new Date(asset.assignedSince).toLocaleDateString()
                      : '-'}
                  </dd>
                </div>
                <div>
                  <dt className="text-sm text-gray-500 dark:text-gray-400">Location</dt>
                  <dd className="text-sm font-medium text-gray-900 dark:text-white">
                    {asset.currentLocation || '-'}
                  </dd>
                </div>
              </dl>
            </div>
          )}

          {/* Assignment History */}
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-900/50 p-6">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4 flex items-center">
              <History className="h-5 w-5 mr-2 text-gray-500 dark:text-gray-400" />
              Assignment History
            </h2>
            {history.length === 0 ? (
              <p className="text-sm text-gray-500 dark:text-gray-400">No assignment history</p>
            ) : (
              <div className="space-y-4">
                {history.slice(0, 5).map((assignment: any) => (
                  <div
                    key={assignment.id}
                    className="flex items-start space-x-3 p-3 bg-gray-50 dark:bg-gray-700 rounded-lg"
                  >
                    <div className="h-8 w-8 bg-blue-100 dark:bg-blue-900/30 rounded-full flex items-center justify-center flex-shrink-0">
                      <User className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 dark:text-white">
                        {assignment.assignmentType === 'checkout'
                          ? `Checked out to ${assignment.toName}`
                          : assignment.assignmentType === 'transfer'
                          ? `Transferred to ${assignment.toName}`
                          : `Returned from ${assignment.toName}`}
                      </p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        {new Date(assignment.checkedOutAt).toLocaleString()}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Documents */}
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-900/50 p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center">
                <FileText className="h-5 w-5 mr-2 text-purple-500" />
                Documents
              </h2>
              <Link
                href={`/assets/${id}/documents/upload`}
                className="inline-flex items-center px-3 py-1.5 text-sm bg-purple-600 text-white rounded-lg hover:bg-purple-700"
              >
                <Upload className="h-4 w-4 mr-1" />
                Upload
              </Link>
            </div>

            {documents.length === 0 ? (
              <div className="text-center py-8">
                <File className="h-12 w-12 mx-auto text-gray-300 dark:text-gray-600 mb-3" />
                <p className="text-sm text-gray-500 dark:text-gray-400">No documents uploaded</p>
                <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                  Upload invoices, manuals, warranties, and more
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {documents.map((doc: any) => {
                  const typeConfig = DOCUMENT_TYPE_CONFIG[doc.documentType as DocumentTypeValue] || {
                    label: doc.documentType,
                    icon: 'file',
                  };
                  const isExpired = doc.expiryDate && new Date(doc.expiryDate) < new Date();

                  return (
                    <div
                      key={doc.id}
                      className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700 rounded-lg"
                    >
                      <div className="flex items-center space-x-3 min-w-0">
                        <div className="h-10 w-10 bg-purple-100 dark:bg-purple-900/30 rounded-lg flex items-center justify-center flex-shrink-0">
                          <File className="h-5 w-5 text-purple-600 dark:text-purple-400" />
                        </div>
                        <div className="min-w-0">
                          {doc.fileUrl ? (
                            <a
                              href={getProxyUrl(doc.fileUrl) || '#'}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-sm font-medium text-purple-600 dark:text-purple-400 hover:underline truncate block"
                            >
                              {doc.documentName}
                            </a>
                          ) : (
                            <p className="text-sm font-medium text-gray-900 dark:text-white truncate">
                              {doc.documentName}
                            </p>
                          )}
                          <div className="flex items-center space-x-2 text-xs text-gray-500 dark:text-gray-400">
                            <span>{typeConfig.label}</span>
                            {doc.expiryDate && (
                              <>
                                <span>•</span>
                                <span className={isExpired ? 'text-red-500 flex items-center' : ''}>
                                  {isExpired && <AlertTriangle className="h-3 w-3 mr-1" />}
                                  Exp: {new Date(doc.expiryDate).toLocaleDateString()}
                                </span>
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center space-x-2">
                        {doc.fileUrl && (
                          <a
                            href={getProxyUrl(doc.fileUrl) || '#'}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="p-2 text-gray-400 hover:text-blue-500 dark:hover:text-blue-400"
                            title="View/Download"
                          >
                            <Download className="h-4 w-4" />
                          </a>
                        )}
                        <DeleteDocumentButton
                          assetId={id}
                          documentId={doc.id}
                          documentName={doc.documentName}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Financial Information */}
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-900/50 p-6">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4 flex items-center">
              <DollarSign className="h-5 w-5 mr-2 text-green-500" />
              Financial
            </h2>
            <dl className="space-y-3">
              <div>
                <dt className="text-sm text-gray-500 dark:text-gray-400">Purchase Price</dt>
                <dd className="text-sm font-medium text-gray-900 dark:text-white">
                  {formatCurrency(asset.purchasePrice, asset.currency)}
                </dd>
              </div>
              <div>
                <dt className="text-sm text-gray-500 dark:text-gray-400">Current Book Value</dt>
                <dd className="text-sm font-medium text-gray-900 dark:text-white">
                  {formatCurrency(asset.currentBookValue, asset.currency)}
                </dd>
              </div>
              <div>
                <dt className="text-sm text-gray-500 dark:text-gray-400 flex items-center">
                  <TrendingDown className="h-3 w-3 mr-1" />
                  Accumulated Depreciation
                </dt>
                <dd className="text-sm font-medium text-red-600 dark:text-red-400">
                  {formatCurrency(asset.accumulatedDepreciation, asset.currency)}
                </dd>
              </div>
              <div>
                <dt className="text-sm text-gray-500 dark:text-gray-400">Salvage Value</dt>
                <dd className="text-sm font-medium text-gray-900 dark:text-white">
                  {formatCurrency(asset.salvageValue, asset.currency)}
                </dd>
              </div>
              <div>
                <dt className="text-sm text-gray-500 dark:text-gray-400">Asset Age</dt>
                <dd className="text-sm font-medium text-gray-900 dark:text-white">
                  {assetAge}
                </dd>
              </div>
              <div>
                <dt className="text-sm text-gray-500 dark:text-gray-400">Useful Life</dt>
                <dd className="text-sm font-medium text-gray-900 dark:text-white">
                  {asset.usefulLifeYears ? `${asset.usefulLifeYears} years` : '-'}
                </dd>
              </div>
            </dl>
          </div>

          {/* Warranty Status */}
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-900/50 p-6">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4 flex items-center">
              <Shield className="h-5 w-5 mr-2 text-blue-500" />
              Warranty
            </h2>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-500 dark:text-gray-400">Status</span>
                <span className={`px-2 py-1 text-xs font-medium rounded-full ${
                  warrantyStatus.color === 'green' ? 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300' :
                  warrantyStatus.color === 'orange' ? 'bg-orange-100 dark:bg-orange-900/30 text-orange-800 dark:text-orange-300' :
                  warrantyStatus.color === 'yellow' ? 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-300' :
                  warrantyStatus.color === 'red' ? 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-300' :
                  'bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-300'
                }`}>
                  {warrantyStatus.status}
                </span>
              </div>
              {asset.warrantyEndDate && (
                <div>
                  <dt className="text-sm text-gray-500 dark:text-gray-400">Expires</dt>
                  <dd className="text-sm font-medium text-gray-900 dark:text-white">
                    {new Date(asset.warrantyEndDate).toLocaleDateString()}
                  </dd>
                </div>
              )}
            </div>
          </div>

          {/* Calibration */}
          {asset.requiresCalibration && (
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-900/50 p-6">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4 flex items-center">
                <Wrench className="h-5 w-5 mr-2 text-orange-500" />
                Calibration
              </h2>
              <dl className="space-y-3">
                <div>
                  <dt className="text-sm text-gray-500 dark:text-gray-400">Last Calibration</dt>
                  <dd className="text-sm font-medium text-gray-900 dark:text-white">
                    {asset.lastCalibrationDate
                      ? new Date(asset.lastCalibrationDate).toLocaleDateString()
                      : 'Never'}
                  </dd>
                </div>
                <div>
                  <dt className="text-sm text-gray-500 dark:text-gray-400">Next Calibration</dt>
                  <dd className="text-sm font-medium text-gray-900 dark:text-white">
                    {asset.nextCalibrationDate
                      ? new Date(asset.nextCalibrationDate).toLocaleDateString()
                      : '-'}
                  </dd>
                </div>
                <div>
                  <dt className="text-sm text-gray-500 dark:text-gray-400">Provider</dt>
                  <dd className="text-sm font-medium text-gray-900 dark:text-white">
                    {asset.calibrationProvider || '-'}
                  </dd>
                </div>
              </dl>
            </div>
          )}

          {/* Location */}
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-900/50 p-6">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4 flex items-center">
              <MapPin className="h-5 w-5 mr-2 text-green-500" />
              Location
            </h2>
            <dl className="space-y-3">
              <div>
                <dt className="text-sm text-gray-500 dark:text-gray-400">Current Location</dt>
                <dd className="text-sm font-medium text-gray-900 dark:text-white">
                  {asset.currentLocation || '-'}
                </dd>
              </div>
              <div>
                <dt className="text-sm text-gray-500 dark:text-gray-400">Warehouse</dt>
                <dd className="text-sm font-medium text-gray-900 dark:text-white">
                  {asset.warehouseLocation || '-'}
                </dd>
              </div>
              <div>
                <dt className="text-sm text-gray-500 dark:text-gray-400">Bin Location</dt>
                <dd className="text-sm font-medium text-gray-900 dark:text-white">
                  {asset.binLocation || '-'}
                </dd>
              </div>
            </dl>
          </div>

          {/* Notes */}
          {asset.notes && (
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-900/50 p-6">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4 flex items-center">
                <FileText className="h-5 w-5 mr-2 text-gray-500 dark:text-gray-400" />
                Notes
              </h2>
              <p className="text-sm text-gray-600 dark:text-gray-400 whitespace-pre-wrap">
                {asset.notes}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
