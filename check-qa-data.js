const { Pool } = require("pg");
const p = new Pool({ connectionString: "postgresql://neondb_owner:npg_MIUZXrg1tEY0@ep-dry-night-a9qyh4sj-pooler.gwc.azure.neon.tech/neondb?sslmode=require" });

async function run() {
  // 1. Overall status breakdown
  const status = await p.query(`
    SELECT vlm_categorization_status, auto_qa_processed, data_validation_completed,
           COUNT(*) as count,
           COUNT(*) FILTER (WHERE auto_qa_eligible_at <= NOW()) as eligible_now
    FROM dr_photo_unified_reviews
    GROUP BY vlm_categorization_status, auto_qa_processed, data_validation_completed
    ORDER BY count DESC
  `);
  console.log("=== DR STATUS BREAKDOWN ===");
  console.log(JSON.stringify(status.rows, null, 2));

  // 2. Check how many have step 0 categorizations
  const step0 = await p.query(`
    SELECT COUNT(*) as total_drs,
           COUNT(*) FILTER (WHERE vlm_categorization_results::text LIKE '%"vlm_predicted_step":0%'
             OR vlm_categorization_results::text LIKE '%"vlm_predicted_step": 0%') as has_step0,
           COUNT(*) FILTER (WHERE vlm_categorization_results IS NULL) as no_vlm_results
    FROM dr_photo_unified_reviews
  `);
  console.log("\n=== STEP 0 ANALYSIS ===");
  console.log(JSON.stringify(step0.rows[0], null, 2));

  // 3. Sample: what does the VLM say for eligible DRs
  const sample = await p.query(`
    SELECT drop_number, photo_count, vlm_categorization_status,
           auto_qa_eligible_at <= NOW() as eligible,
           CASE WHEN vlm_categorization_results IS NOT NULL
                THEN length(vlm_categorization_results::text) ELSE 0 END as vlm_data_size
    FROM dr_photo_unified_reviews
    WHERE auto_qa_eligible_at <= NOW() AND auto_qa_processed = false
    ORDER BY auto_qa_eligible_at DESC
    LIMIT 10
  `);
  console.log("\n=== TOP 10 ELIGIBLE DRs ===");
  console.log(JSON.stringify(sample.rows, null, 2));

  // 4. For DR476766 specifically, check VLM results
  const dr = await p.query(`
    SELECT drop_number,
           jsonb_array_elements(vlm_categorization_results) as vlm_result
    FROM dr_photo_unified_reviews
    WHERE drop_number = 'DR476766'
  `);
  console.log("\n=== DR476766 VLM RESULTS ===");
  for (const row of dr.rows) {
    const r = row.vlm_result;
    console.log("  " + r.photo_filename + ": step=" + r.vlm_predicted_step + " cat=" + r.vlm_predicted_category + " conf=" + r.vlm_confidence);
  }

  p.end();
}

run().catch(e => { console.error(e.message); p.end(); });
