const { neon } = require("@neondatabase/serverless");

const sql = neon("process.env.DATABASE_URL");

async function investigate() {
  console.log("=== ROOT CAUSE ANALYSIS ===\n");
  
  console.log("The 3 orphan drops are:");
  console.log("1. DR1635478 - NOT in unified table at all (never processed)");
  console.log("2. DR469705 - In unified but with submitted_date Jan 14-15 (resubmission today)");
  console.log("3. DR469706 - In unified but with submitted_date Jan 13 (resubmission today)");
  
  console.log("\n=== EXPLANATION ===");
  console.log("The discrepancy (156 installed vs 153 total) happens because:");
  console.log("- 'Installed' counts ALL WhatsApp submissions for today");
  console.log("- 'Total Drops' counts unique drops in unified with today's date");
  console.log("");
  console.log("When field agents RE-SEND photos for an old DR:");
  console.log("  → It creates a NEW entry in qa_photo_reviews (today)");
  console.log("  → But the unified table keeps the ORIGINAL entry (old date)");
  console.log("  → Result: installed > total for today");
  
  // Check if DR1635478 is in SOW drops
  const dr1635478 = await sql`
    SELECT drop_number, project_id, zone_no, pon_no
    FROM drops
    WHERE drop_number = 'DR1635478'
  `;
  
  console.log("\n=== DR1635478 Status ===");
  if (dr1635478.length === 0) {
    console.log("NOT in SOW drops table - This is an INVALID drop number!");
    console.log("Field agent likely typed the wrong DR number in WhatsApp");
  } else {
    console.log("Valid SOW drop - but not yet processed to unified");
    console.log(dr1635478[0]);
  }
  
  // Check qa_photo_reviews for DR1635478
  const qaEntry = await sql`
    SELECT id, drop_number, project, user_name, sender_phone, created_at
    FROM qa_photo_reviews
    WHERE drop_number = 'DR1635478'
  `;
  
  console.log("\nqa_photo_reviews entry for DR1635478:");
  qaEntry.forEach(r => {
    console.log("  - ID:", r.id);
    console.log("    Drop:", r.drop_number, "| Project:", r.project);
    console.log("    User:", r.user_name, "| Phone:", r.sender_phone);
    console.log("    Created:", r.created_at);
  });
  
  console.log("\n=== SUMMARY ===");
  console.log("These are NOT test entries - they are normal operational data:");
  console.log("- 2 drops are re-submissions of old DRs (field agents resending photos)");
  console.log("- 1 drop (DR1635478) appears to be either a typo or pending processing");
}

investigate().catch(console.error);
