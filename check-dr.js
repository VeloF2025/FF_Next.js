const { Pool } = require("pg");
const p = new Pool({ connectionString: "postgresql://neondb_owner:npg_MIUZXrg1tEY0@ep-dry-night-a9qyh4sj-pooler.gwc.azure.neon.tech/neondb?sslmode=require" });

const dr = process.argv[2] || "DR476766";

p.query(
  `SELECT drop_number, auto_qa_eligible_at, auto_qa_processed,
          vlm_categorization_status, data_validation_completed,
          photo_count, qa_decision, human_review_status,
          qa_decision_is_draft
   FROM dr_photo_unified_reviews WHERE drop_number = $1`,
  [dr]
).then(r => {
  console.log(JSON.stringify(r.rows[0], null, 2));
  p.end();
}).catch(e => {
  console.error(e.message);
  p.end();
});
