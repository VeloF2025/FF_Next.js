/**
 * Create Fleet Analytics Views
 *
 * Run with:
 *   DATABASE_URL='postgresql://...' node scripts/create-fleet-views.js
 */

const { neon } = require('@neondatabase/serverless');

async function createViews() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('ERROR: DATABASE_URL environment variable is required');
    process.exit(1);
  }

  const sql = neon(databaseUrl);

  console.log('Creating Fleet Analytics Views...');
  console.log('='.repeat(50));

  // 1. v_fleet_tco_summary
  console.log('\n1. Creating v_fleet_tco_summary...');
  await sql`
    CREATE OR REPLACE VIEW v_fleet_tco_summary AS
    WITH fuel_costs_12m AS (
      SELECT
        vehicle_id,
        COALESCE(SUM(amount_rand), 0) as fuel_cost_12m,
        COALESCE(SUM(litres), 0) as total_litres_12m,
        COUNT(*) as fuel_transactions_12m
      FROM fleet_fuel_transactions
      WHERE transaction_date >= CURRENT_DATE - INTERVAL '12 months'
      GROUP BY vehicle_id
    ),
    fuel_costs_lifetime AS (
      SELECT
        vehicle_id,
        COALESCE(SUM(amount_rand), 0) as fuel_cost_lifetime,
        COALESCE(SUM(litres), 0) as total_litres_lifetime
      FROM fleet_fuel_transactions
      GROUP BY vehicle_id
    ),
    service_costs_12m AS (
      SELECT
        vehicle_id,
        COALESCE(SUM(total_cost), 0) as service_cost_12m,
        COUNT(*) as service_count_12m
      FROM fleet_service_history
      WHERE service_date >= CURRENT_DATE - INTERVAL '12 months'
      GROUP BY vehicle_id
    ),
    service_costs_lifetime AS (
      SELECT
        vehicle_id,
        COALESCE(SUM(total_cost), 0) as service_cost_lifetime
      FROM fleet_service_history
      GROUP BY vehicle_id
    ),
    lease_costs AS (
      SELECT
        vehicle_id,
        monthly_cost,
        contract_duration_months,
        deposit_amount,
        COALESCE(monthly_cost * LEAST(contract_duration_months, 12), 0) as lease_cost_12m,
        COALESCE(monthly_cost * contract_duration_months, 0) + COALESCE(deposit_amount, 0) as total_lease_cost
      FROM fleet_vehicle_lease
    ),
    insurance_costs AS (
      SELECT
        vehicle_id,
        COALESCE(premium_annual, premium_monthly * 12, 0) as insurance_cost_annual
      FROM fleet_vehicle_insurance
      WHERE is_active = true
    ),
    license_costs AS (
      SELECT
        vehicle_id,
        COALESCE(SUM(total_paid), 0) as license_cost_12m
      FROM fleet_license_disc
      WHERE expiry_date >= CURRENT_DATE - INTERVAL '12 months'
      GROUP BY vehicle_id
    ),
    km_data_12m AS (
      SELECT
        vehicle_id,
        MAX(reading) - MIN(reading) as km_travelled_12m
      FROM fleet_odometer_history
      WHERE recorded_at >= CURRENT_DATE - INTERVAL '12 months'
      GROUP BY vehicle_id
    ),
    km_data_lifetime AS (
      SELECT
        vehicle_id,
        MAX(reading) - MIN(reading) as km_travelled_lifetime
      FROM fleet_odometer_history
      GROUP BY vehicle_id
    )
    SELECT
      fv.id as vehicle_id,
      fv.registration,
      fv.make,
      fv.model,
      fv.year,
      fv.ownership_type,
      fv.status,
      fv.created_at as vehicle_added_date,
      COALESCE(fc12.fuel_cost_12m, 0) as fuel_cost_12m,
      COALESCE(sc12.service_cost_12m, 0) as service_cost_12m,
      COALESCE(lc.lease_cost_12m, 0) as lease_cost_12m,
      COALESCE(ic.insurance_cost_annual, 0) as insurance_cost_12m,
      COALESCE(lic.license_cost_12m, 0) as license_cost_12m,
      COALESCE(fc12.fuel_cost_12m, 0) +
      COALESCE(sc12.service_cost_12m, 0) +
      COALESCE(lc.lease_cost_12m, 0) +
      COALESCE(ic.insurance_cost_annual, 0) +
      COALESCE(lic.license_cost_12m, 0) as tco_12m,
      COALESCE(fcl.fuel_cost_lifetime, 0) as fuel_cost_lifetime,
      COALESCE(scl.service_cost_lifetime, 0) as service_cost_lifetime,
      COALESCE(lc.total_lease_cost, 0) as lease_cost_lifetime,
      COALESCE(fcl.fuel_cost_lifetime, 0) +
      COALESCE(scl.service_cost_lifetime, 0) +
      COALESCE(lc.total_lease_cost, 0) as tco_lifetime,
      COALESCE(kd12.km_travelled_12m, 0) as km_travelled_12m,
      COALESCE(kdl.km_travelled_lifetime, 0) as km_travelled_lifetime,
      CASE WHEN COALESCE(kd12.km_travelled_12m, 0) > 0 THEN
        (COALESCE(fc12.fuel_cost_12m, 0) + COALESCE(sc12.service_cost_12m, 0) +
         COALESCE(lc.lease_cost_12m, 0) + COALESCE(ic.insurance_cost_annual, 0) +
         COALESCE(lic.license_cost_12m, 0)) / kd12.km_travelled_12m
      ELSE NULL END as cost_per_km_12m,
      CASE WHEN COALESCE(kdl.km_travelled_lifetime, 0) > 0 THEN
        (COALESCE(fcl.fuel_cost_lifetime, 0) + COALESCE(scl.service_cost_lifetime, 0) +
         COALESCE(lc.total_lease_cost, 0)) / kdl.km_travelled_lifetime
      ELSE NULL END as cost_per_km_lifetime,
      CASE WHEN COALESCE(kd12.km_travelled_12m, 0) > 0 AND COALESCE(fc12.total_litres_12m, 0) > 0 THEN
        (fc12.total_litres_12m / kd12.km_travelled_12m) * 100
      ELSE NULL END as litres_per_100km,
      COALESCE(fc12.fuel_transactions_12m, 0) as fuel_transactions_12m,
      COALESCE(sc12.service_count_12m, 0) as service_count_12m
    FROM fleet_vehicles fv
    LEFT JOIN fuel_costs_12m fc12 ON fv.id = fc12.vehicle_id
    LEFT JOIN fuel_costs_lifetime fcl ON fv.id = fcl.vehicle_id
    LEFT JOIN service_costs_12m sc12 ON fv.id = sc12.vehicle_id
    LEFT JOIN service_costs_lifetime scl ON fv.id = scl.vehicle_id
    LEFT JOIN lease_costs lc ON fv.id = lc.vehicle_id
    LEFT JOIN insurance_costs ic ON fv.id = ic.vehicle_id
    LEFT JOIN license_costs lic ON fv.id = lic.vehicle_id
    LEFT JOIN km_data_12m kd12 ON fv.id = kd12.vehicle_id
    LEFT JOIN km_data_lifetime kdl ON fv.id = kdl.vehicle_id
    WHERE fv.status != 'retired'
  `;
  console.log('   ✓ v_fleet_tco_summary created');

  // 2. v_fleet_check_compliance
  console.log('\n2. Creating v_fleet_check_compliance...');
  await sql`
    CREATE OR REPLACE VIEW v_fleet_check_compliance AS
    WITH driver_assignments AS (
      SELECT
        va.staff_id,
        va.fleet_vehicle_id as vehicle_id,
        fv.registration,
        va.assignment_start as assigned_date,
        va.assignment_end as returned_date,
        GREATEST(
          (COALESCE(va.assignment_end, CURRENT_DATE) - va.assignment_start)::INTEGER,
          0
        ) as days_assigned
      FROM vehicle_assignments va
      JOIN fleet_vehicles fv ON va.fleet_vehicle_id = fv.id
      WHERE va.fleet_vehicle_id IS NOT NULL
    ),
    check_counts AS (
      SELECT
        driver_id as staff_id,
        vehicle_id,
        COUNT(*) as total_checks,
        COUNT(*) FILTER (WHERE check_date >= CURRENT_DATE - INTERVAL '30 days') as checks_30d,
        COUNT(*) FILTER (WHERE check_date >= CURRENT_DATE - INTERVAL '7 days') as checks_7d,
        COUNT(*) FILTER (WHERE has_critical_issues = true) as critical_issues,
        COUNT(*) FILTER (WHERE has_minor_issues = true) as minor_issues,
        COUNT(*) FILTER (WHERE status = 'approved') as approved_checks,
        COUNT(*) FILTER (WHERE status = 'rejected') as rejected_checks,
        MAX(check_date) as last_check_date
      FROM fleet_check_records
      GROUP BY driver_id, vehicle_id
    )
    SELECT
      da.staff_id,
      s.name as driver_name,
      s.phone as driver_phone,
      s.email as driver_email,
      da.vehicle_id,
      da.registration,
      da.days_assigned,
      da.assigned_date,
      da.returned_date,
      COALESCE(cc.total_checks, 0) as total_checks,
      COALESCE(cc.checks_30d, 0) as checks_30d,
      COALESCE(cc.checks_7d, 0) as checks_7d,
      COALESCE(cc.critical_issues, 0) as critical_issues,
      COALESCE(cc.minor_issues, 0) as minor_issues,
      COALESCE(cc.approved_checks, 0) as approved_checks,
      COALESCE(cc.rejected_checks, 0) as rejected_checks,
      cc.last_check_date,
      CASE WHEN da.days_assigned > 0 THEN
        LEAST((COALESCE(cc.total_checks, 0)::numeric / da.days_assigned * 100), 100)
      ELSE 100 END as compliance_rate,
      CASE WHEN cc.last_check_date IS NOT NULL THEN
        (CURRENT_DATE - cc.last_check_date)::INTEGER
      ELSE da.days_assigned END as days_since_last_check
    FROM driver_assignments da
    JOIN staff s ON da.staff_id = s.id
    LEFT JOIN check_counts cc ON da.staff_id = cc.staff_id AND da.vehicle_id = cc.vehicle_id
  `;
  console.log('   ✓ v_fleet_check_compliance created');

  // 3. v_fleet_upcoming_services
  console.log('\n3. Creating v_fleet_upcoming_services...');
  await sql`
    CREATE OR REPLACE VIEW v_fleet_upcoming_services AS
    WITH current_odometer AS (
      SELECT DISTINCT ON (vehicle_id)
        vehicle_id,
        reading as current_km
      FROM fleet_odometer_history
      ORDER BY vehicle_id, recorded_at DESC
    )
    SELECT
      si.id as interval_id,
      si.vehicle_id,
      fv.registration,
      fv.make,
      fv.model,
      si.service_type,
      si.interval_km,
      si.interval_months,
      si.last_service_km,
      si.last_service_date,
      si.next_service_km,
      si.next_service_date,
      si.estimated_cost,
      si.provider_name,
      co.current_km,
      CASE
        WHEN si.next_service_date IS NOT NULL AND si.next_service_date < CURRENT_DATE THEN 'overdue'
        WHEN co.current_km IS NOT NULL AND si.next_service_km IS NOT NULL AND co.current_km > si.next_service_km THEN 'overdue'
        WHEN si.next_service_date IS NOT NULL AND si.next_service_date <= CURRENT_DATE + INTERVAL '7 days' THEN 'critical'
        WHEN co.current_km IS NOT NULL AND si.next_service_km IS NOT NULL AND co.current_km >= si.next_service_km - 500 THEN 'critical'
        WHEN si.next_service_date IS NOT NULL AND si.next_service_date <= CURRENT_DATE + INTERVAL '30 days' THEN 'warning'
        WHEN co.current_km IS NOT NULL AND si.next_service_km IS NOT NULL AND co.current_km >= si.next_service_km - 2000 THEN 'warning'
        ELSE 'ok'
      END as urgency,
      CASE WHEN si.next_service_date IS NOT NULL THEN
        (si.next_service_date - CURRENT_DATE)::INTEGER
      ELSE NULL END as days_until_due,
      CASE WHEN si.next_service_km IS NOT NULL AND co.current_km IS NOT NULL THEN
        si.next_service_km - co.current_km
      ELSE NULL END as km_until_due
    FROM fleet_service_intervals si
    JOIN fleet_vehicles fv ON si.vehicle_id = fv.id
    LEFT JOIN current_odometer co ON si.vehicle_id = co.vehicle_id
    WHERE si.is_active = true
      AND fv.status = 'active'
    ORDER BY
      CASE
        WHEN si.next_service_date IS NOT NULL AND si.next_service_date < CURRENT_DATE THEN 0
        WHEN co.current_km IS NOT NULL AND si.next_service_km IS NOT NULL AND co.current_km > si.next_service_km THEN 0
        ELSE 1
      END,
      si.next_service_date NULLS LAST,
      si.next_service_km NULLS LAST
  `;
  console.log('   ✓ v_fleet_upcoming_services created');

  // 4. v_fleet_driver_leaderboard
  console.log('\n4. Creating v_fleet_driver_leaderboard...');
  await sql`
    CREATE OR REPLACE VIEW v_fleet_driver_leaderboard AS
    SELECT
      ds.id,
      ds.staff_id,
      s.name as driver_name,
      s.phone,
      s.email,
      ds.score_date,
      ds.score_type,
      ds.check_in_compliance,
      ds.fuel_efficiency_score,
      ds.authorization_compliance,
      ds.vehicle_care_score,
      ds.composite_score,
      ds.total_check_ins,
      ds.expected_check_ins,
      ds.missed_check_ins,
      ds.late_check_ins,
      ds.critical_issues_reported,
      ds.minor_issues_reported,
      ds.avg_litres_per_100km,
      ds.fleet_avg_litres_per_100km,
      ds.total_fuel_cost,
      ds.total_trips,
      ds.authorized_trips,
      ds.unauthorized_trips,
      ds.after_hours_trips,
      ds.weekend_trips,
      ds.total_km,
      ds.unauthorized_km,
      RANK() OVER (PARTITION BY ds.score_type ORDER BY ds.composite_score DESC NULLS LAST) as rank
    FROM fleet_driver_scores ds
    JOIN staff s ON ds.staff_id = s.id
    WHERE ds.score_date = (
      SELECT MAX(score_date)
      FROM fleet_driver_scores ds2
      WHERE ds2.score_type = ds.score_type
    )
  `;
  console.log('   ✓ v_fleet_driver_leaderboard created');

  // Also create the trigger function if it doesn't exist
  console.log('\n5. Creating trigger function...');
  await sql`
    CREATE OR REPLACE FUNCTION update_fleet_analytics_updated_at()
    RETURNS TRIGGER AS $$
    BEGIN
      NEW.updated_at = NOW();
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql
  `;
  console.log('   ✓ Trigger function created');

  // Verify all views
  console.log('\n' + '='.repeat(50));
  console.log('Verifying created views...\n');

  const views = await sql`
    SELECT table_name
    FROM information_schema.views
    WHERE table_schema = 'public'
    AND table_name LIKE 'v_fleet%'
    ORDER BY table_name
  `;

  console.log('Fleet views in database:');
  views.forEach(v => console.log(`  ✓ ${v.table_name}`));

  // Test the TCO view
  const tcoCount = await sql`SELECT COUNT(*) as count FROM v_fleet_tco_summary`;
  console.log(`\n✓ v_fleet_tco_summary contains ${tcoCount[0].count} vehicles`);

  console.log('\n' + '='.repeat(50));
  console.log('All views created successfully!');
}

createViews().catch(e => {
  console.error('\nError:', e.message);
  process.exit(1);
});
