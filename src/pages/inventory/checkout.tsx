/**
 * Asset Checkout/Checkin Page
 *
 * Manage asset assignments - check out and check in equipment.
 */

import { useState, useCallback, useEffect } from 'react';
import { useRouter } from 'next/router';
import { notificationService } from '@/services/core/NotificationService';
import {
  Package,
  ArrowRight,
  ArrowLeft,
  Search,
  User,
  Briefcase,
  Truck,
  Warehouse,
  AlertTriangle,
  CheckCircle,
  Clock,
} from 'lucide-react';
import { AppLayout } from '@/components/layout/AppLayout';
import {
  useAssets,
  useAsset,
  useAssetSearch,
  useCheckoutAsset,
  useCheckinAsset,
} from '@/modules/assets/hooks';
import type { Asset } from '@/modules/assets/types/asset';

const CONDITION_OPTIONS = [
  { value: 'new', label: 'New' },
  { value: 'excellent', label: 'Excellent' },
  { value: 'good', label: 'Good' },
  { value: 'fair', label: 'Fair' },
  { value: 'poor', label: 'Poor' },
  { value: 'damaged', label: 'Damaged' },
];

const ASSIGNEE_TYPES = [
  { value: 'staff', label: 'Staff Member', icon: User },
  { value: 'project', label: 'Project', icon: Briefcase },
  { value: 'vehicle', label: 'Vehicle', icon: Truck },
  { value: 'warehouse', label: 'Warehouse', icon: Warehouse },
];

export default function CheckoutPage() {
  const router = useRouter();
  const { assetId: queryAssetId } = router.query;

  const [mode, setMode] = useState<'checkout' | 'checkin'>('checkout');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedAsset, setSelectedAsset] = useState<Asset | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Checkout form
  const [checkoutForm, setCheckoutForm] = useState({
    toType: 'staff' as 'staff' | 'project' | 'vehicle' | 'warehouse',
    toId: '',
    toName: '',
    toLocation: '',
    projectId: '',
    projectName: '',
    expectedReturnDate: '',
    conditionAtCheckout: 'good',
    purpose: '',
    checkoutNotes: '',
  });

  // Checkin form
  const [checkinForm, setCheckinForm] = useState({
    conditionAtCheckin: 'good',
    checkinNotes: '',
    newLocation: '',
    maintenanceRequired: false,
  });

  const { data: searchResults, isLoading: isSearching } = useAssetSearch(searchTerm, {
    enabled: searchTerm.length >= 2,
  });

  const { data: assetFromQuery } = useAsset(queryAssetId as string, {
    enabled: !!queryAssetId,
  });

  const { data: assignedAssets } = useAssets({
    status: ['assigned'],
    limit: 100,
  });

  const checkoutMutation = useCheckoutAsset();
  const checkinMutation = useCheckinAsset();

  // Set asset from query param
  useEffect(() => {
    if (assetFromQuery) {
      setSelectedAsset(assetFromQuery);
      setMode(assetFromQuery.status === 'assigned' ? 'checkin' : 'checkout');
    }
  }, [assetFromQuery]);

  const handleSearch = useCallback((e: React.FormEvent) => {
    e.preventDefault();
  }, []);

  const handleSelectAsset = useCallback((asset: Asset) => {
    setSelectedAsset(asset);
    setSearchTerm('');
    setMode(asset.status === 'assigned' ? 'checkin' : 'checkout');
  }, []);

  const handleCheckout = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedAsset) return;

    setIsSubmitting(true);
    try {
      await checkoutMutation.mutateAsync({
        assetId: selectedAsset.id,
        data: {
          toType: checkoutForm.toType,
          toId: checkoutForm.toId || `${checkoutForm.toType}-${Date.now()}`,
          toName: checkoutForm.toName,
          toLocation: checkoutForm.toLocation || undefined,
          projectId: checkoutForm.projectId || undefined,
          projectName: checkoutForm.projectName || undefined,
          expectedReturnDate: checkoutForm.expectedReturnDate || undefined,
          conditionAtCheckout: checkoutForm.conditionAtCheckout,
          purpose: checkoutForm.purpose || undefined,
          checkoutNotes: checkoutForm.checkoutNotes || undefined,
        },
      });
      setSelectedAsset(null);
      setCheckoutForm({
        toType: 'staff',
        toId: '',
        toName: '',
        toLocation: '',
        projectId: '',
        projectName: '',
        expectedReturnDate: '',
        conditionAtCheckout: 'good',
        purpose: '',
        checkoutNotes: '',
      });
      notificationService.success('Asset checked out successfully');
    } catch (err) {
      notificationService.error(err instanceof Error ? err.message : 'Checkout failed');
    } finally {
      setIsSubmitting(false);
    }
  }, [selectedAsset, checkoutForm, checkoutMutation]);

  const handleCheckin = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedAsset) return;

    setIsSubmitting(true);
    try {
      await checkinMutation.mutateAsync({
        assetId: selectedAsset.id,
        data: {
          conditionAtCheckin: checkinForm.conditionAtCheckin,
          checkinNotes: checkinForm.checkinNotes || undefined,
          newLocation: checkinForm.newLocation || undefined,
          maintenanceRequired: checkinForm.maintenanceRequired,
        },
      });
      setSelectedAsset(null);
      setCheckinForm({
        conditionAtCheckin: 'good',
        checkinNotes: '',
        newLocation: '',
        maintenanceRequired: false,
      });
      notificationService.success('Asset checked in successfully');
    } catch (err) {
      notificationService.error(err instanceof Error ? err.message : 'Checkin failed');
    } finally {
      setIsSubmitting(false);
    }
  }, [selectedAsset, checkinForm, checkinMutation]);

  const currentlyAssigned = assignedAssets?.data ?? [];

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Check Out / In</h1>
          <p className="text-gray-600 mt-1">
            Assign assets to staff, projects, or vehicles
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setMode('checkout')}
            className={`inline-flex items-center px-4 py-2 text-sm font-medium rounded-lg ${
              mode === 'checkout'
                ? 'text-white bg-blue-600'
                : 'text-gray-700 bg-white border border-gray-300 hover:bg-gray-50'
            }`}
          >
            <ArrowRight className="h-4 w-4 mr-2" />
            Check Out
          </button>
          <button
            onClick={() => setMode('checkin')}
            className={`inline-flex items-center px-4 py-2 text-sm font-medium rounded-lg ${
              mode === 'checkin'
                ? 'text-white bg-green-600'
                : 'text-gray-700 bg-white border border-gray-300 hover:bg-gray-50'
            }`}
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            Check In
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Asset Search / Selection */}
        <div className="lg:col-span-1 space-y-4">
          <div className="bg-white rounded-lg border border-gray-200 p-4">
            <h3 className="font-semibold text-gray-900 mb-4">
              {mode === 'checkout' ? 'Select Asset to Check Out' : 'Select Asset to Check In'}
            </h3>

            <form onSubmit={handleSearch} className="mb-4">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                <input
                  type="text"
                  placeholder="Search by name, asset number..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </form>

            {/* Search Results */}
            {searchTerm.length >= 2 && (
              <div className="border border-gray-200 rounded-lg max-h-60 overflow-y-auto">
                {isSearching && (
                  <div className="p-4 text-center text-gray-500">Searching...</div>
                )}
                {!isSearching && searchResults?.length === 0 && (
                  <div className="p-4 text-center text-gray-500">No assets found</div>
                )}
                {searchResults?.map((asset) => (
                  <button
                    key={asset.id}
                    onClick={() => handleSelectAsset(asset)}
                    disabled={mode === 'checkout' && asset.status !== 'available'}
                    className="w-full p-3 text-left hover:bg-gray-50 border-b border-gray-100 last:border-b-0 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-medium text-gray-900">{asset.name}</p>
                        <p className="text-sm text-gray-500">{asset.assetNumber}</p>
                      </div>
                      <span className={`text-xs px-2 py-1 rounded ${
                        asset.status === 'available'
                          ? 'bg-green-100 text-green-700'
                          : 'bg-blue-100 text-blue-700'
                      }`}>
                        {asset.status}
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            )}

            {/* Currently Assigned Assets (for check-in) */}
            {mode === 'checkin' && !searchTerm && (
              <div>
                <p className="text-sm text-gray-600 mb-2">Currently assigned assets:</p>
                <div className="border border-gray-200 rounded-lg max-h-60 overflow-y-auto">
                  {currentlyAssigned.length === 0 && (
                    <div className="p-4 text-center text-gray-500">No assigned assets</div>
                  )}
                  {currentlyAssigned.map((asset) => (
                    <button
                      key={asset.id}
                      onClick={() => handleSelectAsset(asset)}
                      className="w-full p-3 text-left hover:bg-gray-50 border-b border-gray-100 last:border-b-0"
                    >
                      <div>
                        <p className="font-medium text-gray-900">{asset.name}</p>
                        <p className="text-sm text-gray-500">
                          {asset.currentAssigneeName || 'Unknown assignee'}
                        </p>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Selected Asset */}
          {selectedAsset && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <div className="flex items-center gap-3">
                <Package className="h-8 w-8 text-blue-600" />
                <div>
                  <p className="font-semibold text-gray-900">{selectedAsset.name}</p>
                  <p className="text-sm text-gray-600">{selectedAsset.assetNumber}</p>
                  {selectedAsset.currentAssigneeName && (
                    <p className="text-sm text-blue-600">
                      Assigned to: {selectedAsset.currentAssigneeName}
                    </p>
                  )}
                </div>
              </div>
              <button
                onClick={() => setSelectedAsset(null)}
                className="mt-2 text-sm text-blue-600 hover:text-blue-800"
              >
                Clear selection
              </button>
            </div>
          )}
        </div>

        {/* Checkout / Checkin Form */}
        <div className="lg:col-span-2">
          {!selectedAsset ? (
            <div className="bg-white rounded-lg border border-gray-200 p-8 text-center">
              <Package className="h-12 w-12 text-gray-400 mx-auto mb-4" />
              <p className="text-gray-600">
                Select an asset to {mode === 'checkout' ? 'check out' : 'check in'}
              </p>
            </div>
          ) : mode === 'checkout' && selectedAsset.status === 'available' ? (
            <form onSubmit={handleCheckout} className="bg-white rounded-lg border border-gray-200">
              <div className="p-4 border-b border-gray-200">
                <h3 className="font-semibold text-gray-900">Check Out Details</h3>
              </div>
              <div className="p-6 space-y-4">
                {/* Assignee Type */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Assign To *
                  </label>
                  <div className="grid grid-cols-4 gap-2">
                    {ASSIGNEE_TYPES.map((type) => {
                      const Icon = type.icon;
                      return (
                        <button
                          key={type.value}
                          type="button"
                          onClick={() => setCheckoutForm({ ...checkoutForm, toType: type.value as typeof checkoutForm.toType })}
                          className={`p-3 border rounded-lg text-center ${
                            checkoutForm.toType === type.value
                              ? 'border-blue-500 bg-blue-50 text-blue-700'
                              : 'border-gray-200 hover:border-gray-300'
                          }`}
                        >
                          <Icon className="h-5 w-5 mx-auto mb-1" />
                          <span className="text-xs">{type.label}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Assignee Name */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    {checkoutForm.toType === 'staff' ? 'Staff Name' :
                     checkoutForm.toType === 'project' ? 'Project Name' :
                     checkoutForm.toType === 'vehicle' ? 'Vehicle Name' : 'Warehouse Name'} *
                  </label>
                  <input
                    type="text"
                    value={checkoutForm.toName}
                    onChange={(e) => setCheckoutForm({ ...checkoutForm, toName: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                    required
                  />
                </div>

                {/* Location */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Location
                  </label>
                  <input
                    type="text"
                    value={checkoutForm.toLocation}
                    onChange={(e) => setCheckoutForm({ ...checkoutForm, toLocation: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                {/* Expected Return Date */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Expected Return Date
                  </label>
                  <input
                    type="date"
                    value={checkoutForm.expectedReturnDate}
                    onChange={(e) => setCheckoutForm({ ...checkoutForm, expectedReturnDate: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                    min={new Date().toISOString().split('T')[0]}
                  />
                </div>

                {/* Condition */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Condition at Checkout *
                  </label>
                  <select
                    value={checkoutForm.conditionAtCheckout}
                    onChange={(e) => setCheckoutForm({ ...checkoutForm, conditionAtCheckout: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                    required
                  >
                    {CONDITION_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                </div>

                {/* Purpose */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Purpose
                  </label>
                  <input
                    type="text"
                    value={checkoutForm.purpose}
                    onChange={(e) => setCheckoutForm({ ...checkoutForm, purpose: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                    placeholder="e.g., Field work, Project installation"
                  />
                </div>

                {/* Notes */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Notes
                  </label>
                  <textarea
                    value={checkoutForm.checkoutNotes}
                    onChange={(e) => setCheckoutForm({ ...checkoutForm, checkoutNotes: e.target.value })}
                    rows={2}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>
              <div className="p-4 border-t border-gray-200 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setSelectedAsset(null)}
                  className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting || !checkoutForm.toName}
                  className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
                >
                  {isSubmitting ? 'Processing...' : 'Check Out'}
                </button>
              </div>
            </form>
          ) : mode === 'checkin' && selectedAsset.status === 'assigned' ? (
            <form onSubmit={handleCheckin} className="bg-white rounded-lg border border-gray-200">
              <div className="p-4 border-b border-gray-200">
                <h3 className="font-semibold text-gray-900">Check In Details</h3>
              </div>
              <div className="p-6 space-y-4">
                {/* Condition */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Condition at Check In *
                  </label>
                  <select
                    value={checkinForm.conditionAtCheckin}
                    onChange={(e) => setCheckinForm({ ...checkinForm, conditionAtCheckin: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                    required
                  >
                    {CONDITION_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                </div>

                {/* New Location */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Return Location
                  </label>
                  <input
                    type="text"
                    value={checkinForm.newLocation}
                    onChange={(e) => setCheckinForm({ ...checkinForm, newLocation: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                    placeholder="e.g., Warehouse A, Tool room"
                  />
                </div>

                {/* Maintenance Required */}
                <div className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    id="maintenanceRequired"
                    checked={checkinForm.maintenanceRequired}
                    onChange={(e) => setCheckinForm({ ...checkinForm, maintenanceRequired: e.target.checked })}
                    className="h-4 w-4 text-blue-600 rounded focus:ring-blue-500"
                  />
                  <label htmlFor="maintenanceRequired" className="text-sm text-gray-700">
                    Maintenance Required
                  </label>
                </div>

                {checkinForm.maintenanceRequired && (
                  <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 flex items-start gap-2">
                    <AlertTriangle className="h-5 w-5 text-yellow-600 mt-0.5" />
                    <p className="text-sm text-yellow-800">
                      Asset will be marked as "In Maintenance" after check-in
                    </p>
                  </div>
                )}

                {/* Notes */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Notes
                  </label>
                  <textarea
                    value={checkinForm.checkinNotes}
                    onChange={(e) => setCheckinForm({ ...checkinForm, checkinNotes: e.target.value })}
                    rows={3}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                    placeholder="Any observations or issues..."
                  />
                </div>
              </div>
              <div className="p-4 border-t border-gray-200 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setSelectedAsset(null)}
                  className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-4 py-2 text-sm font-medium text-white bg-green-600 rounded-lg hover:bg-green-700 disabled:opacity-50"
                >
                  {isSubmitting ? 'Processing...' : 'Check In'}
                </button>
              </div>
            </form>
          ) : (
            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
              <div className="flex items-start gap-3">
                <AlertTriangle className="h-5 w-5 text-yellow-600 mt-0.5" />
                <div>
                  <p className="font-medium text-yellow-800">
                    Asset cannot be {mode === 'checkout' ? 'checked out' : 'checked in'}
                  </p>
                  <p className="text-sm text-yellow-700 mt-1">
                    Current status: {selectedAsset.status}
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

CheckoutPage.getLayout = (page: React.ReactElement) => (
  <AppLayout>{page}</AppLayout>
);
