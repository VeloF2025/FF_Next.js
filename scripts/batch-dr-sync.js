/**
 * Batch DR Sync Script
 *
 * Syncs the latest DRs from OneMap and tracks:
 * - Serial changes (ONT/UPS)
 * - Swap detections
 * - Installation mismatches
 * - Photo count changes
 *
 * Usage: node scripts/batch-dr-sync.js [limit]
 * Default limit: 100
 */

const { Pool, neonConfig } = require('@neondatabase/serverless');
const ws = require('ws');

neonConfig.webSocketConstructor = ws;

const ONEMAP_API = 'http://100.96.203.105:8003';
const LIMIT = parseInt(process.argv[2] || '100', 10);

// Serial pattern detection
function looksLikeOntSerial(serial) {
  if (!serial) return false;
  const normalized = serial.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return normalized.startsWith('ALCL') || normalized.startsWith('ALCB');
}

function looksLikeGizzuSerial(serial) {
  if (!serial) return false;
  const normalized = serial.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return normalized.startsWith('GU18W');
}

function detectSwappedSerials(ontSerial, upsSerial) {
  if (!ontSerial && !upsSerial) return { swapped: false, details: null };

  const ontLooksLikeGizzu = looksLikeGizzuSerial(ontSerial);
  const upsLooksLikeOnt = looksLikeOntSerial(upsSerial);

  if (ontLooksLikeGizzu && upsLooksLikeOnt) {
    return {
      swapped: true,
      details: `Serials appear SWAPPED: ONT field has Gizzu serial (${ontSerial}), UPS field has ONT serial (${upsSerial})`,
    };
  }

  if (ontLooksLikeGizzu && !upsLooksLikeOnt) {
    return {
      swapped: true,
      details: `ONT field contains Gizzu serial (${ontSerial}) instead of Nokia ONT serial`,
    };
  }

  if (upsLooksLikeOnt && !ontLooksLikeGizzu) {
    return {
      swapped: true,
      details: `UPS field contains Nokia ONT serial (${upsSerial}) instead of Gizzu serial`,
    };
  }

  return { swapped: false, details: null };
}

// Fuzzy serial match (allow 2 char difference)
function fuzzySerialMatch(serial1, serial2) {
  if (!serial1 || !serial2) return { isMatch: false, confidence: 0 };

  const s1 = serial1.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const s2 = serial2.toUpperCase().replace(/[^A-Z0-9]/g, '');

  if (s1 === s2) return { isMatch: true, confidence: 1.0 };

  // Levenshtein distance
  const matrix = [];
  for (let i = 0; i <= s1.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= s2.length; j++) {
    matrix[0][j] = j;
  }
  for (let i = 1; i <= s1.length; i++) {
    for (let j = 1; j <= s2.length; j++) {
      const cost = s1[i - 1] === s2[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
    }
  }

  const distance = matrix[s1.length][s2.length];
  const maxLen = Math.max(s1.length, s2.length);
  const confidence = maxLen > 0 ? 1 - distance / maxLen : 0;

  return {
    isMatch: distance <= 2 && confidence >= 0.8,
    confidence,
    distance,
  };
}

async function fetchOneMapData(dropNumber) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  try {
    const response = await fetch(
      `${ONEMAP_API}/api/record/${dropNumber}`,
      { signal: controller.signal }
    );
    clearTimeout(timeout);

    if (!response.ok) {
      if (response.status === 404 || response.status === 422) {
        return { notFound: true };
      }
      return null;
    }
    const data = await response.json();

    // Parse ONT serial from barcode
    let ontSerial = null;
    if (data.ont_barcode) {
      const match = data.ont_barcode.match(/\(S\)([^(]+)/);
      if (match) {
        ontSerial = match[1].trim();
      } else if (!data.ont_barcode.includes('(')) {
        ontSerial = data.ont_barcode.trim();
      }
    }

    return {
      photos: data.local_photos || [],
      ont_serial: ontSerial,
      ups_serial: data.ups_serial || null,
    };
  } catch (error) {
    clearTimeout(timeout);
    return null;
  }
}

async function main() {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`BATCH DR SYNC - Processing latest ${LIMIT} DRs`);
  console.log(`Started: ${new Date().toISOString()}`);
  console.log(`${'='.repeat(80)}\n`);

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL ||
      'process.env.DATABASE_URL'
  });

  // Stats
  const stats = {
    total: 0,
    synced: 0,
    failed: 0,
    serialChanges: [],
    swapsDetected: [],
    installationMismatches: [],
    photoChanges: [],
    newActivities: 0,
  };

  try {
    // Get latest DRs
    console.log('Fetching latest DRs from database...');
    const drsResult = await pool.query(`
      SELECT
        drop_number,
        ont_serial_scanned,
        ups_serial_scanned,
        photo_count,
        project,
        created_at
      FROM dr_photo_unified_reviews
      ORDER BY created_at DESC
      LIMIT $1
    `, [LIMIT]);

    const drs = drsResult.rows;
    stats.total = drs.length;
    console.log(`Found ${drs.length} DRs to process\n`);

    // Get OES activations for comparison
    console.log('Loading OES activations...');
    const oesResult = await pool.query(`
      SELECT drop_number, serial_number
      FROM oes_activations
    `);
    const oesMap = new Map();
    oesResult.rows.forEach(r => oesMap.set(r.drop_number, r.serial_number));
    console.log(`Loaded ${oesMap.size} OES records\n`);

    // Process each DR
    for (let i = 0; i < drs.length; i++) {
      const dr = drs[i];
      const progress = `[${i + 1}/${drs.length}]`;

      process.stdout.write(`${progress} ${dr.drop_number}... `);

      try {
        // Fetch from OneMap
        const oneMapData = await fetchOneMapData(dr.drop_number);

        if (!oneMapData) {
          console.log('OneMap timeout/error');
          stats.failed++;
          continue;
        }

        if (oneMapData.notFound) {
          console.log('Not on OneMap');
          stats.synced++;
          continue;
        }

        const photos = oneMapData.photos || [];
        const ontSerial = oneMapData.ont_serial || null;
        const upsSerial = oneMapData.ups_serial || null;

        const changes = [];

        // Check photo count changes
        const oldPhotoCount = dr.photo_count || 0;
        const newPhotoCount = photos.length;
        if (newPhotoCount !== oldPhotoCount) {
          const change = {
            dropNumber: dr.drop_number,
            oldCount: oldPhotoCount,
            newCount: newPhotoCount,
            diff: newPhotoCount - oldPhotoCount,
          };
          stats.photoChanges.push(change);
          changes.push(`photos: ${oldPhotoCount} → ${newPhotoCount}`);
        }

        // Check serial changes
        const ontChanged = ontSerial && ontSerial !== dr.ont_serial_scanned;
        const upsChanged = upsSerial && upsSerial !== dr.ups_serial_scanned;

        if (ontChanged || upsChanged) {
          const change = {
            dropNumber: dr.drop_number,
            ontOld: dr.ont_serial_scanned,
            ontNew: ontSerial,
            upsOld: dr.ups_serial_scanned,
            upsNew: upsSerial,
            ontChanged,
            upsChanged,
          };
          stats.serialChanges.push(change);
          if (ontChanged) changes.push(`ONT: ${dr.ont_serial_scanned || 'null'} → ${ontSerial}`);
          if (upsChanged) changes.push(`UPS: ${dr.ups_serial_scanned || 'null'} → ${upsSerial}`);
        }

        // Check for swap in CURRENT (new OneMap) data
        const effectiveOnt = ontSerial || dr.ont_serial_scanned;
        const effectiveUps = upsSerial || dr.ups_serial_scanned;
        const swapCheck = detectSwappedSerials(effectiveOnt, effectiveUps);

        // Also check if OLD database data was swapped (and now corrected)
        const oldSwapCheck = detectSwappedSerials(dr.ont_serial_scanned, dr.ups_serial_scanned);
        const wasSwappedNowFixed = oldSwapCheck.swapped && !swapCheck.swapped && (ontChanged || upsChanged);

        if (swapCheck.swapped) {
          stats.swapsDetected.push({
            dropNumber: dr.drop_number,
            ontSerial: effectiveOnt,
            upsSerial: effectiveUps,
            details: swapCheck.details,
            status: 'CURRENT',
          });
          changes.push('SWAP DETECTED');
        } else if (wasSwappedNowFixed) {
          stats.swapsDetected.push({
            dropNumber: dr.drop_number,
            ontSerial: dr.ont_serial_scanned,
            upsSerial: dr.ups_serial_scanned,
            details: `WAS SWAPPED - now corrected. Old: ONT=${dr.ont_serial_scanned}, UPS=${dr.ups_serial_scanned}`,
            status: 'CORRECTED',
          });
          changes.push('SWAP CORRECTED');
        }

        // Check installation mismatch
        const oesSerial = oesMap.get(dr.drop_number);
        if (oesSerial && effectiveOnt) {
          const matchResult = fuzzySerialMatch(effectiveOnt, oesSerial);
          if (!matchResult.isMatch) {
            stats.installationMismatches.push({
              dropNumber: dr.drop_number,
              oneMapSerial: effectiveOnt,
              oesSerial: oesSerial,
              confidence: matchResult.confidence,
            });
            changes.push('INSTALLATION MISMATCH');
          }
        }

        // Update database if changes found
        if (ontChanged || upsChanged || newPhotoCount !== oldPhotoCount) {
          await pool.query(`
            UPDATE dr_photo_unified_reviews
            SET
              ont_serial_scanned = COALESCE($1, ont_serial_scanned),
              ups_serial_scanned = COALESCE($2, ups_serial_scanned),
              photo_count = GREATEST(photo_count, $3),
              updated_at = NOW()
            WHERE drop_number = $4
          `, [ontSerial, upsSerial, newPhotoCount, dr.drop_number]);
        }

        // Log activities (check for duplicates first)

        // Log SERIAL_UPDATE if serials changed
        if (ontChanged || upsChanged) {
          await pool.query(`
            INSERT INTO dr_activity_log (id, drop_number, event_type, event_data, actor, created_at)
            VALUES (gen_random_uuid(), $1, 'SERIAL_UPDATE', $2, 'batch_sync', NOW())
          `, [dr.drop_number, JSON.stringify({
            source: 'batch_sync',
            changes: {
              ont: ontChanged ? { old: dr.ont_serial_scanned, new: ontSerial } : null,
              ups: upsChanged ? { old: dr.ups_serial_scanned, new: upsSerial } : null,
            },
            details: `Serial updated: ${ontChanged ? 'ONT ' : ''}${upsChanged ? 'UPS' : ''}`.trim(),
          })]);
          stats.newActivities++;
        }

        if (swapCheck.swapped) {
          const existing = await pool.query(
            `SELECT 1 FROM dr_activity_log WHERE drop_number = $1 AND event_type = 'SWAP_DETECTED' LIMIT 1`,
            [dr.drop_number]
          );
          if (existing.rows.length === 0) {
            await pool.query(`
              INSERT INTO dr_activity_log (id, drop_number, event_type, event_data, actor, created_at)
              VALUES (gen_random_uuid(), $1, 'SWAP_DETECTED', $2, 'batch_sync', NOW())
            `, [dr.drop_number, JSON.stringify({
              source: 'batch_sync',
              ont_serial: effectiveOnt,
              ups_serial: effectiveUps,
              details: swapCheck.details,
            })]);
            stats.newActivities++;
          }
        }

        if (oesSerial && effectiveOnt) {
          const matchResult = fuzzySerialMatch(effectiveOnt, oesSerial);
          if (!matchResult.isMatch) {
            const existing = await pool.query(
              `SELECT 1 FROM dr_activity_log WHERE drop_number = $1 AND event_type = 'INSTALLATION_MISMATCH' LIMIT 1`,
              [dr.drop_number]
            );
            if (existing.rows.length === 0) {
              await pool.query(`
                INSERT INTO dr_activity_log (id, drop_number, event_type, event_data, actor, created_at)
                VALUES (gen_random_uuid(), $1, 'INSTALLATION_MISMATCH', $2, 'batch_sync', NOW())
              `, [dr.drop_number, JSON.stringify({
                source: 'batch_sync',
                onemap_serial: effectiveOnt,
                oes_serial: oesSerial,
                details: `1Map shows ${effectiveOnt} but OES activated ${oesSerial}`,
              })]);
              stats.newActivities++;
            }
          }
        }

        stats.synced++;

        if (changes.length > 0) {
          console.log(changes.join(', '));
        } else {
          console.log('OK');
        }

      } catch (error) {
        console.log(`ERROR: ${error.message}`);
        stats.failed++;
      }

      // Small delay to avoid overwhelming OneMap
      await new Promise(r => setTimeout(r, 100));
    }

    // Print summary report
    console.log(`\n${'='.repeat(80)}`);
    console.log('SYNC COMPLETE - SUMMARY REPORT');
    console.log(`${'='.repeat(80)}\n`);

    console.log(`Total DRs processed: ${stats.total}`);
    console.log(`Successfully synced: ${stats.synced}`);
    console.log(`Failed: ${stats.failed}`);
    console.log(`New activities logged: ${stats.newActivities}`);
    console.log('');

    // Photo changes
    console.log(`\n--- PHOTO COUNT CHANGES (${stats.photoChanges.length}) ---`);
    if (stats.photoChanges.length > 0) {
      stats.photoChanges.forEach(c => {
        const sign = c.diff > 0 ? '+' : '';
        console.log(`  ${c.dropNumber}: ${c.oldCount} → ${c.newCount} (${sign}${c.diff})`);
      });
    } else {
      console.log('  None');
    }

    // Serial changes
    console.log(`\n--- SERIAL CHANGES (${stats.serialChanges.length}) ---`);
    if (stats.serialChanges.length > 0) {
      stats.serialChanges.forEach(c => {
        console.log(`  ${c.dropNumber}:`);
        if (c.ontChanged) console.log(`    ONT: ${c.ontOld || 'null'} → ${c.ontNew}`);
        if (c.upsChanged) console.log(`    UPS: ${c.upsOld || 'null'} → ${c.upsNew}`);
      });
    } else {
      console.log('  None');
    }

    // Swaps detected
    console.log(`\n--- SWAPS DETECTED (${stats.swapsDetected.length}) ---`);
    if (stats.swapsDetected.length > 0) {
      stats.swapsDetected.forEach(s => {
        console.log(`  ${s.dropNumber} [${s.status}]:`);
        console.log(`    ONT field: ${s.ontSerial}`);
        console.log(`    UPS field: ${s.upsSerial}`);
        console.log(`    ${s.details}`);
      });
    } else {
      console.log('  None');
    }

    // Installation mismatches
    console.log(`\n--- INSTALLATION MISMATCHES (${stats.installationMismatches.length}) ---`);
    if (stats.installationMismatches.length > 0) {
      stats.installationMismatches.forEach(m => {
        console.log(`  ${m.dropNumber}:`);
        console.log(`    1Map: ${m.oneMapSerial}`);
        console.log(`    OES:  ${m.oesSerial}`);
        console.log(`    Confidence: ${(m.confidence * 100).toFixed(1)}%`);
      });
    } else {
      console.log('  None');
    }

    console.log(`\n${'='.repeat(80)}`);
    console.log(`Completed: ${new Date().toISOString()}`);
    console.log(`${'='.repeat(80)}\n`);

  } catch (error) {
    console.error('Fatal error:', error);
  } finally {
    await pool.end();
  }
}

main();
