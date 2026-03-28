import { NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';

const db = neon(process.env.DATABASE_URL!);

export async function GET() {
  try {
    // Create pon_tracker table
    await db.query(`
      CREATE TABLE IF NOT EXISTS pon_tracker (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        project_id TEXT NOT NULL,
        zone_no INTEGER,
        hld_pon INTEGER,
        z_pon INTEGER,
        olt_port TEXT,
        scope_poles INTEGER,
        scope_drops INTEGER,
        pole_permission DATE,
        poles_planted INTEGER,
        cwc_poles_date DATE,
        cwc_stringing_date DATE,
        ready_for_optical DATE,
        cwc_qa BOOLEAN DEFAULT false,
        optical_splicing_date DATE,
        optical_submitted_date DATE,
        optical_activated_date DATE,
        atp_qa BOOLEAN DEFAULT false,
        sign_ups INTEGER,
        homes_po INTEGER,
        homes_recon INTEGER,
        activated INTEGER,
        available INTEGER,
        blockage TEXT,
        created_at TIMESTAMPTZ DEFAULT now(),
        updated_at TIMESTAMPTZ DEFAULT now()
      )
    `);

    // Create master_tracker table
    await db.query(`
      CREATE TABLE IF NOT EXISTS master_tracker (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        project_id TEXT NOT NULL,
        site TEXT, phase INTEGER, dr TEXT,
        zone_no INTEGER, hld_pon INTEGER, zone_pon INTEGER,
        pole_label TEXT, unique_pole_label TEXT,
        pole_scope TEXT, pole_type TEXT, pole_route_type TEXT,
        pole_permission_date DATE, pole_install_date DATE, pole_cwc_date DATE,
        pole_contractor TEXT, pole_rate NUMERIC, pole_paid_date DATE,
        pole_invoice_no TEXT, pole_comment TEXT,
        civil_description TEXT, civil_rate NUMERIC, civil_qty INTEGER,
        civil_total NUMERIC, civil_invoice_no TEXT, civil_invoice_date DATE, civil_comment TEXT,
        stringing_description TEXT, stringing_rate NUMERIC, stringing_qty INTEGER,
        stringing_total NUMERIC, stringing_invoice_no TEXT, stringing_date DATE, stringing_comment TEXT,
        signup_date DATE, home_install_date DATE, home_contractor TEXT,
        home_rate NUMERIC, home_paid_date DATE, home_invoice_no TEXT,
        activation_code TEXT, activation_date DATE, activation_team TEXT,
        activation_rate NUMERIC, activation_paid_date DATE, activation_invoice_no TEXT,
        remittance TEXT, remittance_date DATE,
        cwc_pole_status TEXT, cwc_stringing_status TEXT,
        cwc_qa_submit_date DATE, cwc_qa_approved_date DATE, qa_home_recon_no TEXT,
        exfo_exchange TEXT, optical_contractor TEXT, optical_type TEXT,
        optical_splitter TEXT, optical_prepping DATE, optical_splicing DATE,
        qa_photos_loaded BOOLEAN DEFAULT false,
        atp_qa_submit_date DATE, atp_qa_approved_date DATE,
        testing_status TEXT, test_submitted DATE,
        olt_port_activation TEXT, olt_port_activated DATE, pon_status TEXT,
        optical_rate NUMERIC, optical_invoice_date DATE, optical_invoice_no TEXT,
        created_at TIMESTAMPTZ DEFAULT now(),
        updated_at TIMESTAMPTZ DEFAULT now()
      )
    `);

    await db.query(`
      CREATE TABLE IF NOT EXISTS tracker_selectlists (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        list_name TEXT NOT NULL,
        value TEXT NOT NULL,
        sort_order INTEGER DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT now()
      )
    `);

    await db.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS tracker_selectlists_unique
      ON tracker_selectlists(list_name, value)
    `);

    const seeds: [string, string, number][] = [
      ['Contractor','Al Ragman',0],['Contractor','SJC',1],['Contractor','CMS/Elevate',2],['Contractor','Internal',3],
      ['PoleType','Distribution Pole',0],['PoleType','Primary Feeder',1],['PoleType','Secondary Feeder',2],
      ['PoleRouteType','Distribution',0],['PoleRouteType','Feeder',1],['PoleRouteType','Backhaul',2],
      ['CWCStatus','Not Started',0],['CWCStatus','In Progress',1],['CWCStatus','Done',2],['CWCStatus','Approved',3],
      ['ActivationTeam','moa1',0],['ActivationTeam','moa2',1],['ActivationTeam','Internal',2],
      ['OpticalType','SJC',0],['OpticalType','Internal',1],
      ['OpticalSplitter','1:8',0],['OpticalSplitter','1:16',1],['OpticalSplitter','1:32',2],
      ['TestingStatus','Pending',0],['TestingStatus','Submitted',1],['TestingStatus','Passed',2],['TestingStatus','Failed',3],
      ['PonStatus','PLANNED',0],['PonStatus','WIP',1],['PonStatus','ACTIVE',2],['PonStatus','COMPLETE',3],
    ];

    for (const [listName, value, order] of seeds) {
      await db.query(
        `INSERT INTO tracker_selectlists (list_name, value, sort_order)
         VALUES ($1, $2, $3) ON CONFLICT (list_name, value) DO NOTHING`,
        [listName, value, order]
      );
    }

    return NextResponse.json({ success: true, tables: ['pon_tracker', 'master_tracker', 'tracker_selectlists'] });
  } catch (error) {
    return NextResponse.json(
      { error: 'Migration failed', details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
