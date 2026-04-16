/**
 * PDF Snag Format Detector
 *
 * Inspects pdftotext -layout output to determine which parser to use.
 * Status: WORKING
 */

export type PdfSnagFormat = 'tqr' | 'field_report' | 'unknown';

/**
 * Detect the snag report format from pdftotext -layout text output.
 *
 * TQR signature:          "Report Document No" + "Finding:"
 * Field report signature: Google Maps URL or DMS coordinates
 */
export function detectPdfFormat(pdfText: string): PdfSnagFormat {
  // TQR checked first — takes precedence if both signatures appear
  const isTqr =
    /Report\s+Document\s+No/i.test(pdfText) &&
    /Finding:/i.test(pdfText);
  if (isTqr) return 'tqr';

  const hasGoogleMaps = /maps\.google\.com/i.test(pdfText);
  const hasDms = /\d+°\d+'\d+(?:\.\d+)"[NS]/i.test(pdfText);
  const hasSnagColumn = /\bSnag\b/.test(pdfText) || hasDms;

  if ((hasGoogleMaps || hasDms) && hasSnagColumn) return 'field_report';

  return 'unknown';
}
