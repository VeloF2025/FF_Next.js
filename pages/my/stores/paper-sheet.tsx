/**
 * /my/stores/paper-sheet — record a historical paper install sheet.
 *
 * A separate screen from the issue flow ON PURPOSE. Mislabelling a live
 * handout as a historical sheet would back-date real stock movement, so this
 * is amber, differently laid out, and reachable only from the stores hub.
 *
 * The scanner here deliberately does NOT validate. A serial on an old sheet
 * may legitimately not exist in stock at all — 43 of the 190 on the May 2026
 * sheets did not — so refusing unknown serials would reject exactly the rows
 * worth capturing. Classification happens server-side, after the scan.
 */

import { useCallback, useRef, useState } from 'react';
import type { NextPage } from 'next';
import { useRouter } from 'next/router';
import { Loader2, AlertCircle, ChevronLeft, Camera, Trash2 } from 'lucide-react';

import { MyPortalShell } from '@/modules/attendance/portal/client/MyPortalShell';
import { useStoresSession } from '@/modules/field-stock-pwa/hooks/useStoresSession';
import { useBarcodeScanner } from '@/modules/barcode-scanner/hooks/useBarcodeScanner';
import { parseScanPayload } from '@/modules/field-stock-pwa/lib/boxScan';
import { scanRegionFor } from '@/modules/field-stock-pwa/lib/scanBox';
import { PaperSheetCapture } from '@/modules/field-stock-pwa/components/PaperSheetCapture';

const SCANNER_ELEMENT_ID = 'paper-sheet-scanner';

const PaperSheetPage: NextPage = () => {
  const router = useRouter();
  const { state, profile } = useStoresSession();

  const [serials, setSerials] = useState<string[]>([]);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  // Carried between sheets in one sitting: a stack is usually one receiver and
  // one date, or a short run of days. Re-typing both per page is where wrong
  // dates come from.
  const [lastUsed, setLastUsed] = useState<{ sheetDate: string; receiverStaffId: string } | null>(null);
  const [recordedCount, setRecordedCount] = useState(0);
  // Remount key. initialDate/initialReceiverId are useState INITIALISERS, so
  // they apply on mount and never again — changing the key is what makes the
  // next sheet actually start from the carried values instead of blank.
  const [sheetSeq, setSheetSeq] = useState(0);
  // Freshest list at scan time: the camera fires per decoded frame and React
  // does not re-render between them, so reading the state variable would drop
  // every serial after the first (the 27/36 bug, 2026-08-21).
  const serialsRef = useRef<string[]>([]);

  const addSerials = useCallback((incoming: string[]) => {
    const fresh = incoming.filter((s) => !serialsRef.current.includes(s));
    if (fresh.length === 0) {
      setNotice('Already scanned');
      return;
    }
    serialsRef.current = [...serialsRef.current, ...fresh];
    setSerials(serialsRef.current);
    setNotice(null);
    if (typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate(50);
  }, []);

  const handleRaw = useCallback((raw: string) => {
    const payload = parseScanPayload(raw);
    if (payload.kind === 'box') { addSerials(payload.serials); return; }
    if (payload.kind === 'single') { addSerials([payload.serial]); return; }
    setNotice('That code is not a serial');
  }, [addSerials]);

  const { start, stop } = useBarcodeScanner({
    elementId: SCANNER_ELEMENT_ID,
    config: {
      formatsToSupport: ['DATA_MATRIX', 'QR_CODE', 'CODE_128', 'CODE_39', 'EAN_13', 'EAN_8'],
      useBarCodeDetectorIfSupported: true,
      qrboxSize: scanRegionFor,
      videoConstraints: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } },
    },
    onScan: (result) => { handleRaw(result.decodedText); },
  });

  const removeSerial = useCallback((serial: string) => {
    serialsRef.current = serialsRef.current.filter((s) => s !== serial);
    setSerials(serialsRef.current);
  }, []);

  if (state === 'loading') {
    return (
      <MyPortalShell title="Paper sheet" showFooterNav={false}>
        <div className="flex items-center justify-center pt-24 gap-2 text-sm text-neutral-400">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading…
        </div>
      </MyPortalShell>
    );
  }

  if (state !== 'authorised' || !profile) {
    if (typeof window !== 'undefined' && state === 'guest') void router.replace('/my');
    return (
      <MyPortalShell title="Paper sheet" showFooterNav={false}>
        <div className="flex flex-col items-center gap-3 pt-16 text-center">
          <AlertCircle className="w-10 h-10 text-neutral-600" aria-hidden="true" />
          <p className="text-sm text-neutral-400">
            The stores section is only available to stores staff and administrators.
          </p>
        </div>
      </MyPortalShell>
    );
  }

  return (
    <MyPortalShell title="Paper sheet" staffName={profile.name} showFooterNav={false}>
      <div className="space-y-3 pb-8">
        <button type="button" onClick={() => void router.push('/my/stores')}
          className="inline-flex items-center gap-1 text-sm text-neutral-400">
          <ChevronLeft className="w-4 h-4" /> Stores
        </button>

        {!scannerOpen ? (
          <button type="button"
            onClick={() => { setScannerOpen(true); void start(); }}
            className="w-full min-h-[48px] rounded-lg border border-neutral-700 text-neutral-200 text-sm font-medium inline-flex items-center justify-center gap-2">
            <Camera className="w-4 h-4" /> Scan the serials
          </button>
        ) : (
          <div className="rounded-lg overflow-hidden border border-neutral-700 bg-black">
            <div id={SCANNER_ELEMENT_ID} className="w-full" style={{ minHeight: '240px' }} />
            <p className="px-3 py-1.5 text-[11px] text-neutral-500 text-center">
              Keep the code inside the frame with a little space around it — filling the frame
              edge to edge stops it reading.
            </p>
            <button type="button"
              onClick={() => { void stop(); setScannerOpen(false); }}
              className="w-full py-3 text-sm text-neutral-300 border-t border-neutral-800">
              Close scanner
            </button>
          </div>
        )}

        {notice && <p className="text-xs text-amber-300 px-1">{notice}</p>}

        {serials.length > 0 && (
          <ul className="rounded-lg bg-neutral-950 border border-neutral-800 divide-y divide-neutral-800">
            {serials.map((s) => (
              <li key={s} className="px-4 py-2.5 flex items-center justify-between">
                <span className="text-sm font-mono text-neutral-200">{s}</span>
                <button type="button" onClick={() => removeSerial(s)} aria-label={`Remove ${s}`}>
                  <Trash2 className="w-4 h-4 text-neutral-500" />
                </button>
              </li>
            ))}
          </ul>
        )}

        <PaperSheetCapture
          key={sheetSeq}
          serials={serials}
          initialDate={lastUsed?.sheetDate}
          initialReceiverId={lastUsed?.receiverStaffId}
          onRecorded={(used) => {
            // Remember what this sheet used, but do NOT clear anything yet —
            // the storeman is still reading the findings.
            setLastUsed(used);
            setRecordedCount((n) => n + 1);
          }}
          onNextSheet={() => {
            // Clear the scanned list so the next page starts empty; leaving it
            // would silently merge two pages into one batch.
            serialsRef.current = [];
            setSerials([]);
            // STOP the scanner, not just hide it. useBarcodeScanner lives on
            // this PAGE, so the key-based remount of PaperSheetCapture never
            // touches it, and its only other cleanup is page unmount. Hiding
            // the div while the html5-qrcode instance runs leaves the camera
            // live against a detached DOM node. Nothing gates saving on the
            // scanner being closed, so this is reachable: scan the last
            // serial, save, tap next.
            void stop();
            setScannerOpen(false);
            setNotice(null);
            setSheetSeq((n) => n + 1);
          }}
          onBack={() => void router.push('/my/stores')}
        />

        {recordedCount > 0 && (
          <p className="text-[11px] text-neutral-500 text-center">
            {recordedCount} sheet{recordedCount === 1 ? '' : 's'} recorded in this session
          </p>
        )}
      </div>
    </MyPortalShell>
  );
};

export default PaperSheetPage;
