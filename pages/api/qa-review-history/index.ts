import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL!);

interface QAReviewHistory {
  id: string;
  drop_number: string;
  project: string;
  review_date: string | null;
  reviewer: string | null;
  step_01_house_photo: boolean;
  step_02_cable_from_pole: boolean;
  step_03_cable_entry_outside: boolean;
  step_04_cable_entry_inside: boolean;
  step_05_wall_installation: boolean;
  step_06_ont_back: boolean;
  step_07_power_meter: boolean;
  step_08_final_installation: boolean;
  step_09_green_lights: boolean;
  step_10_signature: boolean;
  completed_photos: number | null;
  outstanding_photos: number | null;
  pass_fail: string | null;
  percent_complete: string | null;
  comment: string | null;
  source: string;
  imported_at: string;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { dropNumber, project, limit = '50' } = req.query;

  try {
    let query = `
      SELECT
        id, drop_number, project, review_date, reviewer,
        step_01_house_photo, step_02_cable_from_pole, step_03_cable_entry_outside,
        step_04_cable_entry_inside, step_05_wall_installation, step_06_ont_back,
        step_07_power_meter, step_08_final_installation, step_09_green_lights, step_10_signature,
        completed_photos, outstanding_photos, pass_fail, percent_complete, comment,
        source, imported_at
      FROM qa_review_history
      WHERE 1=1
    `;
    const params: (string | number)[] = [];

    if (dropNumber) {
      params.push(dropNumber as string);
      query += ` AND drop_number = $${params.length}`;
    }

    if (project) {
      params.push(project as string);
      query += ` AND project = $${params.length}`;
    }

    query += ` ORDER BY review_date DESC NULLS LAST, imported_at DESC`;

    params.push(parseInt(limit as string) || 50);
    query += ` LIMIT $${params.length}`;

    const rows = await sql(query, params) as QAReviewHistory[];

    // Calculate step summary for each review
    const reviews = rows.map(row => {
      const steps = [
        row.step_01_house_photo, row.step_02_cable_from_pole, row.step_03_cable_entry_outside,
        row.step_04_cable_entry_inside, row.step_05_wall_installation, row.step_06_ont_back,
        row.step_07_power_meter, row.step_08_final_installation, row.step_09_green_lights, row.step_10_signature
      ];
      const passedSteps = steps.filter(Boolean).length;

      return {
        ...row,
        steps_passed: passedSteps,
        steps_total: 10,
        steps_percent: Math.round((passedSteps / 10) * 100)
      };
    });

    return res.status(200).json({
      success: true,
      count: reviews.length,
      reviews
    });
  } catch (error) {
    console.error('Error fetching QA review history:', error);
    return res.status(500).json({
      error: 'Failed to fetch review history',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}
