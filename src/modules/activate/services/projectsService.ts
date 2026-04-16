import pool from '@/lib/db';

export async function getDistinctProjects(): Promise<string[]> {
  const result = await pool.query(
    `SELECT DISTINCT project FROM oes_pp_data WHERE project IS NOT NULL ORDER BY project`
  );
  return result.rows.map((r: { project: string }) => r.project);
}

export async function getDistinctNonInvoiceableProjects(): Promise<string[]> {
  const result = await pool.query(
    `SELECT DISTINCT project FROM oes_pp_data WHERE project IS NOT NULL
     UNION
     SELECT DISTINCT project FROM olt_mismatch_records WHERE project IS NOT NULL
     ORDER BY 1`
  );
  return result.rows.map((r: { project: string }) => r.project);
}
