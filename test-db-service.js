// Test the fotoDbService directly
const { neon } = require('@neondatabase/serverless');

const sql = neon(process.env.DATABASE_URL || 'process.env.DATABASE_URL');

async function saveEvaluation(evaluation) {
  try {
    // Convert step_results to JSON string for JSONB column
    const stepResultsJson = JSON.stringify(evaluation.step_results);

    console.log('Saving evaluation:', evaluation.dr_number);
    console.log('Step results JSON length:', stepResultsJson.length);

    await sql`
      INSERT INTO foto_ai_reviews (
        dr_number,
        overall_status,
        average_score,
        total_steps,
        passed_steps,
        step_results,
        markdown_report,
        feedback_sent,
        evaluation_date
      ) VALUES (
        ${evaluation.dr_number},
        ${evaluation.overall_status},
        ${evaluation.average_score},
        ${evaluation.total_steps},
        ${evaluation.passed_steps},
        ${stepResultsJson}::jsonb,
        ${evaluation.markdown_report || null},
        ${evaluation.feedback_sent},
        ${evaluation.evaluation_date || new Date()}
      )
      ON CONFLICT (dr_number)
      DO UPDATE SET
        overall_status = EXCLUDED.overall_status,
        average_score = EXCLUDED.average_score,
        total_steps = EXCLUDED.total_steps,
        passed_steps = EXCLUDED.passed_steps,
        step_results = EXCLUDED.step_results,
        markdown_report = EXCLUDED.markdown_report,
        evaluation_date = EXCLUDED.evaluation_date,
        updated_at = NOW()
    `;

    console.log('✓ Saved successfully');

    // Verify it was saved
    const rows = await sql`
      SELECT dr_number, overall_status, average_score
      FROM foto_ai_reviews
      WHERE dr_number = ${evaluation.dr_number}
    `;

    if (rows.length > 0) {
      console.log('✓ Verified in database:', rows[0]);
      return rows[0];
    } else {
      console.error('✗ Not found in database after save!');
      return null;
    }
  } catch (error) {
    console.error('Error saving:', error.message);
    console.error('Error stack:', error.stack);
    throw error;
  }
}

async function test() {
  const testEvaluation = {
    dr_number: `TEST_${Date.now()}`,
    overall_status: 'PASS',
    average_score: 8.5,
    total_steps: 12,
    passed_steps: 10,
    step_results: [
      {
        step_number: 1,
        step_name: 'house_photo',
        step_label: 'House Photo',
        passed: true,
        score: 9.0,
        comment: 'Clear photo'
      },
      {
        step_number: 2,
        step_name: 'cable_span',
        step_label: 'Cable Span',
        passed: true,
        score: 8.5,
        comment: 'Good quality'
      }
    ],
    markdown_report: null,
    feedback_sent: false,
    evaluation_date: new Date()
  };

  console.log('Testing database save...\n');
  const result = await saveEvaluation(testEvaluation);

  if (result) {
    console.log('\n✓ Test PASSED');
  } else {
    console.log('\n✗ Test FAILED');
  }
}

test().catch(console.error);
