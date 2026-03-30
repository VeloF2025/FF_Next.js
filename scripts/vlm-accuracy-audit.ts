/**
 * VLM Accuracy Audit & Prompt Self-Tuning
 *
 * Queries the latest HITL correction data and updates VLM prompts
 * with current confusion pair statistics. Run manually or on a weekly cron.
 *
 * Usage:
 *   npx tsx scripts/vlm-accuracy-audit.ts          # dry-run (report only)
 *   npx tsx scripts/vlm-accuracy-audit.ts --apply   # update prompt files
 *
 * What it does:
 * 1. Pulls confusion matrix from vlm_corrections (construction QA)
 * 2. Pulls confusion matrix from qa_correction_examples (activate/DR photos)
 * 3. Compares with hardcoded stats in prompt source files
 * 4. Generates accuracy report
 * 5. Optionally updates the prompt files with fresh stats
 */

import { neon } from '@neondatabase/serverless';
import * as fs from 'fs';
import * as path from 'path';

// Load DB connection
const envPath = path.join(__dirname, '..', '.env.local');
let dbUrl = process.env.DATABASE_URL;
if (!dbUrl && fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  const match = envContent.match(/DATABASE_URL=(.+)/);
  if (match) dbUrl = match[1].trim();
}
if (!dbUrl) {
  console.error('DATABASE_URL not found');
  process.exit(1);
}

const sql = neon(dbUrl);
const applyChanges = process.argv.includes('--apply');

const ROOT = path.join(__dirname, '..');
const CQA_SERVICE = path.join(ROOT, 'src/modules/construction-qa/services/vlmConstructionService.ts');
const ACTIVATE_LEARNING = path.join(ROOT, 'src/modules/qa-learning/types/learning.types.ts');

interface ConfusionPair {
  from_step: string;
  to_step: string;
  count: number;
}

// ============================================================================
// DATA QUERIES
// ============================================================================

async function getConstructionQaConfusion(): Promise<{
  total: number;
  pairs: ConfusionPair[];
  unrelatedErrors: number;
  unrelatedPct: number;
}> {
  const totals = await sql`
    SELECT COUNT(*) as total
    FROM vlm_corrections
    WHERE module = 'construction_qa'
  `;
  const total = Number(totals[0].total);

  const pairs = await sql`
    SELECT
      vlm_extracted_value as from_step,
      corrected_value as to_step,
      COUNT(*) as count
    FROM vlm_corrections
    WHERE module = 'construction_qa'
    GROUP BY vlm_extracted_value, corrected_value
    ORDER BY count DESC
    LIMIT 10
  `;

  // Count "Unrelated" errors (VLM said 0 but human said something else)
  const unrelatedResult = await sql`
    SELECT COUNT(*) as count
    FROM vlm_corrections
    WHERE module = 'construction_qa'
      AND vlm_extracted_value LIKE '0 -%'
  `;
  const unrelatedErrors = Number(unrelatedResult[0].count);

  return {
    total,
    pairs: pairs.map((r) => ({
      from_step: String(r.from_step),
      to_step: String(r.to_step),
      count: Number(r.count),
    })),
    unrelatedErrors,
    unrelatedPct: total > 0 ? Math.round((unrelatedErrors / total) * 100) : 0,
  };
}

async function getActivateConfusion(): Promise<{
  total: number;
  pairs: ConfusionPair[];
}> {
  const totals = await sql`
    SELECT COUNT(*) as total
    FROM qa_correction_examples
    WHERE workflow_type = 'dr_photo'
  `;
  const total = Number(totals[0].total);

  const pairs = await sql`
    SELECT
      vlm_predicted_step::text as from_step,
      correct_step::text as to_step,
      COUNT(*) as count
    FROM qa_correction_examples
    WHERE workflow_type = 'dr_photo'
    GROUP BY vlm_predicted_step, correct_step
    ORDER BY count DESC
    LIMIT 10
  `;

  return {
    total,
    pairs: pairs.map((r) => ({
      from_step: String(r.from_step),
      to_step: String(r.to_step),
      count: Number(r.count),
    })),
  };
}

async function getAccuracyTrend(): Promise<Array<{ week: string; corrections: number }>> {
  const rows = await sql`
    SELECT
      DATE_TRUNC('week', created_at)::date::text as week,
      COUNT(*) as corrections
    FROM vlm_corrections
    WHERE module = 'construction_qa'
      AND created_at > NOW() - INTERVAL '8 weeks'
    GROUP BY DATE_TRUNC('week', created_at)
    ORDER BY week ASC
  `;
  return rows.map((r) => ({ week: String(r.week), corrections: Number(r.corrections) }));
}

// ============================================================================
// PROMPT UPDATE — CONSTRUCTION QA
// ============================================================================

function updateConstructionQaPrompt(data: {
  total: number;
  pairs: ConfusionPair[];
  unrelatedPct: number;
}): boolean {
  if (!fs.existsSync(CQA_SERVICE)) {
    console.error(`  File not found: ${CQA_SERVICE}`);
    return false;
  }

  let content = fs.readFileSync(CQA_SERVICE, 'utf8');
  const originalContent = content;

  // Update total corrections count
  // Pattern: "Based on NNNN human corrections"
  content = content.replace(
    /Based on \d+ human corrections, \d+% of all VLM errors/,
    `Based on ${data.total} human corrections, ${data.unrelatedPct}% of all VLM errors`
  );

  // Update "from NNNN human corrections" in the TOP CONFUSION PAIRS header
  content = content.replace(
    /TOP CONFUSION PAIRS \(from \d+ human corrections/,
    `TOP CONFUSION PAIRS (from ${data.total} human corrections`
  );

  // Update individual confusion pair counts
  // Pattern: "During (2) vs Compaction (5): NNN errors"
  const pairPatterns: Array<{ regex: RegExp; pair: ConfusionPair | undefined }> = [
    {
      regex: /During \(2\) vs Compaction \(5\): \d+ errors/,
      pair: data.pairs.find((p) => p.from_step.includes('2') && p.to_step.includes('5')),
    },
    {
      regex: /Unrelated \(0\) vs End Plates \(4\): \d+ errors/,
      pair: data.pairs.find((p) => p.from_step.includes('0') && p.to_step.includes('4')),
    },
    {
      regex: /Unrelated \(0\) vs Before Photo \(1\): \d+ errors/,
      pair: data.pairs.find((p) => p.from_step.includes('0') && p.to_step.includes('1')),
    },
    {
      regex: /Compaction \(5\) vs End Plates \(4\): \d+ errors/,
      pair: data.pairs.find((p) => p.from_step.includes('5') && p.to_step.includes('4')),
    },
    {
      regex: /Unrelated \(0\) vs After Photo \(7\): \d+ errors/,
      pair: data.pairs.find((p) => p.from_step.includes('0') && p.to_step.includes('7')),
    },
    {
      regex: /During \(2\) vs After Photo \(7\): \d+ errors/,
      pair: data.pairs.find((p) => p.from_step.includes('2') && p.to_step.includes('7')),
    },
  ];

  for (const { regex, pair } of pairPatterns) {
    if (pair) {
      content = content.replace(regex, (match) =>
        match.replace(/\d+ errors/, `${pair.count} errors`)
      );
    }
  }

  // Also update "most confused pair — NNN errors" in the DURING vs COMPACTION section
  const duringCompaction = data.pairs.find((p) => p.from_step.includes('2') && p.to_step.includes('5'));
  if (duringCompaction) {
    content = content.replace(
      /most confused pair — \d+ errors/,
      `most confused pair — ${duringCompaction.count} errors`
    );
  }

  if (content === originalContent) {
    console.log('  Construction QA prompt: no changes needed');
    return false;
  }

  if (applyChanges) {
    fs.writeFileSync(CQA_SERVICE, content, 'utf8');
    console.log('  Construction QA prompt: UPDATED');
  } else {
    console.log('  Construction QA prompt: changes detected (dry-run, use --apply to write)');
  }
  return true;
}

// ============================================================================
// CONFUSION PAIRS UPDATE — ACTIVATE
// ============================================================================

function updateActivateConfusionPairs(data: {
  pairs: ConfusionPair[];
}): boolean {
  if (!fs.existsSync(ACTIVATE_LEARNING)) {
    console.error(`  File not found: ${ACTIVATE_LEARNING}`);
    return false;
  }

  // Find top pairs with >= 5 corrections
  const significantPairs = data.pairs
    .filter((p) => p.count >= 5)
    .slice(0, 6);

  if (significantPairs.length === 0) {
    console.log('  Activate confusion pairs: insufficient data');
    return false;
  }

  const content = fs.readFileSync(ACTIVATE_LEARNING, 'utf8');

  // Extract current pairs from the file
  const currentPairsMatch = content.match(
    /export const DR_PHOTO_CONFUSION_PAIRS.*?\[([\s\S]*?)\];/
  );

  if (!currentPairsMatch) {
    console.log('  Activate confusion pairs: pattern not found in file');
    return false;
  }

  // Parse current pairs
  const currentPairStrings = currentPairsMatch[1].match(/\[(\d+),\s*(\d+)\]/g) || [];
  const currentPairs = new Set(currentPairStrings.map((s) => s.replace(/\s/g, '')));

  // Build new pairs set from data
  const newPairEntries = significantPairs.map((p) => {
    const from = parseInt(p.from_step) || 0;
    const to = parseInt(p.to_step) || 0;
    return [Math.min(from, to), Math.max(from, to)] as [number, number];
  });

  // Deduplicate
  const uniqueNew = new Map<string, [number, number]>();
  for (const [a, b] of newPairEntries) {
    if (a === b || a < 0 || b < 0) continue;
    const key = `[${a},${b}]`;
    if (!uniqueNew.has(key)) uniqueNew.set(key, [a, b]);
  }

  // Check for new pairs not in current set
  const missing: Array<{ pair: string; count: number }> = [];
  for (const p of significantPairs) {
    const from = parseInt(p.from_step) || 0;
    const to = parseInt(p.to_step) || 0;
    const a = Math.min(from, to);
    const b = Math.max(from, to);
    if (a === b || a < 0 || b < 0) continue;
    const key = `[${a},${b}]`;
    if (!currentPairs.has(key)) {
      missing.push({ pair: key, count: p.count });
    }
  }

  if (missing.length === 0) {
    console.log('  Activate confusion pairs: all top pairs already registered');
    return false;
  }

  console.log(`  Activate confusion pairs: ${missing.length} new pair(s) found:`);
  for (const m of missing) {
    console.log(`    ${m.pair} (${m.count} corrections)`);
  }
  console.log('  → Add manually if significant. Auto-update skipped to avoid breaking comments.');
  return false;
}

// ============================================================================
// REPORT
// ============================================================================

function printReport(
  cqa: Awaited<ReturnType<typeof getConstructionQaConfusion>>,
  activate: Awaited<ReturnType<typeof getActivateConfusion>>,
  trend: Awaited<ReturnType<typeof getAccuracyTrend>>
) {
  console.log('\n' + '='.repeat(70));
  console.log('  VLM ACCURACY AUDIT REPORT');
  console.log('  ' + new Date().toISOString().split('T')[0]);
  console.log('='.repeat(70));

  console.log('\n── CONSTRUCTION QA (Pole Installations) ──');
  console.log(`  Total corrections: ${cqa.total}`);
  console.log(`  Unrelated misclassification rate: ${cqa.unrelatedPct}%`);
  console.log('  Top confusion pairs:');
  for (const p of cqa.pairs.slice(0, 6)) {
    const pct = cqa.total > 0 ? Math.round((p.count / cqa.total) * 100) : 0;
    console.log(`    ${p.from_step} → ${p.to_step}: ${p.count} (${pct}%)`);
  }

  console.log('\n── ACTIVATE (DR Photo Categorization) ──');
  console.log(`  Total corrections: ${activate.total}`);
  console.log('  Top confusion pairs:');
  for (const p of activate.pairs.slice(0, 6)) {
    const pct = activate.total > 0 ? Math.round((p.count / activate.total) * 100) : 0;
    console.log(`    Step ${p.from_step} → Step ${p.to_step}: ${p.count} (${pct}%)`);
  }

  console.log('\n── WEEKLY TREND (Construction QA) ──');
  for (const t of trend) {
    const bar = '█'.repeat(Math.min(Math.round(t.corrections / 10), 40));
    console.log(`  ${t.week}: ${String(t.corrections).padStart(4)} ${bar}`);
  }

  console.log('\n' + '='.repeat(70));
}

// ============================================================================
// MAIN
// ============================================================================

async function main() {
  console.log(`VLM Accuracy Audit ${applyChanges ? '(APPLY MODE)' : '(DRY RUN)'}`);
  console.log('Querying correction data...\n');

  const [cqa, activate, trend] = await Promise.all([
    getConstructionQaConfusion(),
    getActivateConfusion(),
    getAccuracyTrend(),
  ]);

  // Print report
  printReport(cqa, activate, trend);

  // Update prompts
  console.log('\n── PROMPT UPDATES ──');
  const cqaChanged = updateConstructionQaPrompt(cqa);
  updateActivateConfusionPairs(activate);

  if (applyChanges && cqaChanged) {
    console.log('\n✓ Prompt files updated. Run `git diff` to review changes.');
  } else if (!applyChanges) {
    console.log('\nDry run complete. Use --apply to write changes.');
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
