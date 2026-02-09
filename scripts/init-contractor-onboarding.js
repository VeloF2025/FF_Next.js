#!/usr/bin/env node

/**
 * Initialize onboarding stages for a contractor
 */

require('dotenv').config({ path: ['.env.production.local'] });
const { neon } = require('@neondatabase/serverless');

const sql = neon(process.env.DATABASE_URL);
const contractorId = '9ff731e1-eceb-40bb-8d9c-37635dc576b2';

const DEFAULT_STAGES = [
  {
    stageName: 'Company Registration',
    stageOrder: 1,
    requiredDocuments: ['cipc_registration', 'directors_ids', 'tax_clearance'],
  },
  {
    stageName: 'Company Verification',
    stageOrder: 2,
    requiredDocuments: [],
  },
  {
    stageName: 'Financial Documentation',
    stageOrder: 3,
    requiredDocuments: ['bank_confirmation', 'vat_certificate'],
  },
  {
    stageName: 'Insurance & Compliance',
    stageOrder: 4,
    requiredDocuments: ['insurance_liability', 'insurance_workers_comp', 'coid_registration', 'safety_certificate'],
  },
  {
    stageName: 'Technical Qualifications',
    stageOrder: 5,
    requiredDocuments: ['technical_certification', 'key_staff_credentials'],
  },
  {
    stageName: 'Final Review',
    stageOrder: 6,
    requiredDocuments: ['msa'],
  },
];

async function initOnboarding() {
  console.log(`🚀 Initializing onboarding stages for contractor: ${contractorId}`);
  console.log('');

  try {
    // Check if contractor exists
    const [contractor] = await sql`
      SELECT id, company_name FROM contractors WHERE id = ${contractorId}
    `;

    if (!contractor) {
      console.error('❌ Contractor not found');
      process.exit(1);
    }

    console.log(`✓ Found contractor: ${contractor.company_name}`);
    console.log('');

    // Check if stages already exist
    const existing = await sql`
      SELECT COUNT(*) as count FROM contractor_onboarding_stages
      WHERE contractor_id = ${contractorId}
    `;

    if (existing[0].count > 0) {
      console.log(`⚠️  Onboarding stages already exist (${existing[0].count} stages)`);
      console.log('');
      const stages = await sql`
        SELECT stage_name, status FROM contractor_onboarding_stages
        WHERE contractor_id = ${contractorId}
        ORDER BY stage_order
      `;
      stages.forEach(s => console.log(`  - ${s.stage_name}: ${s.status}`));
      return;
    }

    // Create stages
    console.log('Creating onboarding stages...');
    for (const template of DEFAULT_STAGES) {
      await sql`
        INSERT INTO contractor_onboarding_stages (
          contractor_id,
          stage_name,
          stage_order,
          status,
          completion_percentage,
          required_documents,
          completed_documents
        ) VALUES (
          ${contractorId},
          ${template.stageName},
          ${template.stageOrder},
          'pending',
          0,
          ${JSON.stringify(template.requiredDocuments)},
          '[]'
        )
      `;
      console.log(`  ✓ Created: ${template.stageName}`);
    }

    console.log('');
    console.log('✅ Onboarding stages initialized successfully!');
    console.log('');
    console.log('Test URL:');
    console.log(`  https://fibreflow-nextjs.vercel.app/contractors/${contractorId}/onboarding`);

  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error);
    process.exit(1);
  }
}

initOnboarding();
