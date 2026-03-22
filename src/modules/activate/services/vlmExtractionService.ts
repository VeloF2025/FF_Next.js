/**
 * VLM Extraction Service — Barrel Re-export
 *
 * This file has been refactored into focused modules.
 * All original exports are re-exported here for backwards compatibility.
 *
 * Sub-modules:
 * - vlmClient.ts             — Base HTTP client, types, feature flags
 * - powerMeterExtractor.ts   — Power meter extraction (Step 7)
 * - serialExtractor.ts       — ONT serial validation, normalization, Step 6
 * - step9Extractor.ts        — Step 9 front panel, confirmation, multi-photo
 * - multiPhotoExtraction.ts  — Full DR orchestration
 * - waPhotoExtraction.ts     — WhatsApp photo serial extraction
 *
 * Status: WORKING — barrel only, zero logic here
 * NLNH Confidence: HIGH
 */

// Base client types and HTTP layer
export type {
  PowerMeterExtraction,
  SerialExtraction,
  SerialConfirmation,
  DrNumberExtraction,
  Step9Extraction,
  FullExtractionResult,
} from './vlmClient';

// Power meter
export {
  extractPowerMeterReading,
  extractPowerMeterWithMultiplePhotos,
} from './powerMeterExtractor';

// Serial validation helpers + Step 6 extraction
export {
  isValidOntSerial,
  normalizeSerial,
  isPromptExampleSerial,
  extractOntSerialFromBack,
  serialsMatch,
  drNumbersMatch,
} from './serialExtractor';

// Step 9 front panel, confirmation, multi-photo
export {
  extractStep9Data,
  extractOntSerialWithMultiplePhotos,
  extractStep9WithMultiplePhotos,
  confirmSerialVisible,
  confirmSerialFromMultiplePhotos,
} from './step9Extractor';

// Full DR orchestration
export { runFullExtraction } from './multiPhotoExtraction';

// WhatsApp photo extraction
export type { WaPhotoExtractionResult } from './waPhotoExtraction';
export { extractSerialsFromWaPhoto } from './waPhotoExtraction';
