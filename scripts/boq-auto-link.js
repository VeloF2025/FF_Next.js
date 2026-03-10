// 🟢 WORKING: BOQ Auto-Link Script
// Links purchase_order_items to boq_items using three matching strategies:
//   S1 - Exact match on item_code (already done, ~108 items)
//   S2 - Prefix normalization (strips/swaps prefixes, same naming convention)
//   S3 - Supplier code mapping (Lawley/Mohadin numeric/alpha supplier codes)
//
// Usage:
//   node scripts/boq-auto-link.js              # Dry run (default)
//   node scripts/boq-auto-link.js --apply      # Write to DB
//   node scripts/boq-auto-link.js --project Lawley   # Filter by project name

'use strict';

const { neon } = require('@neondatabase/serverless');

const DATABASE_URL =
  'postgresql://neondb_owner:npg_MIUZXrg1tEY0@ep-dry-night-a9qyh4sj-pooler.gwc.azure.neon.tech/neondb?sslmode=require';

const APPLY = process.argv.includes('--apply');
const PROJECT_FILTER_IDX = process.argv.indexOf('--project');
const PROJECT_FILTER =
  PROJECT_FILTER_IDX !== -1 ? process.argv[PROJECT_FILTER_IDX + 1] : null;

// ---------------------------------------------------------------------------
// Strategy 3: Supplier-code-to-FibreFlow-code mapping table
// Keys are Lawley/Mohadin supplier stock codes; values are arrays of candidate
// FibreFlow descriptive codes (item_description on PO items).
// ---------------------------------------------------------------------------
const SUPPLIER_CODE_MAP = {
  // Dead-ends (ADSS cable clamps)
  DEA004: ['CAB-DEADEND-10.54-11.65'],
  DEA010: ['CAB-DEADEND-9.4-10.5', 'CAB-DEADEND-9.40-10.50'],
  'DEA015/DEA005': ['CAB-DEADEND-11.70-12.90', 'DEADEND-11.70-12.90'],
  'DEA016/DEA007/DEA016FTN': ['CAB-DEADEND-15.60-17.27', 'CAB-DEADEND-14.17-15.60'],
  DEA018: ['CAB-DEADEND-9.2-9.5', 'DEADEND-9.2-9.5'],
  'DEA029/DEA024/DEA021': ['CAB-DEADEND-2.8-3.8', 'DEADEND-2.8-3.8'],
  'DEA030/DEA020/DEA020FTN DEA026/DEA027': [
    'CAB-DEADEND-4.50-6.19-MINI',
    'DEADEND-4.50-6.19-MINI',
  ],

  // Drop cables (LC/APC-SC/APC connectorised)
  // DP-A codes (used on some BOQs, e.g. Mamelodi/Etwatwa)
  'DP-A-1-LB-86/73-2-10': ['CAB-LCAPC-SCAPC-10-3'],
  'DP-A-1-LB-86/73-2-15': ['CAB-LCAPC-SCAPC-15-3'],
  'DP-A-1-LB-86/73-2-20': ['CAB-LCAPC-SCAPC-20-3'],
  'DP-A-1-LB-86/73-2-25': ['CAB-LCAPC-SCAPC-25-3'],
  'DP-A-1-LB-86/73-2-30': ['CAB-LCAPC-SCAPC-30-3'],
  'DP-A-1-LB-86/73-2-35': ['CAB-LCAPC-SCAPC-35-3'],
  'DP-A-1-LB-86/73-2-40': ['CAB-LCAPC-SCAPC-40-3', 'DROP-APC-40-3'],
  'DP-A-1-LB-86/73-2-50': ['CAB-LCAPC-SCAPC-50-3'],
  'DP-A-1-LB-86/73-2-60': ['CAB-LCAPC-SCAPC-60-3'],
  'DP-A-1-LB-86/73-2-70': ['CAB-LCAPC-SCAPC-70-3'],
  'DP-A-1-LB-86/73-2-75': ['CAB-LCAPC-SCAPC-75-3'],
  // PRE codes (used on Lawley BOQ with qty > 0)
  PRE065FT: ['CAB-LCAPC-SCAPC-25-3'],
  PRE066FT: ['CAB-LCAPC-SCAPC-30-3'],
  PRE068FT: ['CAB-LCAPC-SCAPC-40-3', 'DROP-APC-40-3'],
  PRE069FT: ['CAB-LCAPC-SCAPC-50-3'],
  PRE070FT: ['CAB-LCAPC-SCAPC-60-3'],
  PRE072FT: ['CAB-LCAPC-SCAPC-70-3'],

  // Hooks / brackets
  'BRA063/HOO010': ['DRESS-HOOK-1WAY', 'HOOK-1', 'HOOK-1WAY'],
  'BRA064/HOO013': ['DRESS-HOOK-3WAY', 'HOOK-3', 'HOOK-3WAY'],
  'BRA123/HOO011': ['DRESS-HOOK-2WAY', 'HOOK-2', 'HOOK-2WAY'],
  BRA104: ['DRESS-SLACKBRKT-RAPIDSTOR', 'SLACKBRKT-RAPIDSTOR'],

  // Enclosures
  BOX086: ['SLACK-X', 'DRESS-SLACKBRKT-X', 'DRESS-SLACKBRKT-600'],
  BOX168: ['ENCL-CONN-M8-MICROLOOP', 'ENCL-M8-MICROLOOP'],
  BOX189: ['ENCL-CONN-M16-MICROLOOP', 'ENCL-M16-MICROLOOP'],
  BOX179: ['SJC-ODCFD08L', 'ENCL-CONN-ODCFD08L'],
  BOX181: ['ENCL-CONN-ODCFD0'],
  JOI027: ['ENCL-SPLICE-MMJ', 'DOME-MMJ'],
  JOI028: ['ENCL-SPLICE-CMJ', 'DOME-CMJ'],
  JOI033: ['ENCL-SPLICE-UMJ', 'DOME-UMJ'],

  // Strapping / fittings
  BAN002: ['DRESS-BANDITSTRAP-30', 'BANDIT-STRAP', 'BANDITSTRAP'],
  BAN003: ['DRESS-BANDIT-BUCKLE', 'BANDIT-BUCKLE'],

  // Consumables
  ALC001: ['ALCOHOL-SPRAY', 'CONS-ALCOHOL-SPRAY', 'CONS-ALCOHOL-1L'],
  KIM001: ['KIM-WIPES', 'CONS-KIM-WIPES'],
  SPL055: ['SPLICEPROTECTOR-2.2', 'CONS-SPLICEPROT-40-1.3'],
  SPL076: ['CONS-SPLICEPROT-40-2.5'],
  SPL005: ['SPLIT-BF-1-16', 'CAB-SPLITTER-BF-1-16'],
  SPL063: ['CAB-SPLITTER-BF-1-16'],
  SPL028: ['SPLIT-CON-1-16-LCAPC', 'CAB-SPLITTER-CON-1-16-LPAPC'],
  SPL029: ['SPLIT-CON-1-8-LCAPC', 'CAB-SPLITTER-CON-1-8-LPAPC'],

  // Brady labels / printer
  142803: ['BRADYLABEL', 'CONS-BRADYLABEL'],
  620318: ['BRADYLABEL-CARRIER-Y', 'CONS-BRADYLABEL-CARRIER-Y'],
  152260: ['TOOL-BRADYPRINTER', 'BRADYPRINTER'],

  // Midcouplers
  MID001: ['MIDCOUP-D-LAPC-FL', 'CONS-MIDCOUPLER-F-SM-DUP-LCAPC', 'CONS-MIDCOUPLER-F-SM-DUP-LCAPC'],
  MID013: ['CONS-MIDCOUPLER-F-SM-DUP-LCAPC', 'MIDCOUP-D-LAPC-FL'],
  MID016: ['CONS-MIDCOUPLER-F-SM-SIMP-SCAPC'],
  MID027: ['CONS-MIDCOUPLER-F-SM-SIMP-SCAPC'],

  // Pigtails / wall attachments
  PIG027: ['CONS-WA-PIGTAIL-SCREW', 'SCREW-PIGTAIL'],
  PIG029: ['CONS-WA-PIGTAIL-SCREW', 'SCREW-PIGTAIL'],
  ONT001: ['CONS-WA-ONT-WOOD'],

  // Cables
  FIB124: ['CAB-AER-SM-9.6-12F', 'CAB-AER-SM-9.6-24F'],
  FIB243: ['CAB-AER-SM-9.6-24F'],
  FIB431: ['CAB-AER-SM-10.4-48F'],
  FIB915: ['CAB-AER-SM-5.6-12F-MINI'],
  FIB916: ['CAB-AER-SM-5.6-24F-MINI'],
  FIB917: ['CAB-AER-SM-5.6-48F-MINI'],
  FIB710: ['CAB-AER-SM-11.2-72F'],
  FIB907: ['CAB-AER-SM-12.8-96F'],
  FIB125: ['CAB-AER-SM-15.8-144F'],
  FIB937: ['CAB-AER-SM-12.2-144F'],

  // Tangents (ADSS cable clamps)
  TAN002: ['CAB-TANGENT-9.2-9.5'],
  TAN004: ['CAB-TANGENT-10.10-10.80'],
  TAN006: ['CAB-TANGENT-12.00-13.09'],
  TAN007: ['CAB-TANGENT-15.11-16.00'],
  TAN009: ['CAB-TANGENT-11.50-12.00'],
  TAN010: ['CAB-TANGENT-4.50-6.19-MINI'],

  // Micro ducts
  WAY136: ['CAB-MICRODUCT-1WAY-8-5'],
  WAY122: ['CAB-MICRODUCT-1WAY-12-10'],
  WAY211: ['CAB-MICRODUCT-2WAY-14-10'],
  WAY217: ['CAB-MICRODUCT-2WAY-8-5'],
  WAY401: ['CAB-MICRODUCT-4WAY-14-10'],
  WAY404: ['CAB-MICRODUCT-4WAY-8-5'],

  // Couplings / end caps
  COU001: ['CONS-MD-COUPLING-8'],
  COU024: ['CONS-MD-COUPLING-14'],
  END007: ['CONS-MD-ENDCAP-14'],
  END009: ['CONS-MD-ENDCAP-8'],

  // Manholes
  MAN021: ['ENCL-MANHOLE-RN900'],
  MAN024: ['ENCL-MANHOLE-RN300', 'MANHOLE-300', 'MANHOLE-K-300'],
  MAN067: ['ENCL-MANHOLE-RN400', 'MANHOLE-400'],
  MAN069: ['ENCL-MANHOLE-RN600', 'ENCL-MANHOLE-RN600'],
  SLA013: ['DRESS-SLACKBRKT-X', 'DRESS-SLACKBRKT-600'],
  CLI023: ['CABLECLIP', 'CONS-CAB-CLIP'],
};

// ---------------------------------------------------------------------------
// Strategy 2: Prefix normalization rules
// Each rule: { from: RegExp, to: string[] }
// Applied by stripping the 'from' prefix and trying each 'to' prefix.
// ---------------------------------------------------------------------------
const PREFIX_RULES = [
  // DOME-X -> ENCL-SPLICE-X
  { from: /^DOME-/, to: ['ENCL-SPLICE-'] },
  // CONS-DOME-X -> DOME-X
  { from: /^CONS-DOME-/, to: ['DOME-'] },
  // DEADEND-X (no prefix) -> CAB-DEADEND-X
  { from: /^DEADEND-/, to: ['CAB-DEADEND-'] },
  // X (no CAB prefix, looks like a deadend/tangent) -> CAB-X
  { from: /^(TANGENT|SPLIT|SPLITTER)-/, to: ['CAB-$1-', 'CAB-SPLITTER-', 'CAB-TANGENT-'] },
  // CONS-X -> try bare X
  { from: /^CONS-/, to: [''] },
  // bare X -> try CONS-X
  { from: /^(?!CONS-)(.+)$/, to: ['CONS-$1'] },
  // SJC-X -> ENCL-CONN-X
  { from: /^SJC-/, to: ['ENCL-CONN-'] },
  // ENCL-CONN-X -> SJC-X
  { from: /^ENCL-CONN-/, to: ['SJC-'] },
  // DRESS-SLACKBRKT-X -> SLACK-X, BOX086
  { from: /^DRESS-SLACKBRKT-/, to: ['SLACK-'] },
  // SLACK-X -> DRESS-SLACKBRKT-X
  { from: /^SLACK-/, to: ['DRESS-SLACKBRKT-'] },
  // DRESS-HOOK-X -> HOOK-X
  { from: /^DRESS-HOOK-/, to: ['HOOK-'] },
  // DRESS-BANDIT-X -> BANDIT-X
  { from: /^DRESS-BANDIT/, to: ['BANDIT'] },
  // BANDIT-X -> DRESS-BANDIT-X
  { from: /^BANDIT/, to: ['DRESS-BANDIT'] },
  // SPLIT-X -> CAB-SPLITTER-X
  { from: /^SPLIT-/, to: ['CAB-SPLITTER-'] },
  // CAB-SPLITTER-X -> SPLIT-X
  { from: /^CAB-SPLITTER-/, to: ['SPLIT-'] },
  // MIDCOUP-D-LAPC-FL -> CONS-MIDCOUPLER-F-SM-DUP-LCAPC
  { from: /^MIDCOUP-D-LAPC-FL$/, to: ['CONS-MIDCOUPLER-F-SM-DUP-LCAPC'] },
  // CONS-MIDCOUPLER-F-SM-DUP-LCAPC -> MIDCOUP-D-LAPC-FL
  { from: /^CONS-MIDCOUPLER-F-SM-DUP-LCAPC$/, to: ['MIDCOUP-D-LAPC-FL'] },
  // ENCL-SPLICE-CMJ -> DOME-CMJ
  { from: /^ENCL-SPLICE-/, to: ['DOME-'] },
  // ALCOHOL-SPRAY -> CONS-ALCOHOL-SPRAY
  { from: /^ALCOHOL-SPRAY$/, to: ['CONS-ALCOHOL-SPRAY'] },
  // CONS-ALCOHOL-SPRAY -> ALCOHOL-SPRAY
  { from: /^CONS-ALCOHOL-SPRAY$/, to: ['ALCOHOL-SPRAY'] },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Generates candidate alternative codes via prefix normalization rules.
 * @param {string} code
 * @returns {string[]}
 */
function getCandidateCodes(code) {
  const candidates = new Set();
  for (const rule of PREFIX_RULES) {
    const match = code.match(rule.from);
    if (!match) continue;

    for (const prefix of rule.to) {
      // Support back-references like $1
      const resolvedPrefix = prefix.replace(/\$(\d+)/g, (_, n) => match[n] || '');
      const suffix = code.replace(rule.from, '');
      const candidate = resolvedPrefix + suffix;
      if (candidate !== code && candidate.length > 0) {
        candidates.add(candidate);
      }
    }
  }
  return [...candidates];
}

/**
 * Normalises a code for comparison: uppercase, collapse spaces.
 * @param {string} code
 * @returns {string}
 */
function normalise(code) {
  return (code || '').toUpperCase().replace(/\s+/g, ' ').trim();
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const sql = neon(DATABASE_URL);

  process.stdout.write(
    APPLY
      ? 'MODE: APPLY (will update database)\n'
      : 'MODE: DRY RUN (no changes will be made — pass --apply to write)\n'
  );
  if (PROJECT_FILTER) {
    process.stdout.write('PROJECT FILTER: ' + PROJECT_FILTER + '\n');
  }
  process.stdout.write('\n');

  // -------------------------------------------------------------------------
  // 1. Load all unlinked PO items with their project context
  // -------------------------------------------------------------------------
  const poItems = await sql`
    SELECT
      poi.id               AS poi_id,
      poi.item_code        AS item_code,
      poi.item_description AS item_description,
      po.project_id        AS project_id,
      p.project_name       AS project_name
    FROM purchase_order_items poi
    JOIN purchase_orders po ON poi.purchase_order_id = po.id
    JOIN projects p ON p.id::text = po.project_id::text
    WHERE poi.boq_item_id IS NULL
      AND (po.status IS NULL OR po.status != 'cancelled')
      AND (poi.status IS NULL OR poi.status != 'cancelled')
    ORDER BY p.project_name, poi.item_description
  `;

  const filteredPoItems = PROJECT_FILTER
    ? poItems.filter(
        (r) => r.project_name.toLowerCase() === PROJECT_FILTER.toLowerCase()
      )
    : poItems;

  process.stdout.write('Unlinked PO items loaded: ' + filteredPoItems.length + '\n\n');

  // -------------------------------------------------------------------------
  // 2. Load all BOQ items grouped by project_id for fast lookup
  //    Map: projectId -> Map<normalisedCode, boqItemId[]>
  // -------------------------------------------------------------------------
  const boqRows = await sql`
    SELECT
      bi.id          AS boq_item_id,
      bi.item_code   AS item_code,
      bi.description AS description,
      b.project_id   AS project_id
    FROM boq_items bi
    JOIN boqs b ON bi.boq_id = b.id
    WHERE bi.item_code IS NOT NULL AND bi.item_code != ''
      AND b.status = 'active'
      AND bi.quantity > 0
  `;

  /** @type {Map<string, Map<string, string[]>>} projectId -> code -> boqItemIds */
  const boqByProject = new Map();
  for (const row of boqRows) {
    const pid = row.project_id;
    if (!boqByProject.has(pid)) boqByProject.set(pid, new Map());
    const codeMap = boqByProject.get(pid);
    const key = normalise(row.item_code);
    if (!codeMap.has(key)) codeMap.set(key, []);
    codeMap.get(key).push(row.boq_item_id);
  }

  // -------------------------------------------------------------------------
  // 3. Strategy 3 lookup: for each project, build a supplier->boqItemId map
  //    by inverting SUPPLIER_CODE_MAP through the project's BOQ code index
  // -------------------------------------------------------------------------
  // supplierCandidateMap[projectId][poCode] = boqItemId | null
  //   We pre-compute which PO codes each supplier code maps to so the inner
  //   loop is O(1) per PO item.

  /**
   * Given a project's code map and a list of candidate FibreFlow codes,
   * return the first boqItemId that matches (or null).
   * @param {Map<string, string[]>} codeMap
   * @param {string[]} candidates
   * @returns {string | null}
   */
  function findInCodeMap(codeMap, candidates) {
    for (const candidate of candidates) {
      const ids = codeMap.get(normalise(candidate));
      if (ids && ids.length > 0) return ids[0];
    }
    return null;
  }

  // -------------------------------------------------------------------------
  // 4. Match each PO item
  // -------------------------------------------------------------------------
  /** @type {{ poiId: string, boqItemId: string, strategy: string, poCode: string, boqCode: string, projectName: string }[]} */
  const matches = [];
  /** @type {{ poiId: string, poCode: string, projectName: string }[]} */
  const noMatches = [];

  for (const poi of filteredPoItems) {
    const poCode = normalise(poi.item_description || poi.item_code || '');
    const projectId = poi.project_id;
    const codeMap = boqByProject.get(projectId);

    if (!poCode) {
      noMatches.push({ poiId: poi.poi_id, poCode: '(empty)', projectName: poi.project_name });
      continue;
    }

    if (!codeMap) {
      noMatches.push({ poiId: poi.poi_id, poCode, projectName: poi.project_name });
      continue;
    }

    // S1: Exact match (belt-and-suspenders — should already be linked)
    const s1 = findInCodeMap(codeMap, [poCode]);
    if (s1) {
      matches.push({
        poiId: poi.poi_id,
        boqItemId: s1,
        strategy: 'S1-exact',
        poCode,
        boqCode: poCode,
        projectName: poi.project_name,
      });
      continue;
    }

    // S2: Prefix normalization
    const s2candidates = getCandidateCodes(poCode);
    const s2 = findInCodeMap(codeMap, s2candidates);
    if (s2) {
      const matchedCode = s2candidates.find((c) => codeMap.has(normalise(c)));
      matches.push({
        poiId: poi.poi_id,
        boqItemId: s2,
        strategy: 'S2-prefix',
        poCode,
        boqCode: matchedCode || '',
        projectName: poi.project_name,
      });
      continue;
    }

    // S3: Supplier code mapping
    // Check if ANY supplier code maps to this PO code
    let s3match = null;
    let s3supplierCode = '';
    for (const [supplierCode, fiberflowCodes] of Object.entries(SUPPLIER_CODE_MAP)) {
      // See if this supplierCode exists in the project BOQ
      const supplierBoqIds = codeMap.get(normalise(supplierCode));
      if (!supplierBoqIds || supplierBoqIds.length === 0) continue;

      // See if our PO code is in the FibreFlow candidates for this supplier code
      const normCandidates = fiberflowCodes.map(normalise);
      if (normCandidates.includes(poCode)) {
        s3match = supplierBoqIds[0];
        s3supplierCode = supplierCode;
        break;
      }
    }

    if (s3match) {
      matches.push({
        poiId: poi.poi_id,
        boqItemId: s3match,
        strategy: 'S3-supplier',
        poCode,
        boqCode: s3supplierCode,
        projectName: poi.project_name,
      });
      continue;
    }

    noMatches.push({ poiId: poi.poi_id, poCode, projectName: poi.project_name });
  }

  // -------------------------------------------------------------------------
  // 5. Print report
  // -------------------------------------------------------------------------
  const byStrategy = { 'S1-exact': 0, 'S2-prefix': 0, 'S3-supplier': 0 };
  /** @type {Map<string, number>} */
  const byProject = new Map();

  for (const m of matches) {
    byStrategy[m.strategy] = (byStrategy[m.strategy] || 0) + 1;
    byProject.set(m.projectName, (byProject.get(m.projectName) || 0) + 1);
  }

  process.stdout.write('=== MATCHES ===\n');
  for (const m of matches) {
    process.stdout.write(
      '[' + m.strategy + '] ' +
      m.projectName.padEnd(16) + ' | ' +
      m.poCode.padEnd(40) + ' -> ' +
      m.boqCode + '\n'
    );
  }

  process.stdout.write('\n=== UNMATCHED PO ITEMS ===\n');
  const unmatchedByProject = new Map();
  for (const n of noMatches) {
    process.stdout.write(
      n.projectName.padEnd(16) + ' | ' + n.poCode + '\n'
    );
    unmatchedByProject.set(n.projectName, (unmatchedByProject.get(n.projectName) || 0) + 1);
  }

  process.stdout.write('\n=== SUMMARY ===\n');
  process.stdout.write('Total unlinked PO items scanned : ' + filteredPoItems.length + '\n');
  process.stdout.write('Matched                         : ' + matches.length + '\n');
  process.stdout.write('  S1 (exact)                    : ' + (byStrategy['S1-exact'] || 0) + '\n');
  process.stdout.write('  S2 (prefix normalization)     : ' + (byStrategy['S2-prefix'] || 0) + '\n');
  process.stdout.write('  S3 (supplier code map)        : ' + (byStrategy['S3-supplier'] || 0) + '\n');
  process.stdout.write('No match                        : ' + noMatches.length + '\n\n');

  process.stdout.write('--- Matches by project ---\n');
  for (const [proj, cnt] of [...byProject.entries()].sort()) {
    process.stdout.write('  ' + proj.padEnd(20) + ' : ' + cnt + '\n');
  }

  process.stdout.write('\n--- Unmatched by project ---\n');
  for (const [proj, cnt] of [...unmatchedByProject.entries()].sort()) {
    process.stdout.write('  ' + proj.padEnd(20) + ' : ' + cnt + '\n');
  }

  // -------------------------------------------------------------------------
  // 6. Apply updates if --apply flag was set
  // -------------------------------------------------------------------------
  if (!APPLY) {
    process.stdout.write('\nDry run complete. Pass --apply to write these links to the database.\n');
    return;
  }

  if (matches.length === 0) {
    process.stdout.write('\nNothing to apply.\n');
    return;
  }

  process.stdout.write('\n=== APPLYING ' + matches.length + ' UPDATES ===\n');

  let applied = 0;
  let failed = 0;

  for (const m of matches) {
    try {
      await sql`
        UPDATE purchase_order_items
        SET boq_item_id = ${m.boqItemId}::uuid
        WHERE id = ${m.poiId}::uuid
          AND boq_item_id IS NULL
      `;
      applied++;
    } catch (err) {
      failed++;
      process.stdout.write(
        'FAILED: ' + m.poiId + ' (' + m.poCode + '): ' + String(err.message) + '\n'
      );
    }
  }

  process.stdout.write('\nApplied : ' + applied + '\n');
  process.stdout.write('Failed  : ' + failed + '\n');
  process.stdout.write('Done.\n');
}

main().catch((err) => {
  process.stderr.write('Fatal: ' + String(err.message || err) + '\n');
  process.exit(1);
});
