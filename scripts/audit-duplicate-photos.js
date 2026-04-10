#!/usr/bin/env node
/**
 * Duplicate Photo Audit Script
 *
 * Detects photos reused across multiple DRs in the Activate QA Centre.
 *
 * Two modes:
 *   Default     — pre-filter by file size from DB metadata, download only size-matched
 *                 candidates (fast, works from any machine with proxy access)
 *   --full-scan — download ALL photos (use on Velocity server where :8003 is localhost)
 *
 * Usage:
 *   DATABASE_URL='...' node scripts/audit-duplicate-photos.js
 *   DATABASE_URL='...' node scripts/audit-duplicate-photos.js --full-scan
 *   DATABASE_URL='...' node scripts/audit-duplicate-photos.js --full-scan --skip-vlm
 *   DATABASE_URL='...' node scripts/audit-duplicate-photos.js --skip-vlm
 *   DATABASE_URL='...' node scripts/audit-duplicate-photos.js --use-proxy
 *   DATABASE_URL='...' node scripts/audit-duplicate-photos.js --limit 200
 *   DATABASE_URL='...' node scripts/audit-duplicate-photos.js --project "Sonstraal"
 *
 * --full-scan  Download ALL photos (not just size-matched candidates). Run this on the
 *              Velocity server (100.96.203.105) where photo API is on localhost:8003.
 *              Automatically uses concurrency=50 and timeout=5s.
 * --use-proxy  Route photo downloads through dev.fibreflow.app (use when
 *              Velocity server is not directly reachable)
 *
 * Output: reports/duplicate-photo-audit-YYYY-MM-DD.md
 */
'use strict';

const { neon } = require('@neondatabase/serverless');
const crypto = require('crypto');
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

// ─── Config ───────────────────────────────────────────────────────────────────
const ONEMAP_DIRECT  = 'http://100.96.203.105:8003';
const ONEMAP_PROXY   = 'https://dev.fibreflow.app';
const WA_PHOTO_BASE  = 'http://72.61.197.178:8866';
const WA_PATH_PFX    = '/var/lib/docker/volumes/boss-vps_dr_photos/_data/';
const VLM_URL        = 'http://100.96.203.105:8100/v1/chat/completions';
const VLM_MODEL      = 'QuantTrio/Qwen3-VL-30B-A3B-Instruct-AWQ';
const VLM_CONCURRENCY= 2;
// Concurrency / timeout adjusted per-mode in main()
const VLM_TIMEOUT    = 60_000;
const DHASH_HIGH     = 10;   // ≤ this = HIGH confidence duplicate
const DHASH_BORDER   = 15;   // ≤ this = BORDERLINE (VLM decides)

// ─── CLI Args ─────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const getArg = (f) => { const i = args.indexOf(f); return i !== -1 ? args[i + 1] : null; };
const PROJECT   = getArg('--project');
const LIMIT     = getArg('--limit') ? parseInt(getArg('--limit')) : null;
const SKIP_VLM  = args.includes('--skip-vlm');
const USE_PROXY = args.includes('--use-proxy');
const FULL_SCAN = args.includes('--full-scan');

// In full-scan mode use server-optimised settings (direct localhost access)
const DL_CONCURRENCY = FULL_SCAN ? 50 : 10;
const PHOTO_TIMEOUT  = FULL_SCAN ? 5_000 : 10_000;

if (!process.env.DATABASE_URL) { console.error('ERROR: DATABASE_URL required'); process.exit(1); }
const sql = neon(process.env.DATABASE_URL);

// ─── Hashing ──────────────────────────────────────────────────────────────────
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

async function dHash(buf) {
  try {
    const { data } = await sharp(buf)
      .resize(9, 8, { fit: 'fill' }).greyscale().raw()
      .toBuffer({ resolveWithObject: true });
    let h = '';
    for (let y = 0; y < 8; y++)
      for (let x = 0; x < 8; x++)
        h += data[y * 9 + x] < data[y * 9 + x + 1] ? '1' : '0';
    return h;
  } catch { return null; }
}

const hamming = (a, b) => (!a || !b || a.length !== b.length) ? 999
  : [...a].reduce((d, c, i) => d + (c !== b[i] ? 1 : 0), 0);

// ─── Photo URLs ───────────────────────────────────────────────────────────────
function photoUrl(filename, drNumber, localPath) {
  if (localPath) {
    const p = localPath.replace(WA_PATH_PFX, `/photos/${drNumber}/`);
    return `${WA_PHOTO_BASE}${p}`;
  }
  if (filename?.startsWith('wa_')) return `${WA_PHOTO_BASE}/photos/${drNumber}/${filename}`;
  const base = USE_PROXY ? ONEMAP_PROXY : ONEMAP_DIRECT;
  return USE_PROXY
    ? `${base}/api/activate/photo/${drNumber}/${filename}`
    : `${base}/api/photo/${drNumber}/${filename}`;
}

// ─── Download ─────────────────────────────────────────────────────────────────
async function download(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), PHOTO_TIMEOUT);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    return buf.length > 0 ? buf : null;
  } catch { return null; }
  finally { clearTimeout(t); }
}

async function withConcurrency(items, fn, limit) {
  const out = [];
  for (let i = 0; i < items.length; i += limit)
    out.push(...await Promise.all(items.slice(i, i + limit).map(fn)));
  return out;
}

// ─── VLM ──────────────────────────────────────────────────────────────────────
async function vlmResize(buf) {
  return sharp(buf).resize(1280, 960, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 85 }).toBuffer();
}

async function vlmCall(messages) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), VLM_TIMEOUT);
  try {
    const res = await fetch(VLM_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: VLM_MODEL, messages, max_tokens: 200, temperature: 0.1 }),
      signal: ctrl.signal,
    });
    const d = await res.json();
    return d?.choices?.[0]?.message?.content?.trim() || '';
  } catch { return ''; }
  finally { clearTimeout(t); }
}

async function vlmDescribe(buf) {
  const b64 = (await vlmResize(buf)).toString('base64');
  return vlmCall([{ role: 'user', content: [
    { type: 'text', text: 'Describe this fiber installation photo in 2 sentences. What is shown? What physical location or equipment is visible?' },
    { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${b64}` } },
  ]}]);
}

async function vlmVerify(buf1, buf2) {
  const [r1, r2] = await Promise.all([vlmResize(buf1), vlmResize(buf2)]);
  return vlmCall([{ role: 'user', content: [
    { type: 'text', text: 'Are these two photos showing the same physical location or equipment? Answer YES or NO, then explain in one sentence.' },
    { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${r1.toString('base64')}` } },
    { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${r2.toString('base64')}` } },
  ]}]);
}

// ─── Grouping ─────────────────────────────────────────────────────────────────
const STEP_NAMES = { 1:'House Photo',2:'Cable from Pole',3:'Entry Outside',4:'Entry Inside',
  5:'Wall',6:'ONT Back',7:'Power Meter',8:'Final Installation',9:'Green Lights',10:'Signature' };

function groupExact(photos) {
  const map = {};
  for (const p of photos) {
    if (!p.hash) continue;
    (map[p.hash] ??= []).push(p);
  }
  return Object.values(map)
    .filter(g => new Set(g.map(p => p.drNumber)).size >= 2)
    .map(g => ({ photos: g }));
}

function findPairs(photos, exactHashes) {
  const cands = photos.filter(p => p.dhash && !exactHashes.has(p.hash));
  const byStep = {};
  for (const p of cands) (byStep[p.step ?? 'x'] ??= []).push(p);

  const pairs = [];
  for (const bucket of Object.values(byStep)) {
    for (let i = 0; i < bucket.length; i++) {
      for (let j = i + 1; j < bucket.length; j++) {
        const [a, b] = [bucket[i], bucket[j]];
        if (a.drNumber === b.drNumber) continue;
        const dist = hamming(a.dhash, b.dhash);
        if (dist <= DHASH_BORDER)
          pairs.push({ photos: [a, b], dist, confidence: dist <= DHASH_HIGH ? 'HIGH' : 'BORDERLINE' });
      }
    }
  }
  return pairs;
}

// ─── Report ───────────────────────────────────────────────────────────────────
const fmtDate = (d) => d ? new Date(d).toISOString().split('T')[0] : '—';
const stepLabel = (s) => s ? `${s} — ${STEP_NAMES[s] || '?'}` : '—';
const photoRow = (p) => `| ${p.drNumber} | ${p.project || '—'} | ${fmtDate(p.date)} | ${p.source} | ${stepLabel(p.step)} |`;

function buildReport({ totalDrs, totalPhotos, candidates, failed, fullScan, exact, perceptual }) {
  const today = new Date().toISOString().split('T')[0];
  const exactDrs   = new Set(exact.flatMap(g => g.photos.map(p => p.drNumber)));
  const percepDrs  = new Set(perceptual.flatMap(g => g.photos.map(p => p.drNumber)));
  const allAffected = new Set([...exactDrs, ...percepDrs]);

  let md = `# Duplicate Photo Audit\n\n`;
  md += `**Generated:** ${today}  \n`;
  md += `**Scope:** All time — OneMap + WhatsApp photos  \n`;
  md += `**Scan mode:** ${fullScan ? 'Full scan (all photos)' : 'Size pre-filter (candidates only)'}  \n`;
  if (PROJECT)  md += `**Project filter:** ${PROJECT}  \n`;
  if (SKIP_VLM) md += `**VLM:** Skipped (hash-only run)  \n`;
  md += `\n`;
  md += `**DRs scanned:** ${totalDrs.toLocaleString()}  \n`;
  md += `**Total photos in DB:** ${totalPhotos.toLocaleString()}  \n`;
  if (fullScan) {
    md += `**Photos downloaded:** ${candidates.toLocaleString()}  \n`;
  } else {
    md += `**Size-matched candidates downloaded:** ${candidates.toLocaleString()}  \n`;
  }
  if (failed > 0) md += `**Download failures:** ${failed.toLocaleString()}  \n`;
  md += `\n---\n\n## Summary\n\n`;
  md += `| Category | Groups | DRs Affected |\n|---|---|---|\n`;
  md += `| ⚠️ Exact duplicates (same file) | ${exact.length} | ${exactDrs.size} |\n`;
  md += `| 🔍 Perceptual duplicates (same scene) | ${perceptual.length} | ${percepDrs.size} |\n`;
  md += `| **Total DRs with suspicious photos** | **—** | **${allAffected.size}** |\n\n`;

  if (allAffected.size === 0) { md += `> ✅ No duplicate photos detected.\n`; return md; }

  const HDR = `| DR Number | Project | Date | Source | Step |\n|---|---|---|---|---|`;

  if (exact.length > 0) {
    md += `---\n\n## ⚠️ Exact Duplicate Groups (SHA256 Match)\n`;
    md += `*These photos are byte-for-byte identical — the same file was submitted for multiple DRs.*\n\n`;
    exact.forEach((g, i) => {
      const rep = g.photos[0];
      md += `### Group ${i + 1} — Step ${stepLabel(rep.step)}\n`;
      md += `**SHA256:** \`${rep.hash.slice(0, 20)}...\`  \n`;
      if (g.vlmDesc) md += `**VLM Description:** ${g.vlmDesc}  \n`;
      md += `\n${HDR}\n${g.photos.map(photoRow).join('\n')}\n\n`;
    });
  }

  if (perceptual.length > 0) {
    md += `---\n\n## 🔍 Perceptual Duplicate Groups (Same Scene)\n`;
    md += `*Visually similar photos — same scene photographed for different DRs.*\n\n`;
    perceptual.forEach((g, i) => {
      const rep = g.photos[0];
      const n = exact.length + i + 1;
      md += `### Group ${n} — Step ${stepLabel(rep.step)} — ${g.confidence} (Hamming: ${g.dist})\n`;
      if (g.vlmDesc)   md += `**VLM Description:** ${g.vlmDesc}  \n`;
      if (g.vlmVerify) md += `**VLM Verification:** ${g.vlmVerify}  \n`;
      md += `\n${HDR}\n${g.photos.map(photoRow).join('\n')}\n\n`;
    });
  }

  return md;
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║        DUPLICATE PHOTO AUDIT — Activate QA Centre           ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');
  console.log(`Timestamp  : ${new Date().toISOString()}`);
  console.log(`Mode       : ${FULL_SCAN ? 'FULL SCAN (all photos)' : 'size pre-filter (candidates only)'}`);
  console.log(`Photo route: ${USE_PROXY ? 'proxy (dev.fibreflow.app)' : 'direct (100.96.203.105:8003)'}`);
  console.log(`Concurrency: ${DL_CONCURRENCY} | Timeout: ${PHOTO_TIMEOUT / 1000}s`);
  if (PROJECT)  console.log(`Project    : ${PROJECT}`);
  if (LIMIT)    console.log(`DR limit   : ${LIMIT}`);
  if (SKIP_VLM) console.log(`VLM        : skipped`);
  console.log('');

  // ── Phase 1: Query DB (+ optional size pre-filter) ──────────────────────────
  console.log(`Phase 1 — Querying database${FULL_SCAN ? '' : ' & pre-filtering by size'}...`);

  const oneMapRows = PROJECT
    ? await sql`SELECT drop_number,project,submitted_date,photos_metadata
                FROM dr_photo_unified_reviews
                WHERE photos_metadata IS NOT NULL AND photo_count > 0 AND project = ${PROJECT}
                ORDER BY submitted_date LIMIT ${LIMIT ?? 999999}`
    : await sql`SELECT drop_number,project,submitted_date,photos_metadata
                FROM dr_photo_unified_reviews
                WHERE photos_metadata IS NOT NULL AND photo_count > 0
                ORDER BY submitted_date LIMIT ${LIMIT ?? 999999}`;

  const waRows = await sql`
    SELECT drop_number, original_filename, local_path, message_timestamp
    FROM wa_photos WHERE purpose = 'activation' AND local_path IS NOT NULL`;

  // Build flat list with size metadata
  const seen = new Set();
  const allPhotos = [];
  let uid = 0;

  for (const row of oneMapRows) {
    const meta = Array.isArray(row.photos_metadata) ? row.photos_metadata
      : (typeof row.photos_metadata === 'string' ? JSON.parse(row.photos_metadata) : []);
    for (const ph of meta) {
      if (!ph?.filename) continue;
      const key = `${row.drop_number}:${ph.filename}`;
      if (seen.has(key)) continue;
      seen.add(key);
      allPhotos.push({ id: uid++, drNumber: row.drop_number, project: row.project,
        date: row.submitted_date, filename: ph.filename, step: ph.step,
        size: ph.size || null, source: ph.filename.startsWith('wa_') ? 'WhatsApp' : 'OneMap',
        url: photoUrl(ph.filename, row.drop_number, null) });
    }
  }

  const drSet = new Set(oneMapRows.map(r => r.drop_number));
  for (const row of waRows) {
    if (!drSet.has(row.drop_number)) continue;
    const key = `${row.drop_number}:${row.original_filename}`;
    if (seen.has(key)) continue;
    seen.add(key);
    allPhotos.push({ id: uid++, drNumber: row.drop_number, project: null,
      date: row.message_timestamp, filename: row.original_filename, step: null,
      size: null, source: 'WhatsApp', url: photoUrl(row.original_filename, row.drop_number, row.local_path) });
  }

  const totalDrs = new Set(allPhotos.map(p => p.drNumber)).size;
  console.log(`  ${totalDrs} DRs | ${allPhotos.length} photos in DB`);

  let candidates;
  let sizeMatchGroups = 0;

  if (FULL_SCAN) {
    // Full scan: download every photo — most thorough, run on Velocity server
    candidates = allPhotos;
    console.log(`  Full scan: ${candidates.length} photos queued for download`);
  } else {
    // Pre-filter: group by (step, size) — only download photos sharing a size with another DR
    const sizeGroups = {};
    let noSize = 0;
    for (const p of allPhotos) {
      if (!p.size) { noSize++; continue; }
      const key = `${p.step ?? 'x'}:${p.size}`;
      (sizeGroups[key] ??= []).push(p);
    }
    candidates = [];
    for (const group of Object.values(sizeGroups)) {
      const drs = new Set(group.map(p => p.drNumber));
      if (drs.size >= 2) { candidates.push(...group); sizeMatchGroups++; }
    }
    console.log(`  Size-matched candidates: ${candidates.length} photos across ${sizeMatchGroups} size groups`);
    if (noSize > 0) console.log(`  Photos without size metadata (skipped): ${noSize}`);
  }
  console.log('');

  if (candidates.length === 0) {
    console.log('No candidates found — no duplicates possible.');
    const md = buildReport({ totalDrs, totalPhotos: allPhotos.length, candidates: 0, failed: 0,
      fullScan: FULL_SCAN, exact: [], perceptual: [] });
    const reportsDir = path.join(__dirname, '..', 'reports');
    if (!fs.existsSync(reportsDir)) fs.mkdirSync(reportsDir, { recursive: true });
    const today = new Date().toISOString().split('T')[0];
    const out = path.join(reportsDir, `duplicate-photo-audit-${today}.md`);
    fs.writeFileSync(out, md, 'utf8');
    console.log(`✓ Report: ${out}`);
    return;
  }

  // ── Phase 2: Download & hash ───────────────────────────────────────────────
  const phase2Label = FULL_SCAN ? `all ${candidates.length} photos` : `${candidates.length} candidates`;
  console.log(`Phase 2 — Downloading ${phase2Label} (concurrency: ${DL_CONCURRENCY})...`);
  let done = 0, failed = 0;

  const hashed = await withConcurrency(candidates, async (p) => {
    const buf = await download(p.url);
    done++;
    const interval = FULL_SCAN ? 500 : 10;
    if (done % interval === 0 || done === candidates.length)
      process.stdout.write(`  ${done}/${candidates.length}...\r`);
    if (!buf) { failed++; return null; }
    // Skip dHash in full-scan mode — pairwise comparison is O(n²) on 100k+ photos
    const h = sha256(buf);
    const dh = FULL_SCAN ? null : await dHash(buf);
    return { ...p, hash: h, dhash: dh };
  }, DL_CONCURRENCY);

  const photos = hashed.filter(Boolean);
  console.log(`\n  Downloaded: ${photos.length} ok | Failed: ${failed}\n`);

  // ── Phase 3: Group duplicates ────────────────────────────────────────────
  console.log('Phase 3 — Finding duplicates...');
  const exactGroups = groupExact(photos);
  const exactHashes = new Set(exactGroups.flatMap(g => g.photos.map(p => p.hash)));

  // dHash pairwise comparison is O(n²) — only feasible on small candidate sets.
  // In full-scan mode (100k+ photos) skip it to avoid OOM; exact SHA256 catches fraud.
  let percepPairs = [];
  if (!FULL_SCAN) {
    percepPairs = findPairs(photos, exactHashes);
    console.log(`  Exact: ${exactGroups.length} groups | Perceptual: ${percepPairs.length} pairs\n`);
  } else {
    console.log(`  Exact: ${exactGroups.length} groups | Perceptual: skipped (full-scan mode)\n`);
  }

  // ── Phase 4: VLM ─────────────────────────────────────────────────────────
  if (!SKIP_VLM && (exactGroups.length + percepPairs.length > 0)) {
    const vlmable = [...exactGroups, ...percepPairs.filter(g => g.confidence === 'HIGH')];
    if (vlmable.length > 0) {
      console.log(`Phase 4 — VLM: describing ${vlmable.length} groups...`);
      let vd = 0;
      for (let i = 0; i < vlmable.length; i += VLM_CONCURRENCY) {
        await Promise.all(vlmable.slice(i, i + VLM_CONCURRENCY).map(async g => {
          const buf = await download(g.photos[0].url);
          if (buf) g.vlmDesc = await vlmDescribe(buf);
          process.stdout.write(`  ${++vd}/${vlmable.length}...\r`);
        }));
      }
      console.log('');
    }

    const borderline = percepPairs.filter(g => g.confidence === 'BORDERLINE');
    if (borderline.length > 0) {
      console.log(`  VLM: verifying ${borderline.length} borderline pairs...`);
      let vv = 0, confirmed = [];
      for (let i = 0; i < borderline.length; i += VLM_CONCURRENCY) {
        await Promise.all(borderline.slice(i, i + VLM_CONCURRENCY).map(async g => {
          const [b1, b2] = await Promise.all([download(g.photos[0].url), download(g.photos[1].url)]);
          if (b1 && b2) {
            g.vlmVerify = await vlmVerify(b1, b2);
            if (g.vlmVerify.toUpperCase().startsWith('YES')) confirmed.push(g);
          }
          process.stdout.write(`  ${++vv}/${borderline.length}...\r`);
        }));
      }
      percepPairs = [...percepPairs.filter(g => g.confidence === 'HIGH'), ...confirmed];
      console.log(`\n  Borderline confirmed: ${confirmed.length}/${borderline.length}\n`);
    }
  } else if (SKIP_VLM) {
    console.log('Phase 4 — VLM skipped\n');
  }

  // ── Phase 5: Report ────────────────────────────────────────────────────────
  console.log('Phase 5 — Writing report...');
  const md = buildReport({ totalDrs, totalPhotos: allPhotos.length, candidates: candidates.length,
    failed, fullScan: FULL_SCAN, exact: exactGroups, perceptual: percepPairs });

  const reportsDir = path.join(__dirname, '..', 'reports');
  if (!fs.existsSync(reportsDir)) fs.mkdirSync(reportsDir, { recursive: true });
  const today = new Date().toISOString().split('T')[0];
  const outFile = path.join(reportsDir, `duplicate-photo-audit-${today}.md`);
  fs.writeFileSync(outFile, md, 'utf8');

  const allAff = new Set([...exactGroups, ...percepPairs].flatMap(g => g.photos.map(p => p.drNumber)));
  console.log(`\n✓ Report: ${outFile}`);
  console.log(`\n${'═'.repeat(52)}`);
  console.log(`  DRs scanned              : ${totalDrs}`);
  console.log(`  Total photos in DB       : ${allPhotos.length}`);
  console.log(`  Photos downloaded        : ${candidates.length} ${FULL_SCAN ? '(full scan)' : '(size-matched)'}`);
  console.log(`  Exact duplicate groups   : ${exactGroups.length}`);
  console.log(`  Perceptual dup pairs     : ${percepPairs.length}`);
  console.log(`  Total DRs affected       : ${allAff.size}`);
  console.log(`${'═'.repeat(52)}\n`);
}

main().catch((err) => { console.error('FATAL:', err.message); process.exit(1); });
