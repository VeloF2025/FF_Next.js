import { defineLiveSqlGate, SAMPLE_DATE, type SqlTemplate } from './sqlLiveGate';

const TEMPLATES: SqlTemplate[] = [
  {
    name: 'overview weekly totals with exception and mismatch counts',
    text: `
      WITH summaries AS (
        SELECT DATE_TRUNC('week', work_date::timestamp)::date AS week_start,
               regular_hrs, overtime_hrs, sunday_hrs, holiday_hrs, night_hrs,
               wage_amount_cents, staff_id, work_date
        FROM attendance_daily_summaries
        WHERE work_date >= $1::date AND work_date <= $2::date
      ), week_exceptions AS (
        SELECT DATE_TRUNC('week', xe.work_date::timestamp)::date AS week_start,
               COUNT(*)::text AS exceptions_count
        FROM attendance_exceptions x JOIN attendance_entries xe ON xe.id = x.entry_id
        WHERE xe.work_date >= $1::date AND xe.work_date <= $2::date
          AND x.resolved_at IS NULL GROUP BY 1
      ), week_mismatches AS (
        SELECT DATE_TRUNC('week', ve.work_date::timestamp)::date AS week_start,
               COUNT(*)::text AS mismatch_count
        FROM attendance_gps_verifications v JOIN attendance_entries ve ON ve.id = v.entry_id
        WHERE ve.work_date >= $1::date AND ve.work_date <= $2::date
          AND v.verdict = 'mismatch' GROUP BY 1
      )
      SELECT s.week_start::text AS week_start,
             COALESCE(SUM(s.regular_hrs), 0)::text AS regular_hrs,
             COALESCE(SUM(s.overtime_hrs), 0)::text AS overtime_hrs,
             COALESCE(SUM(s.sunday_hrs), 0)::text AS sunday_hrs,
             COALESCE(SUM(s.holiday_hrs), 0)::text AS holiday_hrs,
             COALESCE(SUM(s.night_hrs), 0)::text AS night_hrs,
             COALESCE(SUM(s.wage_amount_cents), 0)::text AS wage_amount_cents,
             COALESCE(wx.exceptions_count, '0') AS exceptions_count,
             COALESCE(wm.mismatch_count, '0') AS mismatch_count
      FROM summaries s
      LEFT JOIN week_exceptions wx ON wx.week_start = s.week_start
      LEFT JOIN week_mismatches wm ON wm.week_start = s.week_start
      GROUP BY s.week_start, wx.exceptions_count, wm.mismatch_count
      ORDER BY s.week_start DESC`,
    params: [SAMPLE_DATE, SAMPLE_DATE],
  },
  {
    name: 'overview top overtime this week',
    text: `
      SELECT ds.staff_id,
             TRIM(COALESCE(s.first_name,'') || ' ' || COALESCE(s.last_name,'')) AS full_name,
             SUM(ds.overtime_hrs)::text AS overtime_hrs
      FROM attendance_daily_summaries ds JOIN staff s ON s.id = ds.staff_id
      WHERE ds.work_date >= $1::date
      GROUP BY ds.staff_id, s.first_name, s.last_name
      HAVING SUM(ds.overtime_hrs) > 0
      ORDER BY SUM(ds.overtime_hrs) DESC LIMIT 5`,
    params: [SAMPLE_DATE],
  },
  {
    name: 'overview Cartrack coverage verdict roll-up',
    text: `
      SELECT v.verdict, COUNT(*)::text AS count
      FROM attendance_gps_verifications v JOIN attendance_entries e ON e.id = v.entry_id
      WHERE e.work_date >= $1::date AND e.work_date <= $2::date
      GROUP BY v.verdict`,
    params: [SAMPLE_DATE, SAMPLE_DATE],
  },
  {
    name: 'weekly attendance export',
    text: `
      WITH week_exceptions AS (
        SELECT xe.staff_id, xe.work_date, COUNT(*)::int AS exceptions_count
        FROM attendance_exceptions x JOIN attendance_entries xe ON xe.id = x.entry_id
        WHERE xe.work_date >= $1::date AND xe.work_date <= $2::date
          AND x.resolved_at IS NULL GROUP BY xe.staff_id, xe.work_date
      ), week_entry_bounds AS (
        SELECT staff_id, work_date, MIN(clock_in_at) AS first_clock_in_at,
               MAX(clock_out_at) AS last_clock_out_at
        FROM attendance_entries
        WHERE work_date >= $1::date AND work_date <= $2::date
        GROUP BY staff_id, work_date
      )
      SELECT ds.staff_id, s.employee_id,
             TRIM(COALESCE(s.first_name, '') || ' ' || COALESCE(s.last_name, '')) AS full_name,
             ds.work_date::text AS work_date, web.first_clock_in_at::text AS clock_in_at,
             web.last_clock_out_at::text AS clock_out_at, ds.regular_hrs::text,
             ds.overtime_hrs::text, ds.sunday_hrs::text, ds.holiday_hrs::text,
             ds.night_hrs::text, ds.wage_amount_cents::text,
             ds.hourly_rate_snapshot_cents::text,
             COALESCE(wx.exceptions_count, 0) AS exceptions_count
      FROM attendance_daily_summaries ds JOIN staff s ON s.id = ds.staff_id
      LEFT JOIN week_entry_bounds web
        ON web.staff_id = ds.staff_id AND web.work_date = ds.work_date
      LEFT JOIN week_exceptions wx
        ON wx.staff_id = ds.staff_id AND wx.work_date = ds.work_date
      WHERE ds.work_date >= $1::date AND ds.work_date <= $2::date
      ORDER BY full_name ASC, ds.work_date ASC`,
    params: [SAMPLE_DATE, SAMPLE_DATE],
  },
];

defineLiveSqlGate('attendance reporting SQL live-schema gate', TEMPLATES);
