/**
 * Multi-Photo Extraction & Full DR Orchestration
 *
 * Purpose: Orchestrate the full extraction run for a DR, selecting between
 * CONFIRMATION mode (when OneMap has the serial) and EXTRACTION mode.
 * Re-exports multi-photo helpers that were previously inlined in the
 * monolithic vlmExtractionService.
 *
 * Status: WORKING
 * NLNH Confidence: HIGH
 */

import { log } from '@/lib/logger';
import { vlmLogger, type FullExtractionResult } from './vlmClient';
import { isValidOntSerial, extractOntSerialFromBack } from './serialExtractor';
import {
  extractPowerMeterReading,
  extractPowerMeterWithMultiplePhotos,
} from './powerMeterExtractor';
import {
  extractOntSerialWithMultiplePhotos,
  extractStep9Data,
  extractStep9WithMultiplePhotos,
  confirmSerialFromMultiplePhotos,
} from './step9Extractor';

// Re-export for barrel consumers
export {
  extractPowerMeterWithMultiplePhotos,
  extractOntSerialWithMultiplePhotos,
  extractStep9WithMultiplePhotos,
};

// ============================================================================
// FULL DR EXTRACTION ORCHESTRATOR
// ============================================================================

/**
 * Run full extraction for a DR.
 *
 * SMART MODE: If expectedOntSerial is provided (from OneMap), uses CONFIRMATION
 * mode which is more accurate than extraction mode. Only falls back to
 * extraction when OneMap doesn't have the serial.
 *
 * @param drNumber - DR number being processed
 * @param photos - Map of step number to photo URL(s) — arrays preferred
 * @param options - Optional configuration including expectedOntSerial from OneMap
 */
export async function runFullExtraction(
  drNumber: string,
  photos: {
    step6Url?: string;
    step6Urls?: string[];
    step7Url?: string;
    step7Urls?: string[];
    step9Url?: string;
    step9Urls?: string[];
  },
  options?: {
    /** If OneMap has the ONT serial, provide it here for confirmation mode */
    expectedOntSerial?: string | null;
  }
): Promise<FullExtractionResult> {
  const startTime = Date.now();
  const expectedSerial = options?.expectedOntSerial;
  const useConfirmationMode =
    !!expectedSerial && isValidOntSerial(expectedSerial);

  vlmLogger.info(
    `Running ${useConfirmationMode ? 'CONFIRMATION' : 'EXTRACTION'} mode for ${drNumber}${useConfirmationMode ? ` (expecting ${expectedSerial})` : ''}`
  );

  let powerMeter = null;
  let ontSerialStep6 = null;
  let step9 = null;
  let serialConfirmation = null;

  // ── Step 7: Power meter ──────────────────────────────────────────────────
  if (photos.step7Urls && photos.step7Urls.length > 0) {
    const { result } = await extractPowerMeterWithMultiplePhotos(
      photos.step7Urls
    );
    powerMeter = result;
  } else if (photos.step7Url) {
    powerMeter = await extractPowerMeterReading(photos.step7Url);
  }
  if (powerMeter) {
    vlmLogger.debug(
      `Power meter result: ${powerMeter.success ? powerMeter.value + ' dBm' : 'failed'}`
    );
  }

  if (useConfirmationMode && expectedSerial) {
    // ── CONFIRMATION MODE ────────────────────────────────────────────────────
    vlmLogger.info(`Using CONFIRMATION mode for ${expectedSerial}`);

    const allSerialPhotos = [
      ...(photos.step6Urls || []),
      ...(photos.step6Url ? [photos.step6Url] : []),
      ...(photos.step9Urls || []),
      ...(photos.step9Url ? [photos.step9Url] : []),
    ];

    if (allSerialPhotos.length > 0) {
      const { result } = await confirmSerialFromMultiplePhotos(
        allSerialPhotos,
        expectedSerial
      );
      serialConfirmation = result;

      if (serialConfirmation.confirmed) {
        vlmLogger.info(`✓ Serial ${expectedSerial} CONFIRMED in photos`);

        ontSerialStep6 = {
          success: true,
          serial: expectedSerial,
          confidence: serialConfirmation.confidence,
          location: 'back' as const,
          rawText: serialConfirmation.visibleText || expectedSerial,
          extractionMethod: 'vlm' as const,
        };
      } else {
        vlmLogger.warn(
          `✗ Serial ${expectedSerial} NOT confirmed — ${serialConfirmation.details}`
        );

        if (serialConfirmation.alternativeSerial) {
          vlmLogger.warn(
            `Found alternative serial: ${serialConfirmation.alternativeSerial}`
          );
          ontSerialStep6 = {
            success: true,
            serial: serialConfirmation.alternativeSerial,
            confidence: serialConfirmation.confidence,
            location: 'back' as const,
            rawText:
              serialConfirmation.visibleText ||
              serialConfirmation.alternativeSerial,
            extractionMethod: 'vlm' as const,
          };
        } else {
          // Couldn't confirm or find alternative — fall back to extraction
          vlmLogger.info('Falling back to extraction mode');
          if (photos.step6Urls && photos.step6Urls.length > 0) {
            const { result: r } = await extractOntSerialWithMultiplePhotos(
              photos.step6Urls
            );
            ontSerialStep6 = r;
          } else if (photos.step6Url) {
            ontSerialStep6 = await extractOntSerialFromBack(photos.step6Url);
          }
        }
      }
    }

    // Still extract Step 9 for DR number and green lights
    if (photos.step9Urls && photos.step9Urls.length > 0) {
      const { result: r } = await extractStep9WithMultiplePhotos(
        photos.step9Urls
      );
      step9 = r;
    } else if (photos.step9Url) {
      step9 = await extractStep9Data(photos.step9Url);
    }
  } else {
    // ── EXTRACTION MODE ──────────────────────────────────────────────────────
    vlmLogger.info('Using EXTRACTION mode (no OneMap serial)');

    if (photos.step6Urls && photos.step6Urls.length > 0) {
      const { result: r } = await extractOntSerialWithMultiplePhotos(
        photos.step6Urls
      );
      ontSerialStep6 = r;
    } else if (photos.step6Url) {
      ontSerialStep6 = await extractOntSerialFromBack(photos.step6Url);
    }

    if (photos.step9Urls && photos.step9Urls.length > 0) {
      const { result: r } = await extractStep9WithMultiplePhotos(
        photos.step9Urls
      );
      step9 = r;
    } else if (photos.step9Url) {
      step9 = await extractStep9Data(photos.step9Url);
    }
  }

  if (ontSerialStep6) {
    vlmLogger.debug(
      `ONT serial Step 6: ${ontSerialStep6.success ? ontSerialStep6.serial : 'failed'}`
    );
  }
  if (step9) {
    vlmLogger.debug(
      `Step 9: serial=${step9.ontSerial.serial}, DR=${step9.drNumber.drNumber}`
    );
  }

  const totalProcessingTimeMs = Date.now() - startTime;

  vlmLogger.info(
    `Full extraction complete for ${drNumber} in ${totalProcessingTimeMs}ms (mode: ${useConfirmationMode ? 'confirm' : 'extract'})`
  );

  return {
    drNumber,
    powerMeter,
    ontSerialStep6,
    step9,
    serialConfirmation,
    usedConfirmationMode: useConfirmationMode,
    totalProcessingTimeMs,
  };
}

// suppress unused-import warning — log is used for potential future top-level errors
void (log as unknown);
