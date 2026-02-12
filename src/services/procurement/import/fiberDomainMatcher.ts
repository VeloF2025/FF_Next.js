/**
 * Fiber Domain Matcher
 *
 * Domain-specific matching for fiber optic BOQ items to stock items.
 * Uses category-to-prefix mapping and structured parameter extraction
 * instead of generic text similarity.
 *
 * BOQ descriptions use dot-notation: "Drop Cable.Connectorised.SM.G657A2.3.0mm.1F.LC/APC-SC/APC.10m"
 * Stock codes use hyphen-notation: "CAB-LCAPC-SCAPC-10-3"
 */

import type { StockItem } from './stockMatcher';

export interface FiberMatchResult {
  stockItem: StockItem;
  score: number;
  matchedParams: string[];
}

/** Maps BOQ categories to stock item code prefix patterns */
const CATEGORY_PREFIX_MAP: Record<string, string[]> = {
  // Cables — Drop
  'Drop Cable (Connectorised)': ['DROP-APC-'],

  // Cables — Aerial
  'Aerial Cable (ADSS)': ['CAB-AER-SM-'],
  'Aerial Cable (ADSS Slimline)': ['CAB-AER-SM-'],
  'Aerial Cable (Mini-ADSS)': ['CAB-AER-SM-'],

  // Cables — Underground/Micro-Blown
  'Underground Cable (Micro-Blown)': ['CAB-MB-SM-'],

  // Cables — Patch Leads & Pigtails
  'Pigtail (Connectorised)': ['LEAD-'],

  // Tangents & Dead-Ends
  'Tangent (ADSS)': ['TANGENT-'],
  'Tangent (Mini-ADSS)': ['TANGENT-'],
  'Dead-End(ADSS)': ['DEADEND-'],
  'Dead-End (ADSS)': ['DEADEND-'],
  'Dead-End(Drop)': ['DEADEND-RAPIDHOLD'],
  'Dead-End(Mini-ADSS)': ['DEADEND-'],
  'Dead-End (Mini-ADSS)': ['DEADEND-'],

  // Enclosures — Connectorised (SJC closures)
  'Enclosure (Connectorised)': ['SJC-'],

  // Enclosures — Splice (Dome joints)
  'Enclosure  (Splice)': ['DOME-'],
  'Enclosure (Splice)': ['DOME-'],

  // Access Chambers (Manholes)
  'Access Chamber (Manhole)': ['MANHOLE-'],
  'Access Chamber (Manhole Key)': ['MANHOLE-K-'],

  // Infrastructure — Conduit & Pipe
  'Conduit (Galv)': ['CONDUIT-GLV-'],
  'Conduit (Galv, Bend)': ['CONDUIT-GLV-'],
  'Conduit (PVC)': ['PIPE-HDPE-'],
  'Conduit (PVC,Bend)': ['PIPE-HDPE-'],
  'Conduit (Corr)': ['PIPE-CORR-'],
  'Conduit (HDPE)': ['PIPE-HDPE-', 'HDPE-SUBD-'],

  // Micro Duct
  'Micro Duct (HDPE, Polyethylene)': ['HDPE-'],
  'Micro Duct (HDPE, Polyethylene, Combi)': ['HDPE-'],
  'Micro Duct (HDPE, Polyethylene, Sub)': ['HDPE-SUBD-'],
  'Micro Duct': ['HDPE-'],

  // Optical — Splitters
  'Splitter (Bare)': ['SPLIT-BF-'],
  'Splitter (Connectorised)': ['SPLIT-CON-'],

  // Optical — Midcouplers
  'Midcoupler (Flanged)': ['MIDCOUP-'],
  'Midcoupler (Flangeless)': ['MIDCOUP-'],

  // Optical — Splice Protectors
  'Splice Protector': ['SPLICEPROTECTOR-'],

  // Poles & Dressing
  'Poles (Creosote)': ['POLE-'],
  'Hook (Monopole Bracket Offset)': ['HOOK-'],
  'Slack Bracket (Bracket)': ['SLACK-'],
  'Slack Bracket (Branded Box)': ['SLACK-'],
  'Buckle (Steel)': ['BANDIT-BUCKLE'],
  'Strapping (Steel)': ['BANDIT-STRAP'],
  'Label (Chromadek)': ['POLE-TAG'],

  // Consumables
  'Cable Tie': ['CABLETIE-'],
  'Label (Brady)': ['BRADYLABEL'],
  'Label': ['BRADYLABEL', 'CARRIERTAG'],
  'Coupling (Micro Duct)': ['COUPLING-'],
  'End Cap (Micro Duct)': ['ENDCAP-'],
  'Alcohol (Aerosol)': ['ALCOHOL-'],
  'Kim Wipes': ['KIM-WIPES'],
  'Bituman (SC60)': ['BITUMANTAPE'],
  'Caution Tape (Trench)': ['CAUTIONTAPE'],
  'Coach Screws': ['SCREW-COACH'],
  'Screw': ['SCREW-'],
  'Screws': ['SCREW-MIDCOUP'],

  // Wall Attachments
  'Wall Attachment': ['WALLPLUG', 'SCREW-NAIL-IN', 'SCREW-PIGTAIL'],
  'Wall Attchment': ['WALLPLUG', 'SCREW-NAIL-IN', 'SCREW-PIGTAIL'],
  'Wall Attachment (Insp Box GALV)': ['WALLPLUG', 'SCREW-'],
  'Wall Attachment (Insp Box Galv)': ['WALLPLUG', 'SCREW-'],
  'Wall Attachment (Insp Box Lid Galv)': ['WALLPLUG', 'SCREW-'],
  'Wall Attachment (Insp Box Lid PVC)': ['WALLPLUG', 'SCREW-'],
  'Wall Attachment (Insp Box PVC)': ['WALLPLUG', 'SCREW-'],
  'Wall Attachment (Saddle Galv)': ['WALLPLUG', 'SCREW-'],
  'Wall Attachment (Saddle PVC)': ['WALLPLUG', 'SCREW-'],
  'Hook (Pigtail)': ['SCREW-PIGTAIL'],

  // Cement & Tar
  'Cement Bag': ['CEMENT'],
  'Tar Bag': ['TAR'],

  // Electrical
  'Electrical': ['GLAND', 'PLUG-'],
  'Power Cable Kit': ['CABLECLIP'],

  // Stay Sets
  'Stay Set': ['BANDIT-'],
  'Lock Nut (Galv)': ['NUT-'],

  // Slack storage variants
  'Slack Bracket (Slack Storage Box)': ['SLACK-'],
};

interface ParsedParams {
  length?: number;
  diameter?: number;
  fiberCount?: number;
  connectors?: string;
  model?: string;
  sizeRange?: string;
  ways?: number;
  dimensions?: string;
  variant?: string; // 'mini', 'slimline', 'rapid', etc.
}

/**
 * Parse structured parameters from a BOQ description (dot-notation)
 * Example: "Drop Cable.Connectorised.SM.G657A2.3.0mm.1F.LC/APC-SC/APC.10m.2*3.0mmD/E.(Cardboard spool)"
 */
function parseBOQDescription(description: string): ParsedParams {
  const params: ParsedParams = {};

  // Extract diameter from parenthesized values BEFORE stripping them
  // "Splice Protector.40mm (2.5mm)" → extract 2.5 as secondary diameter
  const parenDiameterMatch = description.match(/\((\d+[.,]?\d*)mm\)/);
  const parenDiameter = parenDiameterMatch ? parseFloat(parenDiameterMatch[1].replace(',', '.')) : null;

  // Check for bulk quantity: "* 300", "* 288"
  const bulkMatch = description.match(/\*\s*(\d+)/);
  const bulkQty = bulkMatch ? parseInt(bulkMatch[1], 10) : null;

  let text = description.replace(/\(.*?\)/g, '').trim(); // Remove parenthetical notes

  // Separate text labels from numbers: "ADSS10.80" → "ADSS.10.80"
  // Only match when number has 2+ digits before decimal to avoid corrupting "A1.1:16"
  text = text.replace(/([A-Za-z])(\d{2,}[.,]\d+)/g, '$1.$2');

  // Protect decimal dots inside standalone numbers BEFORE splitting by '.'
  // "9.20-9.50mm" → "9,20-9,50mm" but NOT "G657A1.8mm" (letter before digit)
  text = text.replace(/(?<![A-Za-z])(\d)\.(\d)/g, '$1,$2');

  const parts = text.split('.').map(p => p.trim()).filter(Boolean);

  for (const part of parts) {
    const p = part.toLowerCase();

    // Connector pattern: LC/APC-SC/APC or LC/APC
    if (/lc\/apc|sc\/apc|sc\/upc/i.test(part)) {
      const connectors = part.replace(/\//g, '').replace(/-/g, '-').toLowerCase();
      params.connectors = connectors;
    }

    // Length: "10m", "15m", "100m"
    const lengthMatch = part.match(/^(\d+)m$/i);
    if (lengthMatch) {
      params.length = parseFloat(lengthMatch[1]);
    }

    // Diameter: "3,0mm", "8mm", "9,6mm", "13,6mm" (but NOT ranges like "9,20-9,50mm")
    if (!part.includes('-')) {
      const diaMatch = part.match(/^(\d+(?:[.,]\d+)?)mm$/i);
      if (diaMatch) {
        params.diameter = parseFloat(diaMatch[1].replace(',', '.'));
      }
    }

    // Fiber count: "1F", "12F", "24F", "48F", "72F"
    const fiberMatch = part.match(/^(\d+)F$/i);
    if (fiberMatch) {
      params.fiberCount = parseInt(fiberMatch[1], 10);
    }

    // Size range: "9,20-9,50mm", "100-120", "17,9mm-18,99mm"
    // Strip 'mm' first, then parse the range
    const cleanedForRange = part.replace(/mm/gi, '').trim();
    const rangeMatch = cleanedForRange.match(/^(\d+[.,]?\d*)\s*-\s*(\d+[.,]?\d*)$/);
    if (rangeMatch) {
      const low = rangeMatch[1].replace(',', '.');
      const high = rangeMatch[2].replace(',', '.');
      // Validate range: lo must be less than hi (prevents fake ranges from split errors)
      if (parseFloat(low) < parseFloat(high)) {
        params.sizeRange = low + '-' + high;
      }
    }

    // Model numbers: RN300, RN400, "RN400 Extension", ODCFD0, UMJ, CMJ
    const rnMatch = part.match(/^RN(\d+)/i);
    if (rnMatch) {
      params.model = 'RN' + rnMatch[1];
      // Also store the numeric part as length for matching MANHOLE-300 etc.
      params.length = parseInt(rnMatch[1], 10);
    } else if (/^(ODCFD\w*|UMJ|CMJ|MMJ)$/i.test(part)) {
      params.model = part.toUpperCase();
    }

    // Enclosure models: "M8 Microloop", "M16 Microloop", "M16 Microloop + bracket"
    const microloopMatch = part.match(/^M(\d+)\s*Microloop/i);
    if (microloopMatch) {
      params.model = 'M' + microloopMatch[1] + '-MICROLOOP';
    }

    // Thread/bolt sizes: M12, M14, M16
    if (/^M\d+$/i.test(part) && !params.model) {
      params.model = part.toUpperCase();
    }

    // Ways: "1Way", "2Way", "4Way", "7Way", "1 WAY", "2 WAY"
    const waysMatch = part.match(/(\d+)\s*way/i);
    if (waysMatch) {
      params.ways = parseInt(waysMatch[1], 10);
    }

    // Dimensions: "16mm*16mm", "25mm*16mm"
    const dimMatch = part.match(/^(\d+)mm\*(\d+)mm$/i);
    if (dimMatch) {
      params.dimensions = dimMatch[1] + 'X' + dimMatch[2];
    }

    // Length suffix: "2m", "3m", "4m" (for trunking, conduit)
    const shortLenMatch = part.match(/^(\d)m$/);
    if (shortLenMatch) {
      params.length = parseInt(shortLenMatch[1], 10);
    }

    // Variants
    if (p === 'mini' || p === 'mini-adss') params.variant = 'MINI';
    if (p === 'slimline') params.variant = 'SLIMLINE';
    if (p === 'rapid stor' || p === 'rapid') params.variant = 'RAPID';
    if (p === 'extreme slack') params.variant = 'X';

    // Duplex/Simplex/Quad
    if (p === 'duplex') params.variant = (params.variant || '') + 'DUP';
    if (p === 'simplex') params.variant = (params.variant || '') + 'SIM';
    if (p === 'quad') params.variant = (params.variant || '') + 'QUAD';

    // Flanged/Flangeless
    if (p === 'flangeless' || p === 'flangelss') params.variant = (params.variant || '') + 'FL';
    if (p === 'flanged') params.variant = (params.variant || '') + 'F';

    // Duct sizes: "8/5", "14/10", "40/34", "14/10 YELLOW", "8/5 WHITE"
    const ductMatch = part.match(/^(\d+)\/(\d+)/);
    if (ductMatch) {
      params.dimensions = ductMatch[1] + '-' + ductMatch[2];
    }

    // Splitter ratio: "1:8", "1:16"
    const splitMatch = part.match(/^1:(\d+)$/);
    if (splitMatch) {
      params.model = '1-' + splitMatch[1];
    }
  }

  // Fallback: extract size range from full description for edge cases
  // Handles "ADSS10.80-11.49mm" where the dot splitting breaks the range
  if (!params.sizeRange) {
    const fullRangeMatch = description.match(/(\d+[.,]\d+)\s*mm?\s*-\s*(\d+[.,]\d+)\s*mm/);
    if (fullRangeMatch) {
      params.sizeRange = fullRangeMatch[1].replace(',', '.') + '-' + fullRangeMatch[2].replace(',', '.');
    }
  }

  // Also extract from full description for patterns that span dots
  // Height for poles: "5,4m.100-120" → length=5.4
  const poleHeightMatch = description.match(/(\d+[.,]\d+)m\.\d+-\d+/);
  if (poleHeightMatch) {
    params.length = parseFloat(poleHeightMatch[1].replace(',', '.'));
  }

  // Dead-end drop cable: "Dead-End.drop cable.2,8-3,8mm"
  if (/dead-?end/i.test(description) && /drop\s*cable/i.test(description)) {
    params.model = 'DROP';
  }
  // Dead-end rapidhold
  if (/rapidhold/i.test(description)) {
    params.model = 'RAPIDHOLD';
  }

  // Cable tie size
  if (/large/i.test(description)) params.variant = 'L';
  if (/small/i.test(description)) params.variant = 'S';

  // Hook ways from description
  const hookWays = description.match(/(\d)Way/i);
  if (hookWays) params.ways = parseInt(hookWays[1], 10);

  // ONT type
  if (/ONT.*Wooden|ONT.*Wood/i.test(description)) params.model = 'ONT-WOOD';
  if (/ONT.*Bracket/i.test(description)) params.model = 'ONT-BRKT';
  if (/ONT.*Sticker|ONT.*Label/i.test(description)) params.model = 'LABEL-ONT';
  if (/Pigtail.*Screw|Pig.*Tail.*Screw/i.test(description)) params.model = 'PIGTAIL-SCREW';

  // Electrical type
  if (/Adapter/i.test(description)) params.model = 'ADAPT';
  if (/Power.*Ext.*5m|5m.*Power/i.test(description)) params.model = 'EXT-5';
  if (/Power.*Ext.*10m|10m.*Power/i.test(description)) params.model = 'EXT-10';

  // Alcohol type
  if (/Aerosol|Spray/i.test(description)) params.model = 'SPRAY';
  if (/1\s*L|1\s*Liter|1\s*Litre/i.test(description)) params.model = '1L';

  // Brady label carrier (check for "carrier" keyword, not just "yellow")
  if (/carrier/i.test(description)) params.variant = 'CARRIER-Y';

  // Splice Protector: use parenthesized diameter as secondary size
  // "Splice Protector.40mm (2.5mm)" → diameter=40 (from mm parse), but we need
  // to match CONS-SPLICEPROT-40-2.5 where 40=length, 2.5=diameter
  if (parenDiameter != null && /splice\s*protect/i.test(description)) {
    // The first mm value is the splice length, parens value is fiber diameter
    params.length = params.diameter || undefined;
    params.diameter = parenDiameter;
  }

  // Splice protector bulk: "* 300" means bulk pack (stock uses -288 suffix)
  if (bulkQty && bulkQty > 100 && /splice\s*protect/i.test(description)) {
    params.fiberCount = 288; // Stock uses -288 for bulk packs
  }

  // Screw variants
  if (/flathead|flat\s*head/i.test(description)) params.variant = 'FH';
  if (/midcoupler|mid.*coup/i.test(description)) params.variant = 'MIDCOUP';

  // Access Chamber extension
  if (/extension/i.test(description)) params.variant = 'EXT';

  // Stay Set component matching via model field
  if (/stay\s*set/i.test(description) || /stay/i.test(description.split('.')[0] || '')) {
    let stayComponent = '';
    if (/bottom\s*makeoff/i.test(description)) stayComponent = 'BOTTOM-MAKEOFF';
    else if (/guy\s*grip|guygrip/i.test(description)) stayComponent = 'GUYGRIP';
    else if (/staywire|stay\s*wire/i.test(description)) stayComponent = 'WIRE';
    else if (/c\/w\s*base|c\/w\s*rod/i.test(description) && /base/i.test(description)) stayComponent = 'CW-BASE+ROD';
    else if (/c\/w\s*rod/i.test(description)) stayComponent = 'THREADEDROD';
    else if (/nuts?\s*bolts?.*washer|nbw/i.test(description)) stayComponent = 'NBW';
    else if (/washer/i.test(description)) stayComponent = 'WASHER';
    else if (/threaded\s*rod/i.test(description)) stayComponent = 'THREADEDROD';

    // Append bolt size (M12, M14, M16) to component for precise matching
    const boltMatch = description.match(/M(\d{2})/i);
    if (boltMatch && stayComponent) {
      params.model = stayComponent + '-M' + boltMatch[1];
    } else {
      params.model = stayComponent || undefined;
    }

    // Extract wire gauge: "7/2mm" → dimensions "7-2"
    const gaugeMatch = description.match(/(\d+)\/(\d+)mm/);
    if (gaugeMatch) {
      params.dimensions = gaugeMatch[1] + '-' + gaugeMatch[2];
    }
  }

  // "M12 Nuts Bolts and Washers Assembly" → Stay Set NBW-M12
  if (/nuts?\s*bolts?.*washer/i.test(description) && !params.model) {
    const boltMatch = description.match(/M(\d{2})/i);
    params.model = boltMatch ? 'NBW-M' + boltMatch[1] : 'NBW';
  }

  return params;
}

/**
 * Parse structured parameters from a stock item code (hyphen-notation)
 * Example: "CAB-LCAPC-SCAPC-10-3" or "CAB-AER-SM-9.6-24F"
 */
function parseStockCode(code: string): ParsedParams {
  const params: ParsedParams = {};
  const parts = code.split('-');

  // Connectors in stock codes: LCAPC, SCAPC, LAPC (paired or single)
  if (code.includes('LCAPC') && code.includes('SCAPC')) {
    params.connectors = 'lcapc-scapc';
  } else if (code.includes('LCAPC') || code.includes('LAPC')) {
    params.connectors = 'lcapc';
  } else if (code.includes('SCAPC')) {
    params.connectors = 'scapc';
  } else if (code.includes('SCUPC')) {
    params.connectors = 'scupc';
  }

  // DROP-APC cables imply LC/APC-SC/APC connectors
  if (code.startsWith('DROP-APC-')) {
    params.connectors = 'lcapc-scapc';
  }

  // Look for numeric parts
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];

    // Fiber count: "24F", "48F", "12F"
    const fiberMatch = part.match(/^(\d+)F$/i);
    if (fiberMatch) {
      params.fiberCount = parseInt(fiberMatch[1], 10);
      continue;
    }

    // Size range: two consecutive numeric parts like "9.2" and "9.5"
    if (i < parts.length - 1 && /^\d+\.?\d*$/.test(part) && /^\d+\.?\d*$/.test(parts[i + 1])) {
      const next = parts[i + 1];
      const v1 = parseFloat(part);
      const v2 = parseFloat(next);
      if (v2 > v1 && v2 < v1 * 3) {
        params.sizeRange = part + '-' + next;
        i++; // Skip next
        continue;
      }
    }

    // Dimensions: "16X16"
    const dimMatch = part.match(/^(\d+)X(\d+)$/i);
    if (dimMatch) {
      params.dimensions = dimMatch[1] + 'X' + dimMatch[2];
      continue;
    }

    // Model identifiers: ODCFD0, ODCFD08L, ODCFD1, UMJ, CMJ, MMJ, LMJ, RAPIDHOLD
    if (/^(RN\d+|ODCFD\w*|UMJ|CMJ|MMJ|LMJ|DROP|RAPIDHOLD|SPRAY|1L|EXT)$/i.test(part)) {
      params.model = part.toUpperCase();
      continue;
    }

    // MINI variant
    if (part === 'MINI') {
      params.variant = 'MINI';
      continue;
    }

    // Enclosure Microloop models: SJC-MICROLOOP-M8, SJC-MICROLOOP-M16
    if (/^M\d+$/i.test(part)) {
      if (code.includes('MICROLOOP')) {
        params.model = part.toUpperCase() + '-MICROLOOP';
        continue;
      }
    }
    if (part === 'MICROLOOP') continue; // Skip, already handled

    // Midcoupler: D=Duplex, S=Simplex, Q=Quad, FL=Flangeless
    if (code.startsWith('MIDCOUP-')) {
      if (part === 'D') params.variant = (params.variant || '') + 'DUP';
      else if (part === 'S') params.variant = (params.variant || '') + 'SIM';
      else if (part === 'Q') params.variant = (params.variant || '') + 'QUAD';
      else if (part === 'FL') params.variant = (params.variant || '') + 'FL';
    }

    // Splitter/pigtail specific: DUP, SIM
    if (part === 'DUP') params.variant = (params.variant || '') + 'DUP';
    if (part === 'SIM') params.variant = (params.variant || '') + 'SIM';
    // LPAPC/LCAPC for splitters
    if (part === 'LPAPC' || part === 'LCAPC') params.connectors = 'lcapc';

    // Hook ways: 1, 2, 3 (for HOOK-1, HOOK-2, HOOK-3)
    if (code.startsWith('HOOK-') && /^\d+$/.test(part)) {
      params.ways = parseInt(part, 10);
      continue;
    }
    if (part === 'UNI') {
      params.model = 'UNI';
      continue;
    }

    // Slack bracket variants: V, X (extreme), RAPID, 600
    if (code.startsWith('SLACK-')) {
      if (part === 'X') params.variant = 'X';
      if (part === 'V') params.variant = 'V';
      if (part === 'RAPID') params.variant = 'RAPID';
      if (part === '600') params.length = 600;
    }

    // Thread/bolt sizes in stock codes: M12, M14
    if (/^M\d+$/.test(part) && !params.model) {
      params.model = part;
    }
  }

  // Splitter ratio: SPLIT-BF-1-8, SPLIT-CON-1-16-LCAPC
  const splitterRatioMatch = code.match(/SPLIT-(?:BF|CON)-(\d+)-(\d+)/);
  if (splitterRatioMatch) {
    params.model = splitterRatioMatch[1] + '-' + splitterRatioMatch[2];
  }

  // Screw variants
  if (code.startsWith('SCREW-')) {
    if (code.includes('MIDCOUP')) params.variant = 'MIDCOUP';
    if (code.includes('COACH')) params.variant = 'COACH';
  }

  // Brady label variants
  if (code.startsWith('BRADYLABEL')) {
    if (code.includes('CARRIER')) params.variant = 'CARRIER-Y';
  }

  // Access chamber (manhole) variants
  if (code.includes('-EXT')) params.variant = 'EXT';

  // Micro Duct dimensions: HDPE-2-1410 → ways=2, dimensions=14-10
  if (code.startsWith('HDPE-') && !code.includes('SUBD')) {
    const mdMatch = code.match(/HDPE-(\d+)-(\d+)(\d{2})$/);
    if (mdMatch) {
      params.ways = parseInt(mdMatch[1], 10);
      params.dimensions = mdMatch[2] + '-' + mdMatch[3];
    }
  }

  // Extract trailing numeric parameters
  const numericTail = extractNumericTail(code, params);
  if (numericTail.length) params.length = numericTail.length;
  if (numericTail.diameter) params.diameter = numericTail.diameter;

  return params;
}

/**
 * Extract length and diameter from the numeric tail of a stock code
 */
function extractNumericTail(
  code: string,
  existingParams: ParsedParams
): { length?: number; diameter?: number } {
  const result: { length?: number; diameter?: number } = {};
  const parts = code.split('-');

  // Find all purely numeric parts (not already parsed as fibers, dimensions, etc.)
  const numericParts: number[] = [];
  for (const part of parts) {
    if (/^\d+\.?\d*$/.test(part) && !existingParams.sizeRange?.includes(part)) {
      numericParts.push(parseFloat(part));
    }
  }

  // Heuristic interpretation based on code prefix
  if (code.startsWith('DROP-APC-') && numericParts.length >= 2) {
    // DROP-APC-10-3 → length=10, diameter=3
    result.length = numericParts[0];
    result.diameter = numericParts[1];
  } else if (code.startsWith('DROP-APC-') && numericParts.length === 1) {
    result.length = numericParts[0];
  } else if (code.startsWith('CAB-AER-SM-') && numericParts.length >= 1) {
    // CAB-AER-SM-9.6-24F → diameter=9.6 (fiber already parsed)
    result.diameter = numericParts[0];
  } else if (code.startsWith('CAB-MB-SM-') && numericParts.length >= 1) {
    // CAB-MB-SM-5.6-12F → diameter=5.6
    result.diameter = numericParts[0];
  } else if (code.startsWith('POLE-') && numericParts.length >= 1) {
    result.length = numericParts[0]; // pole height
  } else if (code.startsWith('CONDUIT-GLV-') && numericParts.length >= 1) {
    result.diameter = numericParts[0];
    if (numericParts.length >= 2) result.length = numericParts[1];
  } else if (code.startsWith('PIPE-HDPE-') || code.startsWith('PIPE-CORR-')) {
    if (numericParts.length >= 1) result.diameter = numericParts[0];
  } else if (code.startsWith('SPLICEPROTECTOR-') && numericParts.length >= 1) {
    // SPLICEPROTECTOR-2.2 → diameter=2.2
    result.diameter = numericParts[0];
    if (numericParts.length >= 2) result.length = numericParts[1];
  } else if (code.startsWith('LEAD-') && numericParts.length >= 1) {
    // LEAD-LCAPC-SCAPC-3 → length=3
    result.length = numericParts[numericParts.length - 1];
  } else if (code.startsWith('MANHOLE-') && numericParts.length >= 1) {
    // MANHOLE-300 → dimensions (size)
    result.length = numericParts[0];
  } else if (code.startsWith('COUPLING-') || code.startsWith('ENDCAP-')) {
    if (numericParts.length >= 1) result.diameter = numericParts[0];
  } else if (code.startsWith('SPLIT-') && numericParts.length >= 2) {
    // SPLIT-BF-1-8 → model handled above
  } else if (numericParts.length === 1) {
    result.length = numericParts[0];
  }

  return result;
}

/**
 * Score how well BOQ params match stock params
 */
function scoreParamMatch(boq: ParsedParams, stock: ParsedParams): { score: number; matched: string[] } {
  let score = 0;
  const matched: string[] = [];

  // Connector match (high value)
  if (boq.connectors && stock.connectors) {
    const boqConn = boq.connectors.replace(/[^a-z]/g, '');
    const stockConn = stock.connectors.replace(/[^a-z]/g, '');
    if (boqConn === stockConn) {
      score += 0.25;
      matched.push('connectors');
    } else {
      // Explicit connector mismatch penalty (e.g., SC/APC BOQ vs LC/APC stock)
      score -= 0.10;
    }
  }

  // Length match
  if (boq.length != null && stock.length != null) {
    if (boq.length === stock.length) {
      score += 0.20;
      matched.push('length');
    }
  }

  // Diameter match (with tolerance for rounding and cable spec differences)
  if (boq.diameter != null && stock.diameter != null) {
    if (Math.abs(boq.diameter - stock.diameter) < 0.1) {
      // Near-exact diameter match — higher score
      score += 0.25;
      matched.push('diameter');
    } else if (Math.abs(boq.diameter - stock.diameter) < 0.6) {
      score += 0.20;
      matched.push('diameter');
    }
  }

  // Fiber count match
  if (boq.fiberCount != null && stock.fiberCount != null) {
    if (boq.fiberCount === stock.fiberCount) {
      score += 0.20;
      matched.push('fibers');
    }
  }

  // Model match
  if (boq.model && stock.model) {
    if (boq.model === stock.model) {
      score += 0.25;
      matched.push('model');
    }
  }

  // Size range match (fuzzy overlap — ranges may differ slightly between BOQ and stock)
  if (boq.sizeRange && stock.sizeRange) {
    const parseRange = (r: string): [number, number] => {
      const [lo, hi] = r.split('-').map(v => parseFloat(v));
      return [lo, hi];
    };
    const [bLo, bHi] = parseRange(boq.sizeRange);
    const [sLo, sHi] = parseRange(stock.sizeRange);

    // Check overlap percentage
    const overlapLo = Math.max(bLo, sLo);
    const overlapHi = Math.min(bHi, sHi);
    const boqSpan = bHi - bLo;
    const stockSpan = sHi - sLo;

    if (overlapHi > overlapLo && boqSpan > 0 && stockSpan > 0) {
      const overlapSpan = overlapHi - overlapLo;
      const overlapRatio = overlapSpan / Math.max(boqSpan, stockSpan);
      if (overlapRatio > 0.70) {
        score += 0.25;
        matched.push('sizeRange');
      } else if (overlapRatio > 0.40) {
        score += 0.15;
        matched.push('sizeRange~');
      }
    }
  }

  // Ways match (1WAY, 2WAY, etc.)
  if (boq.ways != null && stock.ways != null) {
    if (boq.ways === stock.ways) {
      score += 0.20;
      matched.push('ways');
    }
  }

  // Dimensions match (16X16, etc.)
  if (boq.dimensions && stock.dimensions) {
    if (boq.dimensions === stock.dimensions) {
      score += 0.20;
      matched.push('dimensions');
    }
  }

  // Variant match (MINI, DUP, SIM, FL, etc.)
  // Normalize: sort variant substrings so "FLDUP" matches "DUPFL"
  const normalizeVariant = (v: string) => {
    const parts: string[] = [];
    const tokens = ['QUAD', 'DUP', 'SIM', 'MINI', 'SLIMLINE', 'RAPID', 'FL', 'F', 'X', 'V'];
    let remaining = v;
    for (const t of tokens) {
      if (remaining.includes(t)) { parts.push(t); remaining = remaining.replace(t, ''); }
    }
    if (remaining) parts.push(remaining);
    return parts.sort().join('+');
  };
  if (boq.variant && stock.variant) {
    if (normalizeVariant(boq.variant) === normalizeVariant(stock.variant)) {
      score += 0.15;
      matched.push('variant');
    }
  } else if (boq.variant && !stock.variant) {
    // Only penalize for meaningful variant mismatches, not labels like SLIMLINE
    if (boq.variant !== 'SLIMLINE') {
      score -= 0.15;
    }
  } else if (!boq.variant && stock.variant) {
    score -= 0.15;
  }

  return { score, matched };
}

/**
 * Match a BOQ item against stock items using fiber domain knowledge
 */
export function fiberDomainMatch(
  boqItem: {
    description: string;
    category: string | null;
    itemCode: string | null;
  },
  stockItems: StockItem[]
): FiberMatchResult | null {
  if (!boqItem.category) return null;

  // Find matching prefixes for this BOQ category
  const prefixes = CATEGORY_PREFIX_MAP[boqItem.category];
  if (!prefixes) return null;

  // Filter stock items to those matching the prefix (always startsWith)
  const candidates = stockItems.filter(si =>
    prefixes.some(prefix => si.itemCode.toUpperCase().startsWith(prefix))
  );

  if (candidates.length === 0) return null;

  // Parse BOQ description parameters
  const boqParams = parseBOQDescription(boqItem.description);

  // Score each candidate
  const scored: FiberMatchResult[] = [];
  for (const candidate of candidates) {
    const stockParams = parseStockCode(candidate.itemCode);
    const { score, matched } = scoreParamMatch(boqParams, stockParams);

    // Base score 0.50 for category match, plus parameter scores
    const totalScore = Math.min(0.50 + score, 0.95);

    scored.push({
      stockItem: candidate,
      score: totalScore,
      matchedParams: matched,
    });
  }

  // Sort by score
  scored.sort((a, b) => b.score - a.score);

  // Return best match if above threshold
  const best = scored[0];
  if (best && best.score >= 0.65) {
    return best;
  }

  // "Clear winner" logic: if best candidate is significantly better than runner-up,
  // accept it even at lower score (e.g., variant penalty separates generic from specific)
  if (best && best.score >= 0.50 && scored.length >= 2 && (best.score - scored[1].score) >= 0.10) {
    return best;
  }

  // If only 1 candidate and category matched, return it with lower confidence
  if (candidates.length === 1 && scored[0]) {
    return { ...scored[0], score: Math.max(scored[0].score, 0.55) };
  }

  return null;
}
