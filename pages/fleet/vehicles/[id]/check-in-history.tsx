/**
 * Vehicle Check-In History Page (Portal Style)
 * Mobile-first view of check-in records for a specific vehicle
 */

import React, { useState, useEffect } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import Link from 'next/link';
import {
  Car,
  ArrowLeft,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Clock,
  ChevronDown,
  ChevronRight,
  Loader2,
  Calendar,
  User,
  Gauge,
  X,
  Camera,
  ExternalLink,
} from 'lucide-react';

interface CheckResponse {
  id: string;
  isPassed: boolean;
  notes: string | null;
  item: {
    name: string;
    isCritical: boolean;
  };
}

interface CheckPhoto {
  id: string;
  photoType: string;
  fileUrl: string;
  storageServiceUrl: string | null;
  vlmProcessed?: boolean;
  vlmConfidence?: number | null;
  capturedAt?: string;
}

interface CheckRecord {
  id: string;
  checkType: string;
  status: string;
  checkDate: string;
  checkTime: string;
  driverName: string;
  odometerReading: number | null;
  hasCriticalIssues: boolean;
  hasMinorIssues: boolean;
  responses: CheckResponse[];
  photos: CheckPhoto[];
}

interface VehicleInfo {
  id: string;
  registration: string;
  make: string | null;
  model: string | null;
  year: number | null;
}

const photoTypeLabels: Record<string, string> = {
  dashboard: 'Dashboard',
  odometer: 'Odometer',
  fuel_gauge: 'Fuel',
  front: 'Front',
  rear: 'Rear',
  under_vehicle: 'Under',
  license_disk: 'License Disk',
  damage: 'Damage',
  odometer_override: 'Override',
};

export default function VehicleCheckInHistoryPage() {
  const router = useRouter();
  const { id: vehicleId, recordId: highlightRecordId } = router.query;

  const [vehicle, setVehicle] = useState<VehicleInfo | null>(null);
  const [records, setRecords] = useState<CheckRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedRecord, setExpandedRecord] = useState<string | null>(null);
  const [lightboxPhoto, setLightboxPhoto] = useState<CheckPhoto | null>(null);

  // Auto-expand highlighted record
  useEffect(() => {
    if (highlightRecordId && typeof highlightRecordId === 'string') {
      setExpandedRecord(highlightRecordId);
    }
  }, [highlightRecordId]);

  // Load vehicle info and check-in records
  useEffect(() => {
    if (!vehicleId) return;

    async function loadData() {
      setIsLoading(true);
      setError(null);

      try {
        // Fetch vehicle info
        const vehicleRes = await fetch(`/api/fleet/vehicles/${vehicleId}`);
        if (vehicleRes.ok) {
          const vehicleData = await vehicleRes.json();
          setVehicle(vehicleData.data || vehicleData);
        }

        // Fetch check-in records for this vehicle
        const recordsRes = await fetch(`/api/fleet/vehicles/${vehicleId}/check-records`);
        if (!recordsRes.ok) throw new Error('Failed to load check-in history');

        const recordsData = await recordsRes.json();
        setRecords(recordsData.data?.records || recordsData.records || []);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load data');
      } finally {
        setIsLoading(false);
      }
    }

    loadData();
  }, [vehicleId]);

  const getStatusBadge = (record: CheckRecord) => {
    if (record.hasCriticalIssues) {
      return (
        <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400">
          <XCircle className="w-3 h-3 mr-1" />
          Issues
        </span>
      );
    }
    if (record.hasMinorIssues) {
      return (
        <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
          <AlertTriangle className="w-3 h-3 mr-1" />
          Minor
        </span>
      );
    }
    return (
      <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">
        <CheckCircle className="w-3 h-3 mr-1" />
        Passed
      </span>
    );
  };

  const getApprovalBadge = (status: string) => {
    switch (status) {
      case 'approved':
        return (
          <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">
            Approved
          </span>
        );
      case 'rejected':
        return (
          <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400">
            Rejected
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400">
            <Clock className="w-3 h-3 mr-1" />
            Pending
          </span>
        );
    }
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('en-ZA', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  };

  return (
    <>
      <Head>
        <title>Check-In History | FibreFlow</title>
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1" />
      </Head>

      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 dark:from-gray-900 dark:to-gray-800">
        {/* Header */}
        <div className="bg-white dark:bg-gray-800 shadow-sm">
          <div className="max-w-lg mx-auto px-4 py-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Link href={`/fleet/vehicles/${vehicleId}?tab=photos`}>
                <button className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors">
                  <ArrowLeft className="w-5 h-5 text-gray-600 dark:text-gray-400" />
                </button>
              </Link>
              <div className="flex items-center gap-3">
                <Car className="w-8 h-8 text-blue-600" />
                <div>
                  <h1 className="text-xl font-bold text-gray-900 dark:text-white">
                    Check-In History
                  </h1>
                  {vehicle && (
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                      {vehicle.registration}
                    </p>
                  )}
                </div>
              </div>
            </div>
            {vehicleId && (
              <Link href={`/fleet/vehicles/${vehicleId}`}>
                <button className="text-sm text-blue-600 hover:text-blue-700 flex items-center gap-1">
                  <ExternalLink className="w-4 h-4" />
                  Vehicle
                </button>
              </Link>
            )}
          </div>
        </div>

        {/* Content */}
        <div className="max-w-lg mx-auto px-4 py-6">
          {/* Vehicle Info Card */}
          {vehicle && (
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg p-4 mb-6">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 bg-blue-100 dark:bg-blue-900/30 rounded-xl flex items-center justify-center">
                  <Car className="w-6 h-6 text-blue-600 dark:text-blue-400" />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-gray-900 dark:text-white">
                    {vehicle.registration}
                  </h2>
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    {[vehicle.make, vehicle.model, vehicle.year].filter(Boolean).join(' ')}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Loading State */}
          {isLoading && (
            <div className="flex items-center justify-center p-8">
              <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
            </div>
          )}

          {/* Error State */}
          {error && (
            <div className="p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl">
              <p className="text-red-700 dark:text-red-400">{error}</p>
            </div>
          )}

          {/* Empty State */}
          {!isLoading && !error && records.length === 0 && (
            <div className="text-center py-8">
              <div className="w-16 h-16 bg-gray-100 dark:bg-gray-800 rounded-full flex items-center justify-center mx-auto mb-4">
                <Calendar className="w-8 h-8 text-gray-400" />
              </div>
              <p className="text-gray-500 dark:text-gray-400">
                No check-in records found for this vehicle
              </p>
            </div>
          )}

          {/* Records List */}
          {!isLoading && records.length > 0 && (
            <div className="space-y-3">
              {records.map((record) => {
                const isHighlighted = highlightRecordId === record.id;
                return (
                <div
                  key={record.id}
                  className={`bg-white dark:bg-gray-800 rounded-xl shadow-lg overflow-hidden ${
                    isHighlighted ? 'ring-2 ring-blue-500 ring-offset-2' : ''
                  }`}
                >
                  {/* Record Header */}
                  <div
                    className="p-4 flex items-center gap-3 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
                    onClick={() => setExpandedRecord(expandedRecord === record.id ? null : record.id)}
                  >
                    {expandedRecord === record.id ? (
                      <ChevronDown className="w-5 h-5 text-gray-400 flex-shrink-0" />
                    ) : (
                      <ChevronRight className="w-5 h-5 text-gray-400 flex-shrink-0" />
                    )}

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <span className="font-medium text-gray-900 dark:text-white capitalize">
                          {record.checkType} Check
                        </span>
                        {getStatusBadge(record)}
                        {getApprovalBadge(record.status)}
                      </div>
                      <div className="flex items-center gap-3 text-sm text-gray-500 dark:text-gray-400">
                        <span className="flex items-center gap-1">
                          <Calendar className="w-3 h-3" />
                          {formatDate(record.checkDate)}
                        </span>
                        <span className="flex items-center gap-1">
                          <User className="w-3 h-3" />
                          {record.driverName}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Expanded Details */}
                  {expandedRecord === record.id && (
                    <div className="border-t dark:border-gray-700 p-4 bg-gray-50 dark:bg-gray-900/50">
                      {/* Odometer */}
                      {record.odometerReading && (
                        <div className="flex items-center gap-2 mb-4 text-sm">
                          <Gauge className="w-4 h-4 text-gray-500" />
                          <span className="text-gray-600 dark:text-gray-400">
                            Odometer: {record.odometerReading.toLocaleString()} km
                          </span>
                        </div>
                      )}

                      {/* Checklist Results */}
                      {record.responses && record.responses.length > 0 && (
                        <>
                          <h4 className="font-medium text-gray-900 dark:text-white mb-2 text-sm">
                            Checklist Results
                          </h4>
                          <div className="space-y-2 mb-4">
                            {record.responses.map((response) => (
                              <div
                                key={response.id}
                                className="flex items-center gap-2 p-2 rounded-lg bg-white dark:bg-gray-800 text-sm"
                              >
                                {response.isPassed ? (
                                  <CheckCircle className="w-4 h-4 text-green-500 flex-shrink-0" />
                                ) : response.item.isCritical ? (
                                  <XCircle className="w-4 h-4 text-red-500 flex-shrink-0" />
                                ) : (
                                  <AlertTriangle className="w-4 h-4 text-amber-500 flex-shrink-0" />
                                )}
                                <span className="flex-1 text-gray-900 dark:text-white">
                                  {response.item.name}
                                </span>
                                {response.notes && (
                                  <span className="text-xs text-gray-500 dark:text-gray-400 truncate max-w-[100px]">
                                    {response.notes}
                                  </span>
                                )}
                              </div>
                            ))}
                          </div>
                        </>
                      )}

                      {/* Photos */}
                      {record.photos && record.photos.length > 0 && (
                        <>
                          <h4 className="font-medium text-gray-900 dark:text-white mb-2 text-sm flex items-center gap-2">
                            <Camera className="w-4 h-4" />
                            Photos ({record.photos.length})
                          </h4>
                          <div className="grid grid-cols-3 gap-2">
                            {record.photos.map((photo) => {
                              const photoUrl = photo.storageServiceUrl || photo.fileUrl;
                              const displayUrl = photoUrl.startsWith('/uploads/') ? `/api${photoUrl}` : photoUrl;
                              return (
                                <div
                                  key={photo.id}
                                  onClick={() => setLightboxPhoto(photo)}
                                  className="relative aspect-square rounded-lg overflow-hidden bg-gray-200 dark:bg-gray-700 cursor-pointer group"
                                >
                                  <img
                                    src={displayUrl}
                                    alt={photo.photoType}
                                    className="w-full h-full object-cover"
                                  />
                                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors" />
                                  <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/60 to-transparent p-1">
                                    <span className="text-white text-xs">
                                      {photoTypeLabels[photo.photoType] || photo.photoType}
                                    </span>
                                    {photo.vlmProcessed && (
                                      <span className="text-green-300 text-xs ml-1">VLM</span>
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </div>
              );})}
            </div>
          )}
        </div>

        {/* Lightbox Modal */}
        {lightboxPhoto && (
          <div
            className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4"
            onClick={() => setLightboxPhoto(null)}
          >
            <div
              className="bg-white dark:bg-gray-800 rounded-lg max-w-2xl max-h-[90vh] overflow-auto"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="relative">
                <img
                  src={lightboxPhoto.storageServiceUrl || lightboxPhoto.fileUrl}
                  alt={lightboxPhoto.photoType}
                  className="w-full h-auto"
                />
                <button
                  onClick={() => setLightboxPhoto(null)}
                  className="absolute top-4 right-4 bg-black/50 text-white p-2 rounded-full hover:bg-black/70"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="p-4 border-t dark:border-gray-700">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                      {photoTypeLabels[lightboxPhoto.photoType] || lightboxPhoto.photoType}
                    </h3>
                    {lightboxPhoto.capturedAt && (
                      <p className="text-sm text-gray-500 dark:text-gray-400">
                        Captured: {new Date(lightboxPhoto.capturedAt).toLocaleString('en-ZA')}
                      </p>
                    )}
                  </div>
                  <div className="flex gap-2">
                    {lightboxPhoto.vlmProcessed && (
                      <span className="px-2 py-1 bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 rounded text-sm">
                        VLM Processed
                      </span>
                    )}
                    {lightboxPhoto.vlmConfidence != null && (
                      <span className="px-2 py-1 bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 rounded text-sm">
                        {Math.round(lightboxPhoto.vlmConfidence * 100)}% conf
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

// Portal-style page - no sidebar layout
VehicleCheckInHistoryPage.getLayout = (page: React.ReactElement) => page;
