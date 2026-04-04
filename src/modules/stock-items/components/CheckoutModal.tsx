/**
 * CheckoutModal - Check out a serial unit to a project/job site
 *
 * Supports:
 * - Barcode scan to find the asset/serial
 * - Manual serial selection from dropdown
 * - Condition photos at checkout
 */

import { useState, useEffect, useCallback } from 'react';
import { X, AlertCircle, Calendar, MapPin, ScanLine } from 'lucide-react';
import { InlineSpinner } from '@/components/ui/LoadingSpinner';
import { Button } from '@/components/ui/button';
import { BarcodeScannerModal } from '@/modules/barcode-scanner';
import { ConditionPhotoCapture, type CapturedPhoto } from '@/modules/assets/components/ConditionPhotoCapture';
import type { Asset } from '@/modules/assets/types/asset';
import { log } from '@/lib/logger';

interface Serial {
  id: string;
  serial_number: string;
  status: string;
}

/** Minimal project option for checkout dropdown selection */
interface ProjectOption {
  id: string;
  name: string;
}

interface CheckoutModalProps {
  stockItemId: string;
  stockItemName: string;
  serials: Serial[];
  onClose: () => void;
  onSuccess: () => void;
}

export function CheckoutModal({ stockItemId, stockItemName, serials, onClose, onSuccess }: CheckoutModalProps) {
  const availableSerials = serials.filter(s => s.status === 'available');
  const [selectedSerialId, setSelectedSerialId] = useState(availableSerials[0]?.id || '');
  const [projectId, setProjectId] = useState('');
  const [jobSiteName, setJobSiteName] = useState('');
  const [expectedReturnDate, setExpectedReturnDate] = useState('');
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [projectSearch, setProjectSearch] = useState('');
  const [conditionPhotos, setConditionPhotos] = useState<CapturedPhoto[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scannerOpen, setScannerOpen] = useState(false);

  // Fetch projects for picker
  useEffect(() => {
    async function fetchProjects() {
      try {
        const res = await fetch('/api/projects?limit=200');
        const data = await res.json();
        if (data.data) {
          setProjects(data.data.map((p: Record<string, unknown>) => ({ id: p.id, name: p.name })));
        }
      } catch (err) {
        log.error('Failed to fetch projects', { error: err }, 'CheckoutModal');
      }
    }
    fetchProjects();
  }, []);

  // Set default return date to 7 days from now
  useEffect(() => {
    const d = new Date();
    d.setDate(d.getDate() + 7);
    setExpectedReturnDate(d.toISOString().split('T')[0]);
  }, []);

  const filteredProjects = projects.filter(p =>
    p.name.toLowerCase().includes(projectSearch.toLowerCase())
  );

  // Handle barcode scan — match to available serial
  const handleAssetFound = useCallback((asset: Asset) => {
    setScannerOpen(false);

    // Try to match scanned asset to one of the available serials
    const match = availableSerials.find(
      s => s.serial_number === asset.serialNumber
        || s.serial_number === asset.barcode
        || s.serial_number === asset.assetNumber
    );

    if (match) {
      setSelectedSerialId(match.id);
      setError(null);
    } else {
      setError(`Scanned asset "${asset.name}" (${asset.assetNumber}) does not match any available serial for this item.`);
    }
  }, [availableSerials]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!selectedSerialId) {
      setError('Please select a serial unit');
      return;
    }
    if (!expectedReturnDate) {
      setError('Please set an expected return date');
      return;
    }
    if (!projectId && !jobSiteName) {
      setError('Please select a project or enter a job site name');
      return;
    }
    if (conditionPhotos.some(p => p.uploading)) {
      setError('Please wait for photos to finish uploading');
      return;
    }

    setIsSubmitting(true);

    const photoUrls = conditionPhotos
      .map(p => p.storageUrl)
      .filter((url): url is string => !!url);

    try {
      const res = await fetch('/api/stock/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          serialId: selectedSerialId,
          projectId: projectId || null,
          jobSiteName: jobSiteName || null,
          expectedReturnDate,
          conditionPhotoUrls: photoUrls.length > 0 ? photoUrls : undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to check out');
      }

      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to check out');
    } finally {
      setIsSubmitting(false);
    }
  };

  const minDate = new Date();
  minDate.setDate(minDate.getDate() + 1);

  return (
    <>
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4">
        <div className="bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)] w-full max-w-md max-h-[90vh] flex flex-col">
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--ff-border-light)]">
            <h3 className="text-lg font-semibold text-[var(--ff-text-primary)]">Check Out Tool</h3>
            <Button type="button" variant="ghost" size="icon" onClick={onClose} aria-label="Close">
              <X className="h-5 w-5" />
            </Button>
          </div>

          <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-5 space-y-4">
            {/* Item name */}
            <div className="p-3 bg-[var(--ff-bg-tertiary)] rounded-lg">
              <p className="text-xs text-[var(--ff-text-tertiary)]">Item</p>
              <p className="text-sm font-medium text-[var(--ff-text-primary)]">{stockItemName}</p>
            </div>

            {error && (
              <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg flex items-start gap-2">
                <AlertCircle className="h-4 w-4 text-red-400 mt-0.5 flex-shrink-0" />
                <p className="text-sm text-red-400">{error}</p>
              </div>
            )}

            {/* Serial picker with scan option */}
            <div>
              <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
                Serial Unit *
              </label>
              {availableSerials.length === 0 ? (
                <p className="text-sm text-amber-400">No available serials. Add one first.</p>
              ) : (
                <div className="flex gap-2">
                  <select
                    value={selectedSerialId}
                    onChange={(e) => setSelectedSerialId(e.target.value)}
                    className="flex-1 px-3 py-2 border border-[var(--ff-border-light)] bg-[var(--ff-bg-tertiary)] rounded-lg text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    {availableSerials.map(s => (
                      <option key={s.id} value={s.id}>{s.serial_number}</option>
                    ))}
                  </select>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => setScannerOpen(true)}
                    title="Scan barcode to select serial"
                  >
                    <ScanLine className="h-4 w-4 text-purple-400" />
                  </Button>
                </div>
              )}
            </div>

            {/* Project picker */}
            <div>
              <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
                <MapPin className="h-3.5 w-3.5 inline mr-1" />
                Project
              </label>
              <input
                type="text"
                value={projectSearch}
                onChange={(e) => {
                  setProjectSearch(e.target.value);
                  if (!e.target.value) setProjectId('');
                }}
                placeholder="Search projects..."
                className="w-full px-3 py-2 border border-[var(--ff-border-light)] bg-[var(--ff-bg-tertiary)] rounded-lg text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              {projectSearch && !projectId && filteredProjects.length > 0 && (
                <div className="mt-1 max-h-32 overflow-y-auto bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg">
                  {filteredProjects.slice(0, 8).map(p => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => {
                        setProjectId(p.id);
                        setProjectSearch(p.name);
                        setJobSiteName('');
                      }}
                      className="w-full px-3 py-2 text-left text-sm hover:bg-[var(--ff-bg-hover)] text-[var(--ff-text-primary)]"
                    >
                      {p.name}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Job site fallback */}
            {!projectId && (
              <div>
                <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
                  Or Job Site Name
                </label>
                <input
                  type="text"
                  value={jobSiteName}
                  onChange={(e) => setJobSiteName(e.target.value)}
                  placeholder="Enter job site name"
                  className="w-full px-3 py-2 border border-[var(--ff-border-light)] bg-[var(--ff-bg-tertiary)] rounded-lg text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            )}

            {/* Return date */}
            <div>
              <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
                <Calendar className="h-3.5 w-3.5 inline mr-1" />
                Expected Return Date *
              </label>
              <input
                type="date"
                value={expectedReturnDate}
                onChange={(e) => setExpectedReturnDate(e.target.value)}
                min={minDate.toISOString().split('T')[0]}
                required
                className="w-full px-3 py-2 border border-[var(--ff-border-light)] bg-[var(--ff-bg-tertiary)] rounded-lg text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            {/* Condition Photos */}
            <ConditionPhotoCapture
              photos={conditionPhotos}
              onChange={setConditionPhotos}
              storageCategory="checkout-photos"
              maxPhotos={4}
              label="Condition at Checkout"
              helperText="Photograph the equipment before handing it over"
            />

            {/* Footer */}
            <div className="flex justify-end gap-3 pt-2">
              <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
              <Button
                type="submit"
                disabled={isSubmitting || availableSerials.length === 0 || conditionPhotos.some(p => p.uploading)}
              >
                {isSubmitting && <InlineSpinner size="sm" />}
                Check Out
              </Button>
            </div>
          </form>
        </div>
      </div>

      {/* Barcode Scanner */}
      <BarcodeScannerModal
        isOpen={scannerOpen}
        onClose={() => setScannerOpen(false)}
        onAssetFound={handleAssetFound}
        title="Scan Serial Barcode"
      />
    </>
  );
}
