/**
 * Stock Portal Page
 * Mobile-first, full-screen storeman portal.
 * State-machine driven: home | checkout | consume | return | receive
 *
 * No AppLayout — uses getLayout = (page) => page pattern (same as fleet portal).
 */

import React, { useState, useId, useCallback } from 'react';
import Head from 'next/head';
import toast from 'react-hot-toast';
import {
  Package,
  ScanLine,
  RotateCcw,
  Truck,
  Camera,
  ArrowLeft,
  Loader2,
} from 'lucide-react';

import { useLocations, useFieldStockDashboard } from '@/modules/procurement/field-stock/hooks';
import { useBarcodeScanner } from '@/modules/barcode-scanner';

import { CheckoutFlow } from '@/modules/procurement/field-stock/components/portal/CheckoutFlow';
import { ConsumeFlow } from '@/modules/procurement/field-stock/components/portal/ConsumeFlow';
import { ReturnFlow } from '@/modules/procurement/field-stock/components/portal/ReturnFlow';
import { ReceiveFlow } from '@/modules/procurement/field-stock/components/portal/ReceiveFlow';
import { QuickScanSheet } from '@/modules/procurement/field-stock/components/portal/QuickScanSheet';
import type { PortalView, SerialLookupResult } from '@/modules/procurement/field-stock/components/portal/types';
import { log } from '@/lib/logger';

// ============================================================================
// Home View Action Card
// ============================================================================

interface ActionCardProps {
  icon: React.ReactNode;
  label: string;
  description: string;
  color: 'blue' | 'green' | 'orange' | 'purple';
  onClick: () => void;
}

const COLOR_MAP = {
  blue: {
    bg: 'bg-blue-50 dark:bg-blue-900/20',
    icon: 'bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400',
    border: 'border-blue-200 dark:border-blue-800 hover:border-blue-400 dark:hover:border-blue-500',
  },
  green: {
    bg: 'bg-green-50 dark:bg-green-900/20',
    icon: 'bg-green-100 dark:bg-green-900/40 text-green-600 dark:text-green-400',
    border: 'border-green-200 dark:border-green-800 hover:border-green-400 dark:hover:border-green-500',
  },
  orange: {
    bg: 'bg-orange-50 dark:bg-orange-900/20',
    icon: 'bg-orange-100 dark:bg-orange-900/40 text-orange-600 dark:text-orange-400',
    border: 'border-orange-200 dark:border-orange-800 hover:border-orange-400 dark:hover:border-orange-500',
  },
  purple: {
    bg: 'bg-purple-50 dark:bg-purple-900/20',
    icon: 'bg-purple-100 dark:bg-purple-900/40 text-purple-600 dark:text-purple-400',
    border: 'border-purple-200 dark:border-purple-800 hover:border-purple-400 dark:hover:border-purple-500',
  },
};

function ActionCard({ icon, label, description, color, onClick }: ActionCardProps) {
  const c = COLOR_MAP[color];
  return (
    <button
      onClick={onClick}
      className={`flex flex-col gap-3 p-4 rounded-2xl border-2 bg-white dark:bg-gray-800 ${c.border} transition-all active:scale-95 shadow-sm`}
    >
      <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${c.icon}`}>
        {icon}
      </div>
      <div className="text-left">
        <p className="font-bold text-gray-900 dark:text-white text-base leading-tight">{label}</p>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 leading-snug">{description}</p>
      </div>
    </button>
  );
}

// ============================================================================
// Stat Chip
// ============================================================================

function StatChip({
  value,
  label,
  loading,
}: {
  value: number | string;
  label: string;
  loading: boolean;
}) {
  return (
    <div className="flex-1 bg-white dark:bg-gray-800 rounded-xl px-3 py-3 text-center shadow-sm">
      {loading ? (
        <Loader2 className="w-4 h-4 animate-spin text-gray-400 mx-auto mb-1" />
      ) : (
        <p className="text-xl font-bold text-gray-900 dark:text-white">{value}</p>
      )}
      <p className="text-xs text-gray-500 dark:text-gray-400 leading-tight">{label}</p>
    </div>
  );
}

// ============================================================================
// Home View
// ============================================================================

interface HomeViewProps {
  onNavigate: (view: PortalView) => void;
}

function HomeView({ onNavigate }: HomeViewProps) {
  const { summary, loading: dashLoading } = useFieldStockDashboard();

  return (
    <div className="space-y-6 pb-24">
      {/* Greeting */}
      <div>
        <h2 className="text-2xl font-bold text-gray-900 dark:text-white">What would you like to do?</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Tap an action below</p>
      </div>

      {/* 2x2 Action Grid */}
      <div className="grid grid-cols-2 gap-3">
        <ActionCard
          icon={<Package className="w-6 h-6" />}
          label="Issue Stock"
          description="Issue items to technician"
          color="blue"
          onClick={() => onNavigate('checkout')}
        />
        <ActionCard
          icon={<ScanLine className="w-6 h-6" />}
          label="Scan & Install"
          description="Record serial against DR"
          color="green"
          onClick={() => onNavigate('consume')}
        />
        <ActionCard
          icon={<RotateCcw className="w-6 h-6" />}
          label="Process Return"
          description="Receive stock from field"
          color="orange"
          onClick={() => onNavigate('return')}
        />
        <ActionCard
          icon={<Truck className="w-6 h-6" />}
          label="Receive Delivery"
          description="GRN with batch scanning"
          color="purple"
          onClick={() => onNavigate('receive')}
        />
      </div>

      {/* Today's Summary */}
      <div>
        <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">
          Today&apos;s Summary
        </p>
        <div className="flex gap-2">
          <StatChip
            value={summary?.consumptions.today ?? 0}
            label="Consumed today"
            loading={dashLoading}
          />
          <StatChip
            value={summary?.alerts.pendingReturns ?? 0}
            label="Pending returns"
            loading={dashLoading}
          />
          <StatChip
            value={summary?.serials.total ?? 0}
            label="Serials tracked"
            loading={dashLoading}
          />
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Main Page
// ============================================================================

export default function StockPortalPage() {
  const [view, setView] = useState<PortalView>('home');

  // Quick-scan FAB state
  const quickScanId = useId();
  const fabElementId = `fab-scanner-${quickScanId.replace(/:/g, '')}`;
  const [fabActive, setFabActive] = useState(false);
  const [quickScanCode, setQuickScanCode] = useState('');
  const [quickLookupResult, setQuickLookupResult] = useState<SerialLookupResult | null>(null);
  const [quickLookupLoading, setQuickLookupLoading] = useState(false);

  // Consume flow initial values (set when navigating from quick-scan)
  const [consumeInitialDr, setConsumeInitialDr] = useState<string | undefined>();
  const [consumeInitialSerial, setConsumeInitialSerial] = useState<string | undefined>();

  // Hooks for technician list
  const {
    locations: technicians,
    loading: techLoading,
  } = useLocations({
    filters: { locationType: 'technician', isActive: true },
    autoFetch: true,
  });

  // Quick-scan: look up the scanned code
  const performQuickLookup = useCallback(async (code: string) => {
    setQuickScanCode(code);
    setQuickLookupResult(null);
    setQuickLookupLoading(true);
    setFabActive(true);

    try {
      const res = await fetch(
        `/api/procurement/field-stock/serials?search=${encodeURIComponent(code)}`
      );
      const data = await res.json();

      const items = data.data?.items ?? data.data ?? [];
      const match = Array.isArray(items) ? items[0] : null;

      if (match) {
        setQuickLookupResult({
          found: true,
          serialId: match.id,
          serialNumber: match.serialNumber,
          stockItemId: match.stockItemId,
          itemName: match.itemName ?? match.stockItem?.name,
          itemCode: match.itemCode ?? match.stockItem?.itemCode,
          status: match.status,
          locationName: match.locationName ?? match.currentLocation?.name,
        });
      } else {
        setQuickLookupResult({ found: false, error: `No record for "${code}"` });
      }
    } catch (err) {
      log.error('Quick scan lookup failed', { error: err }, 'StockPortal');
      setQuickLookupResult({ found: false, error: 'Lookup failed' });
    } finally {
      setQuickLookupLoading(false);
    }
  }, []);

  // FAB scanner hook — stop/state used; start available for future inline FAB scanning
  const { stop: stopFab, state: fabScannerState } = useBarcodeScanner({
    elementId: fabElementId,
    onScan: (result) => {
      stopFab();
      performQuickLookup(result.decodedText);
    },
  });

  const handleFabPress = async () => {
    // Start scan — open a native camera-based input for one-shot scan
    if (fabScannerState === 'scanning') {
      stopFab();
      return;
    }
    // Use a hidden file input approach for simplicity on mobile
    // (same pattern as fleet portal receipt scan)
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.capture = 'environment';
    input.style.display = 'none';
    document.body.appendChild(input);
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      document.body.removeChild(input);
      if (!file) return;

      // For now, alert that camera-based barcode reading requires the inline scanner
      // The FAB triggers a quick-scan using the useBarcodeScanner hook
      toast('Use the inline scanner in each flow for best results', { icon: 'ℹ️' });
    };
    input.click();
  };

  const handleSheetClose = () => {
    setFabActive(false);
    setQuickScanCode('');
    setQuickLookupResult(null);
  };

  const handleSheetConsume = () => {
    handleSheetClose();
    setConsumeInitialSerial(quickScanCode);
    setConsumeInitialDr(undefined);
    setView('consume');
  };

  const handleSheetNavigateConsume = (drNumber?: string) => {
    handleSheetClose();
    setConsumeInitialDr(drNumber);
    setConsumeInitialSerial(undefined);
    setView('consume');
  };

  const handleDone = () => {
    setConsumeInitialDr(undefined);
    setConsumeInitialSerial(undefined);
    setView('home');
  };

  const handleBack = () => {
    setConsumeInitialDr(undefined);
    setConsumeInitialSerial(undefined);
    setView('home');
  };

  return (
    <>
      <Head>
        <title>Stock Portal | FibreFlow</title>
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover"
        />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />
      </Head>

      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50 dark:from-gray-900 dark:to-gray-800 pb-[env(safe-area-inset-bottom)]">

        {/* ---- Sticky Header ---- */}
        <header className="sticky top-0 z-30 bg-white dark:bg-gray-800 shadow-sm">
          <div className="max-w-lg mx-auto px-4 py-3 flex items-center gap-3">
            {view !== 'home' && (
              <button
                onClick={handleBack}
                className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors flex-shrink-0"
                aria-label="Go back"
              >
                <ArrowLeft className="w-5 h-5 text-gray-600 dark:text-gray-400" />
              </button>
            )}

            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-blue-600 flex items-center justify-center flex-shrink-0">
                  <Package className="w-4 h-4 text-white" />
                </div>
                <div>
                  <span className="font-bold text-gray-900 dark:text-white text-base leading-none">
                    FibreFlow
                  </span>
                  <span className="text-blue-600 dark:text-blue-400 font-medium text-base ml-1 leading-none">
                    Stock
                  </span>
                </div>
              </div>
            </div>

            <span className="text-xs text-gray-400 dark:text-gray-500 flex-shrink-0">
              Storeman Portal
            </span>
          </div>
        </header>

        {/* ---- Scrollable Content ---- */}
        <main className="max-w-lg mx-auto px-4 py-5">
          {view === 'home' && (
            <HomeView
              onNavigate={setView}
            />
          )}

          {view === 'checkout' && (
            <CheckoutFlow
              technicians={technicians}
              techLoading={techLoading}
              onBack={handleBack}
              onDone={handleDone}
            />
          )}

          {view === 'consume' && (
            <ConsumeFlow
              initialDrNumber={consumeInitialDr}
              initialSerial={consumeInitialSerial}
              onBack={handleBack}
              onDone={handleDone}
            />
          )}

          {view === 'return' && (
            <ReturnFlow
              technicians={technicians}
              techLoading={techLoading}
              onBack={handleBack}
              onDone={handleDone}
            />
          )}

          {view === 'receive' && (
            <ReceiveFlow
              onBack={handleBack}
              onDone={handleDone}
            />
          )}
        </main>

        {/* ---- FAB: Quick Scan (home view only) ---- */}
        {view === 'home' && (
          <button
            onClick={handleFabPress}
            className="fixed bottom-6 right-4 w-16 h-16 bg-blue-600 hover:bg-blue-700 active:scale-95 text-white rounded-full shadow-xl flex items-center justify-center transition-all z-20"
            style={{ bottom: 'calc(1.5rem + env(safe-area-inset-bottom))' }}
            aria-label="Quick scan"
          >
            <Camera className="w-7 h-7" />
          </button>
        )}

        {/* ---- Quick Scan Bottom Sheet ---- */}
        <QuickScanSheet
          isOpen={fabActive}
          scannedCode={quickScanCode}
          lookupResult={quickLookupResult}
          loading={quickLookupLoading}
          onClose={handleSheetClose}
          onConsume={handleSheetConsume}
          onNavigateToConsume={handleSheetNavigateConsume}
        />

        {/* Hidden FAB scanner mount (only used if we upgrade to inline scanning) */}
        <div id={fabElementId} className="hidden" aria-hidden="true" />
      </div>
    </>
  );
}

// No AppLayout — full-screen mobile interface (same pattern as fleet portal)
StockPortalPage.getLayout = (page: React.ReactElement) => page;
