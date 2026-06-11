/**
 * Lookup asset by scanned code.
 * Tries barcode first, then assetNumber.
 */
export async function lookupAssetByCode(
  scannedCode: string
): Promise<{ found: boolean; asset?: Record<string, unknown>; matchedBy?: 'barcode' | 'assetNumber'; error?: string }> {
  try {
    // First try barcode lookup
    const barcodeResponse = await fetch(
      `/api/assets/search?barcode=${encodeURIComponent(scannedCode)}`
    );

    if (barcodeResponse.ok) {
      const data = await barcodeResponse.json() as { success: boolean; data?: Record<string, unknown> };
      if (data.success && data.data) {
        return {
          found: true,
          asset: data.data,
          matchedBy: 'barcode',
        };
      }
    }

    // Fall back to assetNumber lookup
    const assetNumberResponse = await fetch(
      `/api/assets/search?assetNumber=${encodeURIComponent(scannedCode)}`
    );

    if (assetNumberResponse.ok) {
      const data = await assetNumberResponse.json() as { success: boolean; data?: Record<string, unknown> };
      if (data.success && data.data) {
        return {
          found: true,
          asset: data.data,
          matchedBy: 'assetNumber',
        };
      }
    }

    return {
      found: false,
      error: `No asset found with barcode or asset number: ${scannedCode}`,
    };
  } catch (err) {
    return {
      found: false,
      error: err instanceof Error ? err.message : 'Failed to lookup asset',
    };
  }
}
