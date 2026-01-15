/**
 * Fleet Vehicle Check-In Page
 * Mobile-first driver check-in interface
 */

import React, { useState, useEffect, useCallback } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { Car, Loader2, Search, AlertTriangle, CheckCircle, Lock } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { AppLayout } from '@/components/layout';
import { CheckInForm } from '@/modules/fleet/check-in/components/CheckInForm';
import { CheckInSummary } from '@/modules/fleet/check-in/components/CheckInSummary';
import { OfflineIndicator } from '@/modules/fleet/check-in/components/OfflineIndicator';
import type { CheckRecord, VehicleAvailabilityResult, CheckType } from '@/modules/fleet/types/check-in.types';

interface Vehicle {
  id: string;
  registration: string;
  make: string | null;
  model: string | null;
}

type PageState = 'select-vehicle' | 'check-in' | 'complete';

export default function CheckInPage() {
  const router = useRouter();
  const { currentUser } = useAuth();

  // URL params - vehicle pre-selected from portal
  const urlVehicleId = router.query.vehicleId as string | undefined;
  const urlCheckType = router.query.type as CheckType | undefined;
  const isVehicleLocked = Boolean(urlVehicleId); // Lock selection when coming from portal

  const [pageState, setPageState] = useState<PageState>('select-vehicle');
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [selectedVehicle, setSelectedVehicle] = useState<Vehicle | null>(null);
  const [vehicleAvailability, setVehicleAvailability] = useState<VehicleAvailabilityResult | null>(null);
  const [completedRecord, setCompletedRecord] = useState<CheckRecord | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [checkType, setCheckType] = useState<CheckType>('daily');

  // Auto-select vehicle from URL params
  const autoSelectVehicle = useCallback(async (vehicleId: string) => {
    try {
      // Fetch vehicle details (uses query param, not path param)
      const response = await fetch(`/api/fleet/vehicles?id=${vehicleId}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Vehicle not found');

      const vehicleData = data.data;
      const vehicle: Vehicle = {
        id: vehicleData.id,
        registration: vehicleData.registration,
        make: vehicleData.make,
        model: vehicleData.model,
      };

      setSelectedVehicle(vehicle);

      // Check availability
      const availResponse = await fetch(`/api/fleet/check-in/vehicle/${vehicleId}?availability=true`);
      const availData = await availResponse.json();
      if (availResponse.ok) {
        setVehicleAvailability(availData.data);
      }

      // Go directly to check-in
      setPageState('check-in');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load vehicle');
    }
  }, []);

  // Load vehicles (only if not pre-selected)
  useEffect(() => {
    async function loadVehicles() {
      try {
        const response = await fetch('/api/fleet/vehicles');
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Failed to load vehicles');
        setVehicles(data.data || []);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load vehicles');
      } finally {
        setIsLoading(false);
      }
    }

    // Only load vehicle list if not coming from portal
    if (!urlVehicleId) {
      loadVehicles();
    } else {
      setIsLoading(false);
    }
  }, [urlVehicleId]);

  // Handle URL params for pre-selected vehicle
  useEffect(() => {
    if (urlVehicleId && !selectedVehicle) {
      autoSelectVehicle(urlVehicleId);
    }
    if (urlCheckType) {
      setCheckType(urlCheckType);
    }
  }, [urlVehicleId, urlCheckType, selectedVehicle, autoSelectVehicle]);

  // Check vehicle availability when selected
  const handleVehicleSelect = async (vehicle: Vehicle) => {
    setSelectedVehicle(vehicle);
    setError(null);

    try {
      const response = await fetch(`/api/fleet/check-in/vehicle/${vehicle.id}?availability=true`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to check availability');
      setVehicleAvailability(data.data);
      setPageState('check-in');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to check vehicle availability');
    }
  };

  // Handle check-in complete
  const handleCheckInComplete = (record: CheckRecord) => {
    setCompletedRecord(record);
    setPageState('complete');
  };

  // Handle done - go back to portal or vehicle selection
  const handleDone = () => {
    if (isVehicleLocked) {
      // If came from portal, go back to portal
      router.push('/fleet/portal');
    } else {
      setSelectedVehicle(null);
      setVehicleAvailability(null);
      setCompletedRecord(null);
      setPageState('select-vehicle');
    }
  };

  // Filter vehicles by search term
  const filteredVehicles = vehicles.filter(v =>
    v.registration.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (v.make && v.make.toLowerCase().includes(searchTerm.toLowerCase())) ||
    (v.model && v.model.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  // Get driver info
  const driverId = currentUser?.id || '';
  const driverName = currentUser?.displayName || 'Unknown Driver';

  return (
    <>
      <Head>
        <title>Vehicle Check-In | FibreFlow</title>
      </Head>

      <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
        {/* Vehicle selection */}
        {pageState === 'select-vehicle' && (
          <div className="max-w-2xl mx-auto p-4">
            {/* Header */}
            <div className="mb-6">
              <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
                Vehicle Check-In
              </h1>
              <p className="text-gray-600 dark:text-gray-400 mt-1">
                Select a vehicle to perform a pre-trip inspection
              </p>
            </div>

            {/* Offline indicator */}
            <OfflineIndicator showDetails />

            {/* Error message */}
            {error && (
              <div className="mb-4 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
                <p className="text-red-700 dark:text-red-400">{error}</p>
              </div>
            )}

            {/* Search */}
            <div className="relative mb-4">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search by registration, make, or model..."
                className="w-full pl-10 pr-4 py-3 border rounded-lg bg-white dark:bg-gray-800 dark:border-gray-700"
              />
            </div>

            {/* Vehicle list */}
            {isLoading ? (
              <div className="flex items-center justify-center p-8">
                <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
              </div>
            ) : filteredVehicles.length === 0 ? (
              <div className="text-center py-8 text-gray-500 dark:text-gray-400">
                No vehicles found
              </div>
            ) : (
              <div className="space-y-3">
                {filteredVehicles.map((vehicle) => (
                  <button
                    key={vehicle.id}
                    onClick={() => handleVehicleSelect(vehicle)}
                    className="w-full p-4 bg-white dark:bg-gray-800 border dark:border-gray-700 rounded-lg flex items-center gap-4 hover:border-blue-500 transition-colors text-left"
                  >
                    <div className="p-3 bg-blue-100 dark:bg-blue-900/30 rounded-lg">
                      <Car className="w-6 h-6 text-blue-600 dark:text-blue-400" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-gray-900 dark:text-white">
                        {vehicle.registration}
                      </p>
                      {(vehicle.make || vehicle.model) && (
                        <p className="text-sm text-gray-500 dark:text-gray-400">
                          {[vehicle.make, vehicle.model].filter(Boolean).join(' ')}
                        </p>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Check-in form */}
        {pageState === 'check-in' && selectedVehicle && (
          <>
            {/* Locked vehicle indicator (from portal) */}
            {isVehicleLocked && (
              <div className="mx-4 mt-4 p-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg">
                <div className="flex items-center gap-2">
                  <Lock className="w-4 h-4 text-green-600 dark:text-green-400" />
                  <span className="text-sm text-green-700 dark:text-green-400">
                    Vehicle verified: <strong>{selectedVehicle.registration}</strong>
                    {selectedVehicle.make && ` - ${selectedVehicle.make} ${selectedVehicle.model || ''}`}
                  </span>
                </div>
                <p className="text-xs text-green-600 dark:text-green-500 mt-1 ml-6">
                  {checkType === 'daily' ? 'Daily' : 'Weekly'} check-in • Vehicle confirmed via plate scan
                </p>
              </div>
            )}

            {/* Previous check-in warning */}
            {vehicleAvailability && !vehicleAvailability.canUse && (
              <div className="mx-4 mt-4 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="font-medium text-red-700 dark:text-red-400">
                      Vehicle Has Outstanding Issues
                    </p>
                    <p className="text-sm text-red-600 dark:text-red-400 mt-1">
                      {vehicleAvailability.reason}
                    </p>
                  </div>
                </div>
              </div>
            )}

            {vehicleAvailability?.lastCheckIn && (
              <div className="mx-4 mt-4 p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
                <div className="flex items-center gap-2">
                  <CheckCircle className="w-4 h-4 text-blue-500" />
                  <span className="text-sm text-blue-700 dark:text-blue-400">
                    Last check-in: {new Date(vehicleAvailability.lastCheckIn.checkDate).toLocaleDateString()} by {vehicleAvailability.lastCheckIn.driverName}
                  </span>
                </div>
              </div>
            )}

            <CheckInForm
              vehicleId={selectedVehicle.id}
              vehicleRegistration={selectedVehicle.registration}
              driverId={driverId}
              driverName={driverName}
              initialCheckType={checkType}
              onComplete={handleCheckInComplete}
              onCancel={handleDone}
            />
          </>
        )}

        {/* Completion summary */}
        {pageState === 'complete' && completedRecord && selectedVehicle && (
          <CheckInSummary
            record={completedRecord}
            vehicleRegistration={selectedVehicle.registration}
            onDone={handleDone}
            onViewDetails={() => router.push(`/fleet/check-in/history?recordId=${completedRecord.id}`)}
          />
        )}
      </div>
    </>
  );
}

// Use full-screen layout (no sidebar for mobile-first experience)
CheckInPage.getLayout = (page: React.ReactElement) => page;

// Server-side render to avoid hydration issues
export async function getServerSideProps() {
  return { props: {} };
}
