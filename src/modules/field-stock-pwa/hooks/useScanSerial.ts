'use client';

/**
 * useScanSerial — scan-and-validate logic for ScanSerialsStep.
 *
 * Handles:
 *  - De-dup (silent if already in list, with haptic feedback)
 *  - Optimistic pending row append
 *  - validateSerial() API call with error surfacing
 *  - Cross-check: serial's stockItemId vs expected stockItemId
 *  - Row remove helper
 */

import { useCallback, useRef, useEffect, useState } from 'react';
import { validateSerial, validateSerialBatch } from '@/modules/field-stock-pwa/api';
import { parseScanPayload, MAX_BOX_SERIALS } from '@/modules/field-stock-pwa/lib/boxScan';
import { verdictForSerial } from '@/modules/field-stock-pwa/lib/serialVerdict';
import { serialsEligibleForIntake } from '@/modules/field-stock-pwa/lib/boxScan';
import type { PwaScannedSerial } from '@/modules/field-stock-pwa/types';

interface UseScanSerialOptions {
  stockItem: { id: string; name: string };
  scanned: PwaScannedSerial[];
  onChange: (next: PwaScannedSerial[]) => void;
  /**
   * Selected source warehouse. When set, a serial registered at a different
   * location is rejected at scan time — otherwise the mismatch only surfaces
   * as a process-step failure after the technician has already signed.
   * A serial with no recorded location is allowed (missing data is not a
   * contradiction; the process-step stock check still guards quantities).
   */
  sourceLocation?: { id: string; name: string } | null;
}

export function useScanSerial({ stockItem, scanned, onChange, sourceLocation }: UseScanSerialOptions) {
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  /**
   * The freshest scanned list, readable from inside an in-flight callback.
   *
   * Validation is async, so a callback that captured `scanned` at creation is
   * working from a stale snapshot by the time its request resolves. Writing
   * `[...scanned, ...resolved]` at that point would discard anything scanned
   * during the wait — a whole second carton, silently. Every post-await write
   * therefore rebuilds from this ref, replacing rows by serial number rather
   * than appending to a remembered array.
   */
  const scannedRef = useRef(scanned);
  // Syncs the ref from the prop for changes this hook did not make. Today that
  // is only a fresh mount, because ScanSerialsStep is unmounted when the
  // storeman picks a different item (IssueOrchestrator flips flow.step in the
  // same update), so `useRef(scanned)` alone would suffice.
  //
  // INVARIANT this relies on: a live stockItem swap never happens on a mounted
  // ScanSerialsStep. If that ever changes, this effect is NOT enough — an
  // in-flight validation for the old item would merge into the new item's list,
  // because nothing stamps a resolution with the item it was scanned for.
  useEffect(() => { scannedRef.current = scanned; }, [scanned]);

  /**
   * The ONLY way this hook mutates the scanned list.
   *
   * Writes the ref synchronously as well as calling onChange, because the
   * passive effect above does not run until after the next render — and a
   * removal tap or a second resolution can land before that. Any site that
   * calls onChange directly would read a stale ref and clobber whatever
   * happened in that window, which is the bug this whole ref exists to stop.
   */
  const commit = useCallback(
    (next: PwaScannedSerial[]) => {
      scannedRef.current = next;
      onChange(next);
    },
    [onChange],
  );

  /**
   * Serials already on the list, read from the ref at CALL time.
   *
   * Must not be memoised on the `scanned` prop: the camera fires onScan for
   * every decoded frame — several per second — and React does not re-render
   * between them. A prop-derived set is still empty on frames 2..N, so every
   * frame passes the de-dup and adds another copy of the whole carton. That is
   * how one 9-serial box became 27 and 36 rows on dev (2026-08-20).
   *
   * `commit()` updates the ref synchronously, so frame 2 sees frame 1's rows.
   */
  const alreadyScanned = useCallback(
    () => new Set(scannedRef.current.map((s) => s.serialNumber.toUpperCase())),
    [],
  );

  /** Replace the given rows in the freshest list, matching on serial number. */
  const applyResolved = useCallback(
    (resolved: PwaScannedSerial[]) => {
      const byNumber = new Map(resolved.map((r) => [r.serialNumber, r]));
      // Rows no longer present were removed mid-flight and are NOT resurrected —
      // the storeman's removal wins.
      commit(scannedRef.current.map((row) => byNumber.get(row.serialNumber) ?? row));
    },
    [commit],
  );

  const [scanNotice, setScanNotice] = useState<string | null>(null);
  const clearScanNotice = useCallback(() => setScanNotice(null), []);
  const groupSeq = useRef(0);
  /** Quantity declared by the carton's ISO data code, when the storeman scanned it. */
  const declaredQuantity = useRef<number | null>(null);
  /** Carton package id (ISO 3S), when the data code was scanned. */
  const declaredPackageId = useRef<string | null>(null);

  const vibrate = (ms: number) => {
    if (typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate(ms);
  };

  /**
   * The camera re-decodes a held label many times a second, so the
   * already-scanned buzz would otherwise rattle continuously while the
   * storeman lines up his next scan. One buzz per second is enough to say
   * "yes, I already have that one".
   */
  const lastDuplicateBuzz = useRef(0);
  const buzzDuplicate = useCallback(() => {
    const now = Date.now();
    if (now - lastDuplicateBuzz.current < 1000) return;
    lastDuplicateBuzz.current = now;
    if (typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate(30);
  }, []);

  /** Expand one carton scan into grouped, batch-validated chips. */
  const handleBoxScan = useCallback(
    async (serials: string[], cartonId?: string | null, rawPayload?: string) => {
      const seen = alreadyScanned();
      const fresh = serials.filter((s) => !seen.has(s));
      if (fresh.length === 0) { buzzDuplicate(); return; }
      vibrate(50);

      groupSeq.current += 1;
      const groupId = `box-${Date.now()}-${groupSeq.current}`;
      const groupLabel = `Box · ${fresh.length} serial${fresh.length === 1 ? '' : 's'}`;
      const scannedAt = Date.now();

      // A carton's serials are read from its printed DataMatrix, so they are
      // machine-read by definition and may be taken into stock if the sheet
      // has never listed them.
      const pending: PwaScannedSerial[] = fresh.map((serialNumber) => ({
        serialNumber, stockItemId: '', stockItemName: '', scannedAt,
        state: 'pending-validation', groupId, groupLabel,
        scanSource: 'machine' as const,
        ...(cartonId ? { cartonId } : {}),
        ...(rawPayload ? { scanPayload: rawPayload } : {}),
      }));
      commit([...scannedRef.current, ...pending]);

      let response: Awaited<ReturnType<typeof validateSerialBatch>>;
      try {
        response = await validateSerialBatch({
          serials: fresh,
          stockItemId: stockItem.id,
          sourceLocationId: sourceLocation?.id ?? null,
          // The payload itself — the server decides what it corroborates.
          scanPayload: rawPayload ?? null,
        });
      } catch (err) {
        if (!mountedRef.current) return;
        const msg = err instanceof Error ? err.message : 'Validation request failed';
        applyResolved(pending.map((p) => ({ ...p, state: 'invalid' as const, errorMessage: msg })));
        return;
      }

      if (!mountedRef.current) return;

      const byNumber = new Map(response.results.map((r) => [r.serialNumber, r]));
      const resolved: PwaScannedSerial[] = pending.map((p) => {
        const result = byNumber.get(p.serialNumber);
        if (!result) {
          return { ...p, state: 'invalid' as const, errorMessage: 'Serial number not found' };
        }
        return result.valid
          ? {
              ...p,
              stockItemId: result.stockItemId ?? stockItem.id,
              stockItemName: result.stockItemName ?? stockItem.name,
              state: 'valid' as const,
              ...(result.warning ? { warning: result.warning } : {}),
            }
          : {
              ...p,
              stockItemId: result.stockItemId ?? '',
              stockItemName: result.stockItemName ?? '',
              state: 'invalid' as const,
              errorMessage: result.errorMessage ?? 'Serial is not available',
            };
      });

      if (response.quantsWarning) {
        const drift =
          `Stock ledger disagrees here — ${response.quantsWarning.serialsInStock} serials on the shelf, ` +
          `${response.quantsWarning.quantsOnHand} on the books. Issue is still allowed.`;
        // Append rather than replace: a short-read warning set by the caller is
        // the more urgent message and must not be silently overwritten.
        setScanNotice((prev) => (prev ? `${prev} ${drift}` : drift));
      }

      applyResolved(resolved);
    },
    [stockItem, sourceLocation, commit, applyResolved, alreadyScanned, buzzDuplicate],
  );

  const handleRawSerial = useCallback(
    async (rawSerial: string, scanSource: 'machine' | 'manual' = 'manual') => {
      // A scanned payload is a carton serial list, the carton's ISO data code,
      // a single serial (bare or ISO-wrapped), or junk. parseScanPayload sorts
      // them out; only the single-serial case falls through to the old path.
      const payload = parseScanPayload(rawSerial);

      if (payload.kind === 'package-data') {
        // No serials here — but the declared quantity is worth keeping: if the
        // box code then reads short (a partial decode), we can prove it.
        declaredQuantity.current = payload.quantity ?? null;
        // Keep the package id too: it is what ties a carton's 9 serials
        // together if any of them have to be taken into stock unlisted.
        declaredPackageId.current = payload.packageId ?? null;
        setScanNotice("That's the data code. Scan the large square marked FULL SERIAL NUMBER LIST.");
        return;
      }
      if (payload.kind === 'unrecognised') {
        setScanNotice('That barcode is not a serial or a carton label.');
        return;
      }
      if (payload.kind === 'box') {
        if (payload.serials.length > MAX_BOX_SERIALS) {
          setScanNotice(
            `That code holds ${payload.serials.length} serials — more than the ${MAX_BOX_SERIALS} allowed in one scan.`,
          );
          return;
        }
        const declared = declaredQuantity.current;
        setScanNotice(
          declared !== null && declared !== payload.serials.length
            ? `Label says ${declared}, read ${payload.serials.length} — rescan the box.`
            : null,
        );
        await handleBoxScan(payload.serials, declaredPackageId.current, rawSerial);
        return;
      }

      setScanNotice(null);
      const serial = payload.serial;

      if (alreadyScanned().has(serial)) {
        buzzDuplicate();
        return;
      }
      if (typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate(50);

      const optimistic: PwaScannedSerial = {
        serialNumber: serial,
        stockItemId: '',
        stockItemName: '',
        scannedAt: Date.now(),
        state: 'pending-validation',
        scanSource,
      };
      commit([...scannedRef.current, optimistic]);

      let result: Awaited<ReturnType<typeof validateSerial>>;
      try {
        result = await validateSerial(serial);
      } catch (err) {
        if (!mountedRef.current) return;
        const msg = err instanceof Error ? err.message : 'Validation request failed';
        applyResolved([{ ...optimistic, state: 'invalid', errorMessage: msg }]);
        return;
      }

      if (!mountedRef.current) return;

      // A serial that EXISTS but is not issuable must keep its real status.
      // Collapsing every failure to `null` told verdictForSerial "no such
      // serial", which — for a machine read — made it offer to take the serial
      // into stock as new. An ONT already issued to another technician was
      // therefore shown with a green tick and "Not on the stock sheet yet"
      // (field report 2026-08-21, ALCLB465A813: status 'issued', provenance
      // 'sheet', already in someone's hands).
      //
      // `status` is present whenever the row exists, absent only on a genuine
      // 404 — that is the distinction the old code threw away.
      const exists = result.valid || result.status !== undefined;
      const record = exists
        ? {
            serialNumber: serial,
            stockItemId: result.stockItemId ?? stockItem.id,
            stockItemName: result.stockItemName ?? null,
            // The REAL status, not an assumed one.
            status: result.status ?? 'in_stock',
            currentLocationId: result.currentLocationId ?? null,
            currentLocationName: result.currentLocationName ?? null,
          }
        : null;

      const verdict = verdictForSerial(record, {
        expectedItemId: stockItem.id,
        expectedItemName: stockItem.name,
        sourceLocation: sourceLocation ?? null,
        // ONE rule, client and server. Eligibility is derived from the payload
        // itself — exactly as pickings/_validation.ts does it — so the tick the
        // storeman sees matches what the server will accept. A single scanned
        // code corroborates nothing, so it can never be taken in; previously
        // the client claimed it could and the submit then failed.
        scanSource: serialsEligibleForIntake(rawSerial).has(serial) ? 'machine' : 'manual',
      });

      const resolved: PwaScannedSerial = verdict.valid
        ? {
            ...optimistic,
            stockItemId: verdict.stockItemId,
            stockItemName: verdict.stockItemName,
            state: 'valid',
            ...(verdict.warning ? { warning: verdict.warning } : {}),
          }
        : {
            ...optimistic,
            stockItemId: verdict.stockItemId ?? '',
            stockItemName: verdict.stockItemName ?? '',
            state: 'invalid',
            // validateSerial's own message (404, bad status) is more specific
            // than the generic not-found the verdict produces from a null record.
            errorMessage: result.valid
              ? verdict.errorMessage
              : (result.errorMessage ?? verdict.errorMessage),
          };

      applyResolved([resolved]);
    },
    [stockItem, sourceLocation, commit, handleBoxScan, applyResolved, alreadyScanned, buzzDuplicate]
  );

  const handleRemove = useCallback(
    (serialNumber: string) =>
      commit(scannedRef.current.filter((s) => s.serialNumber !== serialNumber)),
    [commit]
  );

  const handleRemoveGroup = useCallback(
    (groupId: string) => commit(scannedRef.current.filter((s) => s.groupId !== groupId)),
    [commit]
  );

  return { handleRawSerial, handleRemove, handleRemoveGroup, scanNotice, clearScanNotice };
}
