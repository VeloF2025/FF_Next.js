/**
 * Run Migration 084: QA Correction Examples for Few-Shot Learning
 *
 * Usage: node scripts/migrations/run-migration-084.js
 */

const { neon } = require('@neondatabase/serverless');

const DATABASE_URL = process.env.DATABASE_URL ||
  'process.env.DATABASE_URL';

async function runMigration() {
  console.log('Starting Migration 084: QA Correction Examples for Few-Shot Learning');
  console.log('='.repeat(70));

  const sql = neon(DATABASE_URL);

  try {
    // 1. Create qa_correction_examples table
    console.log('\n1. Creating qa_correction_examples table...');
    await sql`
      CREATE TABLE IF NOT EXISTS qa_correction_examples (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        workflow_type VARCHAR(50) NOT NULL,
        photo_filename TEXT NOT NULL,
        photo_description TEXT,
        vlm_predicted_step INTEGER NOT NULL,
        vlm_predicted_category TEXT NOT NULL,
        vlm_confidence DECIMAL(3,2) NOT NULL,
        vlm_reasoning TEXT,
        correct_step INTEGER NOT NULL,
        correct_category TEXT NOT NULL,
        correction_reason TEXT,
        corrected_by TEXT NOT NULL,
        reviewed_count INTEGER DEFAULT 1,
        is_canonical BOOLEAN DEFAULT false,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )
    `;
    console.log('   ✅ Table qa_correction_examples created');

    // 2. Create indexes for qa_correction_examples
    console.log('\n2. Creating qa_correction_examples indexes...');
    await sql`CREATE INDEX IF NOT EXISTS idx_corrections_workflow ON qa_correction_examples(workflow_type)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_corrections_vlm_step ON qa_correction_examples(vlm_predicted_step)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_corrections_correct_step ON qa_correction_examples(correct_step)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_corrections_canonical ON qa_correction_examples(is_canonical) WHERE is_canonical = true`;
    await sql`CREATE INDEX IF NOT EXISTS idx_corrections_workflow_confidence ON qa_correction_examples(workflow_type, vlm_confidence DESC)`;
    console.log('   ✅ Correction indexes created');

    // 3. Create qa_workflow_steps table
    console.log('\n3. Creating qa_workflow_steps table...');
    await sql`
      CREATE TABLE IF NOT EXISTS qa_workflow_steps (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        workflow_type VARCHAR(50) NOT NULL,
        step_number INTEGER NOT NULL,
        step_label VARCHAR(100) NOT NULL,
        step_description TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        UNIQUE(workflow_type, step_number)
      )
    `;
    console.log('   ✅ Table qa_workflow_steps created');

    // 4. Seed DR Photo steps
    console.log('\n4. Seeding DR Photo workflow steps...');
    const drPhotoSteps = [
      { step: 1, label: 'House Photo', description: 'Photo of the house/property for location verification' },
      { step: 2, label: 'Cable from Pole', description: 'Aerial fiber drop from utility pole to house' },
      { step: 3, label: 'Entry Outside', description: 'EXTERIOR view of where cable enters building' },
      { step: 4, label: 'Entry Inside', description: 'INTERIOR view of cable routing from entry point toward ONT' },
      { step: 5, label: 'Wall', description: 'Wall surface with mounting bracket and power outlet before ONT install' },
      { step: 6, label: 'ONT Back', description: 'Back panel of ONT showing fiber and power cable connections' },
      { step: 7, label: 'Power Meter', description: 'Optical power meter display showing dBm reading' },
      { step: 8, label: 'Final Installation', description: 'Wide shot of complete setup (ONT mounted, UPS/GIZZU connected)' },
      { step: 9, label: 'Green Lights', description: 'Front panel of ONT with illuminated indicator lights' },
      { step: 10, label: 'Signature', description: 'Customer signature on completion form' },
    ];

    for (const step of drPhotoSteps) {
      await sql`
        INSERT INTO qa_workflow_steps (workflow_type, step_number, step_label, step_description)
        VALUES ('dr_photo', ${step.step}, ${step.label}, ${step.description})
        ON CONFLICT (workflow_type, step_number) DO UPDATE SET
          step_label = EXCLUDED.step_label,
          step_description = EXCLUDED.step_description
      `;
    }
    console.log('   ✅ DR Photo steps seeded (10 steps)');

    // 5. Create update trigger function
    console.log('\n5. Creating updated_at trigger function...');
    await sql`
      CREATE OR REPLACE FUNCTION update_correction_timestamp()
      RETURNS TRIGGER AS $$
      BEGIN
        NEW.updated_at = NOW();
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `;
    console.log('   ✅ Trigger function created');

    // 6. Create trigger
    console.log('\n6. Creating updated_at trigger...');
    await sql`DROP TRIGGER IF EXISTS trigger_correction_updated_at ON qa_correction_examples`;
    await sql`
      CREATE TRIGGER trigger_correction_updated_at
        BEFORE UPDATE ON qa_correction_examples
        FOR EACH ROW
        EXECUTE FUNCTION update_correction_timestamp()
    `;
    console.log('   ✅ Trigger created');

    // 7. Verify migration
    console.log('\n7. Verifying migration...');

    const correctionsTableExists = await sql`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_name = 'qa_correction_examples'
      ) as exists
    `;
    console.log(`   - qa_correction_examples table: ${correctionsTableExists[0].exists ? '✅' : '❌'}`);

    const stepsTableExists = await sql`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_name = 'qa_workflow_steps'
      ) as exists
    `;
    console.log(`   - qa_workflow_steps table: ${stepsTableExists[0].exists ? '✅' : '❌'}`);

    const stepCount = await sql`SELECT COUNT(*) as count FROM qa_workflow_steps WHERE workflow_type = 'dr_photo'`;
    console.log(`   - DR Photo steps: ${stepCount[0].count}/10 ✅`);

    const indexCount = await sql`
      SELECT COUNT(*) as count
      FROM pg_indexes
      WHERE tablename = 'qa_correction_examples'
    `;
    console.log(`   - Correction indexes: ${indexCount[0].count} ✅`);

    console.log('\n' + '='.repeat(70));
    console.log('Migration 084 COMPLETE - HITL Few-Shot Learning tables ready');
    console.log('='.repeat(70));

  } catch (error) {
    console.error('\n❌ Migration failed:', error.message);
    throw error;
  }
}

runMigration()
  .then(() => process.exit(0))
  .catch(() => process.exit(1));
