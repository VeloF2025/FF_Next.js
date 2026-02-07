/**
 * Fleet Vehicle Portal
 * Unified entry point for all vehicle interactions
 *
 * Flow:
 * 1. Driver captures license plate photo
 * 2. VLM verifies plate and identifies vehicle
 * 3. Driver selects action (Fuel, Daily Check-In, Weekly Check-In)
 * 4. Appropriate form opens for selected action
 */

import React, { useState, useRef, useCallback, useEffect } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import toast from 'react-hot-toast';
import {
  Camera,
  Car,
  Fuel,
  ClipboardCheck,
  CalendarCheck,
  Loader2,
  RefreshCw,
  CheckCircle,
  XCircle,
  AlertTriangle,
  ArrowLeft,
  Upload,
  X,
  Save,
  Receipt,
  User,
  Phone,
  CreditCard,
  Gauge,
  Info,
  History,
  Clock,
  ExternalLink,
  LogOut,
} from 'lucide-react';
import { usePortalSession } from '@/modules/fleet/portal';
import { VehicleCalibrationModal } from '@/modules/fleet/check-in/components/VehicleCalibrationModal';
import {
  OfflineBanner,
  useOnlineStatus,
  useServiceWorker,
  offlineStorage,
  saveOfflineFuelTransaction,
  captureGPS,
} from '@/modules/fleet/offline';

// Types
interface AssignedDriver {
  name: string;
  idNumber: string | null;
  phone: string | null;
}

interface LastReading {
  reading?: number;
  level?: number;
  recordedAt: string;
  source: string;
}

interface LastCheckIn {
  id: string;
  checkType: string;
  status: string;
  completedAt: string | null;
  completedBy: string | null;
}

interface Vehicle {
  id: string;
  registration: string;
  make: string | null;
  model: string | null;
  year: number | null;
  vehicleType: string;
  color: string | null;
  assignedStaffName: string | null;
  assignedDriver: AssignedDriver | null;
  lastOdometer: LastReading | null;
  lastFuel: LastReading | null;
  lastCheckIn: LastCheckIn | null;
}

interface PlateVerificationResult {
  success: boolean;
  extractedPlate: string;
  confidence: number;
  vehicle: Vehicle | null;
  error?: string;
}

type PortalStep = 'capture' | 'verified' | 'fuel' | 'daily-check' | 'weekly-check';

interface FuelFormData {
  transactionDate: string;
  amountRand: string;
  litres: string;
  pricePerLitre: string;
  odometerReading: string;
  stationName: string;
  fuelLevelAfter: string;
}

export default function VehiclePortalPage() {
  const router = useRouter();
  const {
    session,
    vehicle: portalVehicle,
    driver: portalDriver,
    isLoading: sessionLoading,
    isAuthenticated,
    authenticateWithPlate,
    logout,
  } = usePortalSession();
  const cameraInputRef = useRef<HTMLInputElement>(null);

  // Offline support hooks
  const { isOnline } = useOnlineStatus();
  const { isRegistered: swRegistered } = useServiceWorker();

  // Initialize offline storage on mount
  useEffect(() => {
    offlineStorage.init().catch((err) => {
      console.error('[Portal] Failed to init offline storage:', err);
    });
  }, []);

  // State
  const [step, setStep] = useState<PortalStep>('capture');
  const [platePhotoUrl, setPlatePhotoUrl] = useState<string | null>(null);
  const [platePhotoFile, setPlatePhotoFile] = useState<File | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [verificationResult, setVerificationResult] = useState<PlateVerificationResult | null>(null);
  const [verifiedVehicle, setVerifiedVehicle] = useState<Vehicle | null>(null);

  // When already authenticated (session exists), skip to verified step
  useEffect(() => {
    if (isAuthenticated && portalVehicle && !verifiedVehicle) {
      // Map portal vehicle to local Vehicle type
      setVerifiedVehicle({
        id: portalVehicle.id,
        registration: portalVehicle.registration,
        make: portalVehicle.make,
        model: portalVehicle.model,
        year: portalVehicle.year,
        vehicleType: portalVehicle.vehicleType,
        color: portalVehicle.color,
        assignedStaffName: portalVehicle.assignedDriver?.name || null,
        assignedDriver: portalVehicle.assignedDriver,
        lastOdometer: portalVehicle.lastOdometer,
        lastFuel: portalVehicle.lastFuel,
        lastCheckIn: portalVehicle.lastCheckIn,
      });
      setStep('verified');
    }
  }, [isAuthenticated, portalVehicle, verifiedVehicle]);

  // Fuel form state
  const [fuelForm, setFuelForm] = useState<FuelFormData>({
    transactionDate: new Date().toISOString().split('T')[0] || '',
    amountRand: '',
    litres: '',
    pricePerLitre: '',
    odometerReading: '',
    stationName: '',
    fuelLevelAfter: '',
  });
  const [receiptPhotoFile, setReceiptPhotoFile] = useState<File | null>(null);
  const [receiptPhotoUrl, setReceiptPhotoUrl] = useState<string | null>(null);
  const [scanningReceipt, setScanningReceipt] = useState(false);
  const [odometerPhotoFile, setOdometerPhotoFile] = useState<File | null>(null);
  const [odometerPhotoUrl, setOdometerPhotoUrl] = useState<string | null>(null);
  const [scanningOdometer, setScanningOdometer] = useState(false);

  // File input refs for reliable mobile camera access
  const receiptCameraRef = useRef<HTMLInputElement>(null);
  const receiptUploadRef = useRef<HTMLInputElement>(null);
  const odometerCameraRef = useRef<HTMLInputElement>(null);
  const odometerUploadRef = useRef<HTMLInputElement>(null);
  const [submitting, setSubmitting] = useState(false);

  // Calibration state
  const [showCalibration, setShowCalibration] = useState(false);
  const [needsCalibration, setNeedsCalibration] = useState(false);
  const [checkingCalibration, setCheckingCalibration] = useState(false);

  // Check calibration status when vehicle is verified
  React.useEffect(() => {
    async function checkCalibration() {
      if (!verifiedVehicle) return;

      setCheckingCalibration(true);
      try {
        const response = await fetch(`/api/fleet/vehicles/${verifiedVehicle.id}/calibration`);
        const data = await response.json();

        if (response.ok && data.data) {
          setNeedsCalibration(data.data.needsCalibration);
          if (data.data.needsCalibration) {
            setShowCalibration(true);
          }
        }
      } catch {
        // If error checking calibration, allow to proceed (fail open)
        setNeedsCalibration(false);
      } finally {
        setCheckingCalibration(false);
      }
    }

    checkCalibration();
  }, [verifiedVehicle]);

  // Handle calibration completion
  const handleCalibrationComplete = async (calibration: {
    baselineOdometer: number;
    baselineFuelLevel: number;
    dashboardPhotoDataUrl: string;
  }) => {
    if (!verifiedVehicle) return;

    try {
      const response = await fetch(`/api/fleet/vehicles/${verifiedVehicle.id}/calibration`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...calibration,
          calibratedByName: session?.driverName || 'Unknown Driver',
          calibratedById: session?.driverId,
        }),
      });

      if (response.ok) {
        toast.success('Vehicle calibration complete!');
        setShowCalibration(false);
        setNeedsCalibration(false);
      } else {
        const data = await response.json();
        toast.error(data.error || 'Failed to save calibration');
      }
    } catch {
      toast.error('Failed to save calibration');
    }
  };

  // Handle plate photo capture - this IS the login
  const handlePlateCapture = useCallback(async (file: File) => {
    setPlatePhotoFile(file);
    const previewUrl = URL.createObjectURL(file);
    setPlatePhotoUrl(previewUrl);

    // Start verification/authentication
    setVerifying(true);
    try {
      // Convert to base64
      const reader = new FileReader();
      reader.onload = async () => {
        const base64 = (reader.result as string).split(',')[1] || '';

        // Call plate-auth API - this creates a session (no password needed!)
        const result = await authenticateWithPlate(base64);

        setVerificationResult({
          success: result.success,
          extractedPlate: result.extractedPlate,
          confidence: result.confidence,
          vehicle: result.vehicle ? {
            id: result.vehicle.id,
            registration: result.vehicle.registration,
            make: result.vehicle.make,
            model: result.vehicle.model,
            year: result.vehicle.year,
            vehicleType: result.vehicle.vehicleType,
            color: result.vehicle.color,
            assignedStaffName: result.vehicle.assignedDriver?.name || null,
            assignedDriver: result.vehicle.assignedDriver,
            lastOdometer: result.vehicle.lastOdometer,
            lastFuel: result.vehicle.lastFuel,
            lastCheckIn: result.vehicle.lastCheckIn,
          } : null,
          error: result.error,
        });

        if (result.success && result.vehicle) {
          setVerifiedVehicle({
            id: result.vehicle.id,
            registration: result.vehicle.registration,
            make: result.vehicle.make,
            model: result.vehicle.model,
            year: result.vehicle.year,
            vehicleType: result.vehicle.vehicleType,
            color: result.vehicle.color,
            assignedStaffName: result.vehicle.assignedDriver?.name || null,
            assignedDriver: result.vehicle.assignedDriver,
            lastOdometer: result.vehicle.lastOdometer,
            lastFuel: result.vehicle.lastFuel,
            lastCheckIn: result.vehicle.lastCheckIn,
          });
          setStep('verified');
          toast.success(`Logged in: ${result.vehicle.registration}`);
        } else {
          toast.error(result.error || 'Could not verify plate');
        }

        setVerifying(false);
      };
      reader.readAsDataURL(file);
    } catch (err) {
      toast.error('Failed to verify plate');
      setVerifying(false);
    }
  }, [authenticateWithPlate]);

  // Reset and try again (logout)
  const handleReset = () => {
    // Clear portal session
    logout();

    setStep('capture');
    setPlatePhotoUrl(null);
    setPlatePhotoFile(null);
    setVerificationResult(null);
    setVerifiedVehicle(null);
    setFuelForm({
      transactionDate: new Date().toISOString().split('T')[0] || '',
      amountRand: '',
      litres: '',
      pricePerLitre: '',
      odometerReading: '',
      stationName: '',
      fuelLevelAfter: '',
    });
    setReceiptPhotoFile(null);
    setReceiptPhotoUrl(null);
    setOdometerPhotoFile(null);
    setOdometerPhotoUrl(null);
  };

  // Handle action selection
  const handleActionSelect = (action: 'fuel' | 'daily-check' | 'weekly-check') => {
    setStep(action);
  };

  // Handle receipt scan with VLM
  const handleReceiptScan = async (file: File) => {
    setReceiptPhotoFile(file);
    setReceiptPhotoUrl(URL.createObjectURL(file));
    setScanningReceipt(true);

    try {
      // Convert file to base64
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const result = reader.result as string;
          const base64Part = result.split(',')[1];
          if (!base64Part) {
            reject(new Error('Failed to convert file to base64'));
            return;
          }
          resolve(base64Part);
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });

      const response = await fetch(
        `/api/fleet/vehicles/${verifiedVehicle?.id}/fuel-transactions?action=scan`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ receiptPhotoBase64: base64 }),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        const errorMsg = data.error?.message || data.message || 'Scan failed';
        toast.error(`Receipt scan error: ${errorMsg}`);
        return;
      }

      const results = data.data?.vlmResults?.receipt;

      if (!results) {
        toast.error('No data extracted from receipt');
        return;
      }

      if (results.error) {
        toast.error(`VLM error: ${results.error}`);
        return;
      }

      // Check if any meaningful data was extracted
      const hasData = results.amountRand || results.litres || results.stationName;
      if (!hasData) {
        toast.error('Could not read receipt. Please enter values manually.');
        return;
      }

      setFuelForm((prev) => ({
        ...prev,
        transactionDate: results.date || prev.transactionDate,
        amountRand: results.amountRand?.toString() || prev.amountRand,
        litres: results.litres?.toString() || prev.litres,
        pricePerLitre: results.pricePerLitre?.toString() || prev.pricePerLitre,
        stationName: results.stationName || prev.stationName,
      }));
      toast.success(
        `Receipt scanned (${Math.round((results.confidence || 0) * 100)}% confidence)`
      );
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      console.error('[Receipt Scan Error]', err);
      toast.error(`Failed to scan receipt: ${errorMessage}`);
    } finally {
      setScanningReceipt(false);
    }
  };

  // Handle odometer scan with VLM
  const handleOdometerScan = async (file: File) => {
    setOdometerPhotoFile(file);
    setOdometerPhotoUrl(URL.createObjectURL(file));
    setScanningOdometer(true);

    try {
      // Convert file to base64
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const result = reader.result as string;
          const base64Part = result.split(',')[1];
          if (!base64Part) {
            reject(new Error('Failed to convert file to base64'));
            return;
          }
          resolve(base64Part);
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });

      const response = await fetch(
        `/api/fleet/vehicles/${verifiedVehicle?.id}/fuel-transactions?action=scan`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ odometerPhotoBase64: base64 }),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        const errorMsg = data.error?.message || data.message || 'Scan failed';
        toast.error(`Odometer scan error: ${errorMsg}`);
        return;
      }

      const results = data.data?.vlmResults?.odometer;

      if (!results) {
        toast.error('No data extracted from odometer photo');
        return;
      }

      if (results.error) {
        toast.error(`VLM error: ${results.error}`);
        return;
      }

      if (!results.reading) {
        toast.error('Could not read odometer. Please enter manually.');
        return;
      }

      setFuelForm((prev) => ({
        ...prev,
        odometerReading: results.reading.toString(),
      }));
      toast.success(
        `Odometer: ${results.reading.toLocaleString()} km (${Math.round((results.confidence || 0) * 100)}% confidence)`
      );
    } catch (err) {
      toast.error('Failed to scan odometer');
    } finally {
      setScanningOdometer(false);
    }
  };

  // Upload photo to server
  const uploadPhoto = async (file: File, folder: string): Promise<string | null> => {
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('folder', folder);

      const response = await fetch('/api/fleet/upload', {
        method: 'POST',
        credentials: 'include',
        body: formData,
      });

      const data = await response.json();

      if (!response.ok) {
        console.error('Upload failed:', data.error?.message);
        return null;
      }

      return data.data?.url || null;
    } catch (error) {
      console.error('Upload error:', error);
      return null;
    }
  };

  // Submit fuel transaction (handles both online and offline)
  const handleFuelSubmit = async () => {
    if (!verifiedVehicle) return;

    const amount = parseFloat(fuelForm.amountRand);
    const litres = parseFloat(fuelForm.litres);

    if (isNaN(amount) || amount <= 0) {
      toast.error('Please enter a valid amount');
      return;
    }
    if (isNaN(litres) || litres <= 0) {
      toast.error('Please enter valid litres');
      return;
    }
    if (!receiptPhotoFile) {
      toast.error('Receipt photo is required');
      return;
    }

    setSubmitting(true);
    try {
      // Check if offline - save locally instead
      if (!isOnline) {
        const result = await saveOfflineFuelTransaction({
          vehicleId: verifiedVehicle.id,
          vehicleRegistration: verifiedVehicle.registration,
          transactionDate: fuelForm.transactionDate,
          amountRand: amount,
          litres: litres,
          pricePerLitre: fuelForm.pricePerLitre
            ? parseFloat(fuelForm.pricePerLitre)
            : undefined,
          odometerReading: fuelForm.odometerReading
            ? parseInt(fuelForm.odometerReading, 10)
            : undefined,
          stationName: fuelForm.stationName || undefined,
          fuelLevelAfter: fuelForm.fuelLevelAfter
            ? parseInt(fuelForm.fuelLevelAfter, 10)
            : undefined,
          driverName: portalDriver?.name || session?.driverName,
          receiptPhoto: receiptPhotoFile
            ? { file: receiptPhotoFile, previewUrl: receiptPhotoUrl || '' }
            : undefined,
          odometerPhoto: odometerPhotoFile
            ? { file: odometerPhotoFile, previewUrl: odometerPhotoUrl || '' }
            : undefined,
        });

        if (result.success) {
          toast.success('Saved offline! Will sync when connected.', {
            icon: '📱',
            duration: 4000,
          });
          handleReset();
        } else {
          toast.error(result.error || 'Failed to save offline');
        }
        return;
      }

      // Online flow - upload and submit to server
      // Upload receipt photo (use flat category - VF Storage doesn't support nested paths)
      const uploadedReceiptUrl = await uploadPhoto(
        receiptPhotoFile,
        `fleet/fuel-receipts`
      );

      if (!uploadedReceiptUrl) {
        toast.error('Failed to upload receipt photo');
        return;
      }

      // Upload odometer photo if provided
      let uploadedOdometerUrl: string | null = null;
      if (odometerPhotoFile) {
        uploadedOdometerUrl = await uploadPhoto(
          odometerPhotoFile,
          `fleet/fuel-odometers`
        );
      }

      // Capture GPS for the transaction
      const gpsResult = await captureGPS(5000, true);

      // Create transaction
      const response = await fetch(
        `/api/fleet/vehicles/${verifiedVehicle.id}/fuel-transactions`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            transactionDate: fuelForm.transactionDate,
            amountRand: amount,
            litres: litres,
            pricePerLitre: fuelForm.pricePerLitre
              ? parseFloat(fuelForm.pricePerLitre)
              : undefined,
            odometerReading: fuelForm.odometerReading
              ? parseInt(fuelForm.odometerReading, 10)
              : undefined,
            stationName: fuelForm.stationName || undefined,
            fuelLevelAfter: fuelForm.fuelLevelAfter
              ? parseInt(fuelForm.fuelLevelAfter, 10)
              : undefined,
            receiptPhotoUrl: uploadedReceiptUrl,
            odometerPhotoUrl: uploadedOdometerUrl || undefined,
            gpsLat: gpsResult.coordinates?.latitude,
            gpsLng: gpsResult.coordinates?.longitude,
            source: 'hybrid',
          }),
        }
      );

      if (response.ok) {
        toast.success('Fuel transaction recorded!');
        handleReset();
      } else {
        const data = await response.json();
        toast.error(data.error || 'Failed to save transaction');
      }
    } catch (err) {
      // If online request fails, try saving offline
      if (!isOnline) {
        toast.error('Failed to save. Please try again.');
      } else {
        // Offer to save offline
        const result = await saveOfflineFuelTransaction({
          vehicleId: verifiedVehicle.id,
          vehicleRegistration: verifiedVehicle.registration,
          transactionDate: fuelForm.transactionDate,
          amountRand: amount,
          litres: litres,
          pricePerLitre: fuelForm.pricePerLitre
            ? parseFloat(fuelForm.pricePerLitre)
            : undefined,
          odometerReading: fuelForm.odometerReading
            ? parseInt(fuelForm.odometerReading, 10)
            : undefined,
          stationName: fuelForm.stationName || undefined,
          fuelLevelAfter: fuelForm.fuelLevelAfter
            ? parseInt(fuelForm.fuelLevelAfter, 10)
            : undefined,
          driverName: portalDriver?.name || session?.driverName,
          receiptPhoto: receiptPhotoFile
            ? { file: receiptPhotoFile, previewUrl: receiptPhotoUrl || '' }
            : undefined,
          odometerPhoto: odometerPhotoFile
            ? { file: odometerPhotoFile, previewUrl: odometerPhotoUrl || '' }
            : undefined,
        });

        if (result.success) {
          toast.success('Connection lost. Saved offline for later sync.', {
            icon: '📱',
            duration: 4000,
          });
          handleReset();
        } else {
          toast.error('Failed to save transaction');
        }
      }
    } finally {
      setSubmitting(false);
    }
  };

  // Navigate to check-in with vehicle pre-selected
  const handleCheckInRedirect = (checkType: 'daily' | 'weekly') => {
    if (verifiedVehicle) {
      router.push(
        `/fleet/check-in?vehicleId=${verifiedVehicle.id}&type=${checkType}`
      );
    }
  };

  return (
    <>
      <Head>
        <title>Vehicle Portal | FibreFlow</title>
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1" />
      </Head>

      {/* Offline Status Banner */}
      <OfflineBanner className="sticky top-0 z-50" />

      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 dark:from-gray-900 dark:to-gray-800">
        {/* Header */}
        <div className="bg-white dark:bg-gray-800 shadow-sm">
          <div className="max-w-lg mx-auto px-4 py-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Car className="w-8 h-8 text-blue-600" />
              <div>
                <h1 className="text-xl font-bold text-gray-900 dark:text-white">
                  Vehicle Portal
                </h1>
                {isAuthenticated && session && (
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    {session.driverName || session.vehicleRegistration}
                  </p>
                )}
              </div>
            </div>
            {step !== 'capture' && (
              <button
                onClick={handleReset}
                className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors flex items-center gap-2"
                title="Logout / Switch Vehicle"
              >
                <LogOut className="w-5 h-5 text-gray-600 dark:text-gray-400" />
              </button>
            )}
          </div>
        </div>

        <div className="max-w-lg mx-auto px-4 py-6">
          {/* Loading state - checking for existing session */}
          {sessionLoading && step === 'capture' && (
            <div className="flex flex-col items-center justify-center py-20">
              <Loader2 className="w-12 h-12 text-blue-600 animate-spin mb-4" />
              <p className="text-gray-600 dark:text-gray-400">Checking session...</p>
            </div>
          )}

          {/* Step 1: Capture Plate */}
          {!sessionLoading && step === 'capture' && (
            <div className="space-y-6">
              <div className="text-center">
                <div className="w-20 h-20 bg-blue-100 dark:bg-blue-900/30 rounded-full flex items-center justify-center mx-auto mb-4">
                  <Camera className="w-10 h-10 text-blue-600 dark:text-blue-400" />
                </div>
                <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
                  Scan License Plate
                </h2>
                <p className="text-gray-600 dark:text-gray-400">
                  Take a photo of the vehicle's license plate to get started
                </p>
              </div>

              {/* Plate photo preview */}
              {platePhotoUrl && (
                <div className="relative">
                  <img
                    src={platePhotoUrl}
                    alt="License plate"
                    className="w-full h-48 object-cover rounded-xl shadow-lg"
                  />
                  {verifying && (
                    <div className="absolute inset-0 bg-black/50 rounded-xl flex items-center justify-center">
                      <div className="text-center text-white">
                        <Loader2 className="w-10 h-10 animate-spin mx-auto mb-2" />
                        <p>Verifying plate...</p>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Verification error */}
              {verificationResult && !verificationResult.success && (
                <div className="p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl">
                  <div className="flex items-start gap-3">
                    <XCircle className="w-6 h-6 text-red-500 flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="font-medium text-red-800 dark:text-red-200">
                        Verification Failed
                      </p>
                      <p className="text-sm text-red-600 dark:text-red-300 mt-1">
                        {verificationResult.error || 'Could not identify vehicle'}
                      </p>
                      {verificationResult.extractedPlate && (
                        <p className="text-sm text-red-600 dark:text-red-300 mt-1">
                          Detected: {verificationResult.extractedPlate}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Capture buttons */}
              <div className="space-y-3">
                {/* Camera capture */}
                <input
                  ref={cameraInputRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handlePlateCapture(file);
                  }}
                />
                <button
                  onClick={() => cameraInputRef.current?.click()}
                  disabled={verifying}
                  className="w-full py-4 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-semibold flex items-center justify-center gap-3 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-lg"
                >
                  <Camera className="w-6 h-6" />
                  Take Photo
                </button>
              </div>

              {/* Info text */}
              <p className="text-center text-sm text-gray-500 dark:text-gray-400">
                For best results, ensure the plate is clearly visible and well-lit
              </p>
            </div>
          )}

          {/* Step 2: Vehicle Verified - Action Selection */}
          {step === 'verified' && verifiedVehicle && (
            <div className="space-y-6">
              {/* Success banner */}
              <div className="p-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-xl">
                <div className="flex items-center gap-3">
                  <CheckCircle className="w-8 h-8 text-green-500" />
                  <div>
                    <p className="font-bold text-green-800 dark:text-green-200 text-lg">
                      Vehicle Verified
                    </p>
                    <p className="text-sm text-green-600 dark:text-green-300">
                      {verificationResult?.confidence
                        ? `${Math.round(verificationResult.confidence * 100)}% confidence`
                        : 'Plate matched'}
                    </p>
                  </div>
                </div>
              </div>

              {/* Vehicle details card */}
              <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg p-5">
                <div className="flex items-start gap-4">
                  <div className="w-14 h-14 bg-blue-100 dark:bg-blue-900/30 rounded-xl flex items-center justify-center">
                    <Car className="w-8 h-8 text-blue-600 dark:text-blue-400" />
                  </div>
                  <div className="flex-1">
                    <h3 className="text-2xl font-bold text-gray-900 dark:text-white">
                      {verifiedVehicle.registration}
                    </h3>
                    <p className="text-gray-600 dark:text-gray-400">
                      {[verifiedVehicle.make, verifiedVehicle.model, verifiedVehicle.year]
                        .filter(Boolean)
                        .join(' ')}
                    </p>
                    {verifiedVehicle.color && (
                      <p className="text-sm text-gray-500 dark:text-gray-500 mt-1">
                        Color: {verifiedVehicle.color}
                      </p>
                    )}
                  </div>
                </div>

                {/* Last Readings */}
                {(verifiedVehicle.lastOdometer || verifiedVehicle.lastFuel) && (
                  <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
                    <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400 mb-2">
                      <Gauge className="w-4 h-4" />
                      <span className="font-medium">Last Recorded Readings</span>
                    </div>
                    <div className="flex flex-wrap gap-4 text-sm">
                      {verifiedVehicle.lastOdometer && (
                        <div className="bg-gray-50 dark:bg-gray-700/50 px-3 py-2 rounded-lg">
                          <span className="text-gray-500 dark:text-gray-400">Odometer: </span>
                          <span className="font-semibold text-gray-900 dark:text-white">
                            {verifiedVehicle.lastOdometer.reading?.toLocaleString()} km
                          </span>
                          <span className="text-gray-400 dark:text-gray-500 text-xs ml-1">
                            ({new Date(verifiedVehicle.lastOdometer.recordedAt).toLocaleDateString()})
                          </span>
                        </div>
                      )}
                      {verifiedVehicle.lastFuel && (
                        <div className="bg-gray-50 dark:bg-gray-700/50 px-3 py-2 rounded-lg">
                          <span className="text-gray-500 dark:text-gray-400">Fuel: </span>
                          <span className="font-semibold text-gray-900 dark:text-white">
                            {verifiedVehicle.lastFuel.level}%
                          </span>
                          <span className="text-gray-400 dark:text-gray-500 text-xs ml-1">
                            ({new Date(verifiedVehicle.lastFuel.recordedAt).toLocaleDateString()})
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Registered Driver Card */}
              {verifiedVehicle.assignedDriver && (
                <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg p-5">
                  <div className="flex items-center gap-2 text-gray-600 dark:text-gray-400 mb-3">
                    <User className="w-5 h-5" />
                    <span className="font-medium">Registered Driver</span>
                  </div>
                  <div className="space-y-2">
                    <p className="text-lg font-semibold text-gray-900 dark:text-white">
                      {verifiedVehicle.assignedDriver.name}
                    </p>
                    {verifiedVehicle.assignedDriver.idNumber && (
                      <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
                        <CreditCard className="w-4 h-4" />
                        <span>ID: {verifiedVehicle.assignedDriver.idNumber}</span>
                      </div>
                    )}
                    {verifiedVehicle.assignedDriver.phone && (
                      <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
                        <Phone className="w-4 h-4" />
                        <span>{verifiedVehicle.assignedDriver.phone}</span>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Last Check-In Card */}
              {verifiedVehicle.lastCheckIn && (
                <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg p-5">
                  <div className="flex items-center gap-2 text-gray-600 dark:text-gray-400 mb-3">
                    <Clock className="w-5 h-5" />
                    <span className="font-medium">Last Check-In</span>
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-gray-500 dark:text-gray-400">Type:</span>
                      <span className="text-sm font-medium text-gray-900 dark:text-white capitalize">
                        {verifiedVehicle.lastCheckIn.checkType.replace('_', ' ')}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-gray-500 dark:text-gray-400">Status:</span>
                      <span className={`text-sm font-medium capitalize ${
                        verifiedVehicle.lastCheckIn.status === 'completed'
                          ? 'text-green-600 dark:text-green-400'
                          : verifiedVehicle.lastCheckIn.status === 'in_progress'
                          ? 'text-yellow-600 dark:text-yellow-400'
                          : 'text-gray-600 dark:text-gray-400'
                      }`}>
                        {verifiedVehicle.lastCheckIn.status.replace('_', ' ')}
                      </span>
                    </div>
                    {verifiedVehicle.lastCheckIn.completedAt && (
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-gray-500 dark:text-gray-400">Date:</span>
                        <span className="text-sm font-medium text-gray-900 dark:text-white">
                          {new Date(verifiedVehicle.lastCheckIn.completedAt).toLocaleDateString('en-ZA', {
                            day: 'numeric',
                            month: 'short',
                            year: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </span>
                      </div>
                    )}
                    {verifiedVehicle.lastCheckIn.completedBy && (
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-gray-500 dark:text-gray-400">By:</span>
                        <span className="text-sm font-medium text-gray-900 dark:text-white">
                          {verifiedVehicle.lastCheckIn.completedBy}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Fleet Manager Contact Notice */}
              <div className="p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-xl">
                <div className="flex items-start gap-3">
                  <Info className="w-5 h-5 text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm text-blue-800 dark:text-blue-200">
                      If any of the above details are incorrect or in case of emergency, please contact the{' '}
                      <span className="font-semibold">Fleet Manager</span>.
                    </p>
                  </div>
                </div>
              </div>

              {/* Action selection */}
              <div>
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
                  What would you like to do?
                </h3>
                <div className="space-y-3">
                  {/* Fuel Fill-up */}
                  <button
                    onClick={() => handleActionSelect('fuel')}
                    className="w-full p-4 bg-white dark:bg-gray-800 border-2 border-gray-200 dark:border-gray-700 hover:border-green-400 dark:hover:border-green-500 rounded-xl flex items-center gap-4 transition-colors group"
                  >
                    <div className="w-12 h-12 bg-green-100 dark:bg-green-900/30 rounded-xl flex items-center justify-center group-hover:scale-110 transition-transform">
                      <Fuel className="w-7 h-7 text-green-600 dark:text-green-400" />
                    </div>
                    <div className="flex-1 text-left">
                      <p className="font-semibold text-gray-900 dark:text-white">
                        Fuel Fill-up
                      </p>
                      <p className="text-sm text-gray-500 dark:text-gray-400">
                        Record fuel purchase with receipt
                      </p>
                    </div>
                  </button>

                  {/* Daily Check-In */}
                  <button
                    onClick={() => handleCheckInRedirect('daily')}
                    className="w-full p-4 bg-white dark:bg-gray-800 border-2 border-gray-200 dark:border-gray-700 hover:border-blue-400 dark:hover:border-blue-500 rounded-xl flex items-center gap-4 transition-colors group"
                  >
                    <div className="w-12 h-12 bg-blue-100 dark:bg-blue-900/30 rounded-xl flex items-center justify-center group-hover:scale-110 transition-transform">
                      <ClipboardCheck className="w-7 h-7 text-blue-600 dark:text-blue-400" />
                    </div>
                    <div className="flex-1 text-left">
                      <p className="font-semibold text-gray-900 dark:text-white">
                        Daily Check-In
                      </p>
                      <p className="text-sm text-gray-500 dark:text-gray-400">
                        Quick pre-trip inspection
                      </p>
                    </div>
                  </button>

                  {/* Weekly Check-In */}
                  <button
                    onClick={() => handleCheckInRedirect('weekly')}
                    className="w-full p-4 bg-white dark:bg-gray-800 border-2 border-gray-200 dark:border-gray-700 hover:border-purple-400 dark:hover:border-purple-500 rounded-xl flex items-center gap-4 transition-colors group"
                  >
                    <div className="w-12 h-12 bg-purple-100 dark:bg-purple-900/30 rounded-xl flex items-center justify-center group-hover:scale-110 transition-transform">
                      <CalendarCheck className="w-7 h-7 text-purple-600 dark:text-purple-400" />
                    </div>
                    <div className="flex-1 text-left">
                      <p className="font-semibold text-gray-900 dark:text-white">
                        Weekly Check-In
                      </p>
                      <p className="text-sm text-gray-500 dark:text-gray-400">
                        Comprehensive weekly inspection
                      </p>
                    </div>
                  </button>

                  {/* Separator */}
                  <div className="my-2 border-t border-gray-200 dark:border-gray-700" />

                  {/* Check-In History (moved to bottom) */}
                  <button
                    onClick={() => router.push(`/fleet/vehicles/${verifiedVehicle.id}/check-in-history`)}
                    className="w-full p-4 bg-gray-50 dark:bg-gray-800/50 border-2 border-gray-200 dark:border-gray-700 hover:border-gray-400 dark:hover:border-gray-500 rounded-xl flex items-center gap-4 transition-colors"
                  >
                    <div className="w-12 h-12 bg-gray-100 dark:bg-gray-800 rounded-xl flex items-center justify-center">
                      <History className="w-6 h-6 text-gray-500 dark:text-gray-400" />
                    </div>
                    <div className="flex-1 text-left">
                      <p className="font-medium text-gray-700 dark:text-gray-300">
                        View Check-In History
                      </p>
                      <p className="text-sm text-gray-500 dark:text-gray-400">
                        See all past inspections
                      </p>
                    </div>
                    <ExternalLink className="w-5 h-5 text-gray-400" />
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Calibration Modal */}
          {verifiedVehicle && (
            <VehicleCalibrationModal
              isOpen={showCalibration}
              onComplete={handleCalibrationComplete}
              vehicleRegistration={verifiedVehicle.registration}
              vehicleMake={verifiedVehicle.make || undefined}
              vehicleModel={verifiedVehicle.model || undefined}
              driverName={session?.driverName || 'Unknown Driver'}
            />
          )}

          {/* Step 3: Fuel Fill-up Form */}
          {step === 'fuel' && verifiedVehicle && (
            <div className="space-y-6">
              {/* Header */}
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setStep('verified')}
                  className="p-2 hover:bg-white/50 dark:hover:bg-gray-800 rounded-lg transition-colors"
                >
                  <ArrowLeft className="w-5 h-5 text-gray-600 dark:text-gray-400" />
                </button>
                <div>
                  <h2 className="text-xl font-bold text-gray-900 dark:text-white">
                    Fuel Fill-up
                  </h2>
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    {verifiedVehicle.registration}
                  </p>
                </div>
              </div>

              {/* Receipt scan section */}
              <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg p-5">
                <div className="flex items-center gap-3 mb-3">
                  <Receipt className="w-5 h-5 text-green-600" />
                  <h3 className="font-semibold text-gray-900 dark:text-white">
                    Scan Receipt
                  </h3>
                </div>
                <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
                  Take a photo of your fuel receipt to auto-fill the details
                </p>

                {receiptPhotoUrl ? (
                  <div className="relative">
                    <img
                      src={receiptPhotoUrl}
                      alt="Receipt"
                      className="w-full h-40 object-cover rounded-lg"
                    />
                    {scanningReceipt && (
                      <div className="absolute inset-0 bg-black/50 rounded-lg flex items-center justify-center">
                        <div className="text-center text-white">
                          <Loader2 className="w-8 h-8 animate-spin mx-auto mb-2" />
                          <p className="text-sm">Scanning...</p>
                        </div>
                      </div>
                    )}
                    <button
                      onClick={() => {
                        setReceiptPhotoFile(null);
                        setReceiptPhotoUrl(null);
                      }}
                      className="absolute top-2 right-2 p-1.5 bg-red-500 hover:bg-red-600 text-white rounded-full"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ) : (
                  <div className="flex gap-3">
                    <input
                      ref={receiptCameraRef}
                      type="file"
                      accept="image/*"
                      capture="environment"
                      className="absolute opacity-0 w-0 h-0"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) handleReceiptScan(file);
                        // Reset input so same file can be selected again
                        e.target.value = '';
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => receiptCameraRef.current?.click()}
                      className="flex-1 py-3 bg-green-50 dark:bg-green-900/20 hover:bg-green-100 dark:hover:bg-green-900/30 text-green-700 dark:text-green-400 rounded-lg font-medium flex items-center justify-center gap-2 cursor-pointer transition-colors"
                    >
                      <Camera className="w-5 h-5" />
                      Camera
                    </button>
                    <input
                      ref={receiptUploadRef}
                      type="file"
                      accept="image/*"
                      className="absolute opacity-0 w-0 h-0"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) handleReceiptScan(file);
                        // Reset input so same file can be selected again
                        e.target.value = '';
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => receiptUploadRef.current?.click()}
                      className="flex-1 py-3 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 rounded-lg font-medium flex items-center justify-center gap-2 cursor-pointer transition-colors"
                    >
                      <Upload className="w-5 h-5" />
                      Upload
                    </button>
                  </div>
                )}
              </div>

              {/* Odometer photo section */}
              <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg p-5">
                <div className="flex items-center gap-3 mb-3">
                  <Gauge className="w-5 h-5 text-blue-600" />
                  <h3 className="font-semibold text-gray-900 dark:text-white">
                    Odometer Photo
                  </h3>
                  <span className="text-xs text-gray-400">(Optional)</span>
                </div>
                <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
                  Take a photo of your odometer to auto-fill the reading
                </p>

                {odometerPhotoUrl ? (
                  <div className="relative">
                    <img
                      src={odometerPhotoUrl}
                      alt="Odometer"
                      className="w-full h-40 object-cover rounded-lg"
                    />
                    {scanningOdometer && (
                      <div className="absolute inset-0 bg-black/50 rounded-lg flex items-center justify-center">
                        <div className="text-center text-white">
                          <Loader2 className="w-8 h-8 animate-spin mx-auto mb-2" />
                          <p className="text-sm">Reading odometer...</p>
                        </div>
                      </div>
                    )}
                    <button
                      onClick={() => {
                        setOdometerPhotoFile(null);
                        setOdometerPhotoUrl(null);
                      }}
                      className="absolute top-2 right-2 p-1.5 bg-red-500 hover:bg-red-600 text-white rounded-full"
                    >
                      <X className="w-4 h-4" />
                    </button>
                    {fuelForm.odometerReading && (
                      <div className="absolute bottom-2 left-2 bg-green-600 text-white px-3 py-1 rounded-lg text-sm font-medium">
                        {parseInt(fuelForm.odometerReading, 10).toLocaleString()} km
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="flex gap-3">
                    <input
                      ref={odometerCameraRef}
                      type="file"
                      accept="image/*"
                      capture="environment"
                      className="absolute opacity-0 w-0 h-0"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) handleOdometerScan(file);
                        e.target.value = '';
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => odometerCameraRef.current?.click()}
                      className="flex-1 py-3 bg-blue-50 dark:bg-blue-900/20 hover:bg-blue-100 dark:hover:bg-blue-900/30 text-blue-700 dark:text-blue-400 rounded-lg font-medium flex items-center justify-center gap-2 cursor-pointer transition-colors"
                    >
                      <Camera className="w-5 h-5" />
                      Camera
                    </button>
                    <input
                      ref={odometerUploadRef}
                      type="file"
                      accept="image/*"
                      className="absolute opacity-0 w-0 h-0"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) handleOdometerScan(file);
                        e.target.value = '';
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => odometerUploadRef.current?.click()}
                      className="flex-1 py-3 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 rounded-lg font-medium flex items-center justify-center gap-2 cursor-pointer transition-colors"
                    >
                      <Upload className="w-5 h-5" />
                      Upload
                    </button>
                  </div>
                )}
              </div>

              {/* Form fields */}
              <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg p-5 space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Date *
                  </label>
                  <input
                    type="date"
                    value={fuelForm.transactionDate}
                    onChange={(e) =>
                      setFuelForm({ ...fuelForm, transactionDate: e.target.value })
                    }
                    className="w-full px-4 py-3 border rounded-lg bg-gray-50 dark:bg-gray-900 dark:border-gray-700"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Amount (R) *
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      placeholder="850.50"
                      value={fuelForm.amountRand}
                      onChange={(e) =>
                        setFuelForm({ ...fuelForm, amountRand: e.target.value })
                      }
                      className="w-full px-4 py-3 border rounded-lg bg-gray-50 dark:bg-gray-900 dark:border-gray-700"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Litres *
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      placeholder="45.25"
                      value={fuelForm.litres}
                      onChange={(e) =>
                        setFuelForm({ ...fuelForm, litres: e.target.value })
                      }
                      className="w-full px-4 py-3 border rounded-lg bg-gray-50 dark:bg-gray-900 dark:border-gray-700"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Price/L
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      placeholder="18.79"
                      value={fuelForm.pricePerLitre}
                      onChange={(e) =>
                        setFuelForm({ ...fuelForm, pricePerLitre: e.target.value })
                      }
                      className="w-full px-4 py-3 border rounded-lg bg-gray-50 dark:bg-gray-900 dark:border-gray-700"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Odometer (km)
                    </label>
                    <input
                      type="number"
                      placeholder="125000"
                      value={fuelForm.odometerReading}
                      onChange={(e) =>
                        setFuelForm({ ...fuelForm, odometerReading: e.target.value })
                      }
                      className="w-full px-4 py-3 border rounded-lg bg-gray-50 dark:bg-gray-900 dark:border-gray-700"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Station Name
                  </label>
                  <input
                    type="text"
                    placeholder="Shell, BP, Engen..."
                    value={fuelForm.stationName}
                    onChange={(e) =>
                      setFuelForm({ ...fuelForm, stationName: e.target.value })
                    }
                    className="w-full px-4 py-3 border rounded-lg bg-gray-50 dark:bg-gray-900 dark:border-gray-700"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Tank Level After (%)
                  </label>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    placeholder="100"
                    value={fuelForm.fuelLevelAfter}
                    onChange={(e) =>
                      setFuelForm({ ...fuelForm, fuelLevelAfter: e.target.value })
                    }
                    className="w-full px-4 py-3 border rounded-lg bg-gray-50 dark:bg-gray-900 dark:border-gray-700"
                  />
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                    Optional - Updates the fuel gauge reading
                  </p>
                </div>
              </div>

              {/* Receipt required warning */}
              {!receiptPhotoFile && (
                <div className="p-4 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl flex items-start gap-3">
                  <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
                  <p className="text-sm text-amber-700 dark:text-amber-300">
                    Receipt photo is required. Please scan or upload your fuel receipt above.
                  </p>
                </div>
              )}

              {/* Submit button */}
              <button
                onClick={handleFuelSubmit}
                disabled={submitting || !receiptPhotoFile}
                className="w-full py-4 bg-green-600 hover:bg-green-700 text-white rounded-xl font-semibold flex items-center justify-center gap-3 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-lg"
              >
                {submitting ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    Saving...
                  </>
                ) : (
                  <>
                    <Save className="w-5 h-5" />
                    Save Fuel Transaction
                  </>
                )}
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

// No layout - full-screen mobile interface
VehiclePortalPage.getLayout = (page: React.ReactElement) => page;
