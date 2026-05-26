/**
 * Deterministic map from an Odoo stock.location complete_name to a FibreFlow
 * stock_locations.code. Matching is on the site token immediately before
 * "/Stock" (Odoo names look like "VF/Law/Stock" or "Moh/Stock").
 *
 * Integer Odoo location IDs are resolved at runtime by the seed (and persisted
 * into odoo_location_mappings); this function only encodes the stable token→code
 * relationship so it is pure and unit-testable.
 */
const TOKEN_TO_CODE: Record<string, string> = {
  Law: 'WH-Law',
  Moh: 'WH-Moh',
  MamP1: 'WH-MamP1',
  Tem1: 'WH-Tem1',
  Tem2: 'WH-Tem2',
  Tem3: 'WH-Tem3',
  ETW: 'WH-ETW',
  GR: 'WH-GR',
  IP: 'WH-IP',
  TAV: 'WH-TAV',
  TBL: 'WH-TBL',
  // NOTE: 'WH' (Odoo "WH/Stock") is intentionally NOT auto-mapped — it is
  // ambiguous between WH-WH and WH-MAIN and must be resolved in the dry-run
  // review. Add it here once confirmed.
};

export function odooLocationToFfCode(completeName: string): string | null {
  const parts = completeName.split('/').map((p) => p.trim());
  const stockIdx = parts.lastIndexOf('Stock');
  // Require the name to END at ".../Stock" (a leaf stock location), not a
  // sub-location like ".../Stock/Transit".
  if (stockIdx === -1 || stockIdx !== parts.length - 1) return null;
  const token = parts[stockIdx - 1];
  if (!token) return null;
  return TOKEN_TO_CODE[token] ?? null;
}
