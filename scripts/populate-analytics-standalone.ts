/**
 * Standalone Analytics Data Population Script
 * Generates 180 days of comprehensive time-series analytics data
 * with realistic patterns, seasonality, and variance
 */

import { neon } from '@neondatabase/serverless';

const DATABASE_URL = process.env.DATABASE_URL || 'process.env.DATABASE_URL';

interface PopulationConfig {
  startDate: Date;
  endDate: Date;
  daysBack: number;
}

class AnalyticsDataPopulator {
  private config: PopulationConfig;
  private sql: ReturnType<typeof neon>;
  
  constructor() {
    const endDate = new Date();
    const startDate = new Date(endDate);
    startDate.setDate(startDate.getDate() - 180);
    
    this.config = {
      startDate,
      endDate,
      daysBack: 180
    };
    
    this.sql = neon(DATABASE_URL);
  }

  async populateAll() {
    console.log('🚀 Starting Analytics Data Population...');
    console.log(`📅 Date Range: ${this.config.startDate.toISOString().split('T')[0]} to ${this.config.endDate.toISOString().split('T')[0]}`);
    
    try {
      await this.createTables();
      await this.clearExistingData();
      await this.populateKPIMetrics();
      await this.populateStaffPerformance();
      await this.populateMaterialUsage();
      await this.populateProjectAnalytics();
      await this.populateClientAnalytics();
      await this.populateFinancialTransactions();
      
      console.log('✅ Analytics data population completed successfully!');
      await this.showSummary();
    } catch (error) {
      console.error('❌ Error populating analytics data:', error);
      throw error;
    }
  }

  private async createTables() {
    console.log('📋 Creating analytics tables...');
    
    // Create KPI Metrics table
    await this.sql`
      CREATE TABLE IF NOT EXISTS kpi_metrics (
        id SERIAL PRIMARY KEY,
        project_id VARCHAR(255),
        metric_type VARCHAR(100) NOT NULL,
        metric_name TEXT NOT NULL,
        metric_value DECIMAL(15,4) NOT NULL,
        unit VARCHAR(50),
        team_id VARCHAR(255),
        contractor_id VARCHAR(255),
        recorded_date TIMESTAMP NOT NULL,
        week_number INTEGER,
        month_number INTEGER,
        year INTEGER,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `;

    // Create Staff Performance table
    await this.sql`
      CREATE TABLE IF NOT EXISTS staff_performance (
        id SERIAL PRIMARY KEY,
        staff_id VARCHAR(255) NOT NULL,
        staff_name TEXT NOT NULL,
        project_id VARCHAR(255),
        hours_worked DECIMAL(8,2) DEFAULT 0,
        tasks_completed INTEGER DEFAULT 0,
        quality_score DECIMAL(5,2),
        safety_score DECIMAL(5,2),
        period_type VARCHAR(20) NOT NULL,
        period_start TIMESTAMP NOT NULL,
        period_end TIMESTAMP NOT NULL,
        productivity DECIMAL(8,4),
        efficiency DECIMAL(5,2),
        calculated_at TIMESTAMP DEFAULT NOW(),
        created_at TIMESTAMP DEFAULT NOW()
      );
    `;

    // Create Material Usage table
    await this.sql`
      CREATE TABLE IF NOT EXISTS material_usage (
        id SERIAL PRIMARY KEY,
        project_id VARCHAR(255) NOT NULL,
        material_type VARCHAR(100) NOT NULL,
        material_name TEXT NOT NULL,
        quantity_used DECIMAL(15,4) NOT NULL,
        quantity_wasted DECIMAL(15,4) DEFAULT 0,
        unit VARCHAR(20) NOT NULL,
        unit_cost DECIMAL(15,2),
        total_cost DECIMAL(15,2),
        work_order_id VARCHAR(255),
        team_id VARCHAR(255),
        used_by VARCHAR(255),
        usage_date TIMESTAMP NOT NULL,
        recorded_at TIMESTAMP DEFAULT NOW()
      );
    `;

    // Create Project Analytics table
    await this.sql`
      CREATE TABLE IF NOT EXISTS project_analytics (
        id SERIAL PRIMARY KEY,
        project_id VARCHAR(255) NOT NULL,
        project_name TEXT NOT NULL,
        client_id VARCHAR(255),
        client_name TEXT,
        total_poles INTEGER DEFAULT 0,
        completed_poles INTEGER DEFAULT 0,
        total_drops INTEGER DEFAULT 0,
        completed_drops INTEGER DEFAULT 0,
        total_budget DECIMAL(15,2),
        spent_budget DECIMAL(15,2),
        start_date TIMESTAMP,
        end_date TIMESTAMP,
        actual_end_date TIMESTAMP,
        completion_percentage DECIMAL(5,2),
        on_time_delivery BOOLEAN,
        quality_score DECIMAL(5,2),
        last_synced_at TIMESTAMP DEFAULT NOW(),
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `;

    // Create Client Analytics table
    await this.sql`
      CREATE TABLE IF NOT EXISTS client_analytics (
        id SERIAL PRIMARY KEY,
        client_id VARCHAR(255) NOT NULL UNIQUE,
        client_name TEXT NOT NULL,
        total_projects INTEGER DEFAULT 0,
        active_projects INTEGER DEFAULT 0,
        completed_projects INTEGER DEFAULT 0,
        total_revenue DECIMAL(15,2),
        outstanding_balance DECIMAL(15,2),
        average_project_value DECIMAL(15,2),
        payment_score DECIMAL(5,2),
        average_project_duration INTEGER,
        on_time_completion_rate DECIMAL(5,2),
        satisfaction_score DECIMAL(5,2),
        last_project_date TIMESTAMP,
        next_follow_up_date TIMESTAMP,
        total_interactions INTEGER DEFAULT 0,
        client_category VARCHAR(50),
        lifetime_value DECIMAL(15,2),
        last_calculated_at TIMESTAMP DEFAULT NOW(),
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `;

    // Create Financial Transactions table
    await this.sql`
      CREATE TABLE IF NOT EXISTS financial_transactions (
        id VARCHAR(255) PRIMARY KEY,
        transaction_type VARCHAR(50) NOT NULL,
        project_id VARCHAR(255),
        client_id VARCHAR(255),
        supplier_id VARCHAR(255),
        amount DECIMAL(15,2) NOT NULL,
        currency VARCHAR(3) DEFAULT 'ZAR',
        status VARCHAR(50) NOT NULL,
        invoice_number VARCHAR(100),
        po_number VARCHAR(100),
        transaction_date TIMESTAMP NOT NULL,
        due_date TIMESTAMP,
        paid_date TIMESTAMP,
        description TEXT,
        notes TEXT,
        created_by VARCHAR(255),
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `;

    console.log('✅ Analytics tables created');
  }

  private async clearExistingData() {
    console.log('🧹 Clearing existing analytics data...');
    
    try {
      await this.sql`TRUNCATE TABLE kpi_metrics CASCADE;`;
      await this.sql`TRUNCATE TABLE staff_performance CASCADE;`;
      await this.sql`TRUNCATE TABLE material_usage CASCADE;`;
      await this.sql`TRUNCATE TABLE project_analytics CASCADE;`;
      await this.sql`TRUNCATE TABLE client_analytics CASCADE;`;
      await this.sql`TRUNCATE TABLE financial_transactions CASCADE;`;
      
      console.log('✅ Cleared existing data');
    } catch (error) {
      console.log('ℹ️  Some tables might not exist yet, continuing...');
    }
  }

  private async populateKPIMetrics() {
    console.log('📊 Generating KPI Metrics time-series data...');
    
    // Generate 180 days of KPI metrics with realistic patterns
    await this.sql`
      INSERT INTO kpi_metrics (
        project_id, metric_type, metric_name, metric_value, unit,
        team_id, contractor_id, recorded_date, week_number, month_number, year
      )
      SELECT 
        'proj_' || (random() * 50 + 1)::int as project_id,
        metric_types.type as metric_type,
        metric_types.name as metric_name,
        CASE 
          WHEN metric_types.type = 'productivity' THEN
            -- Productivity with weekday vs weekend patterns + seasonality
            (70 + 25 * sin(2 * PI() * date_series.day_num / 7) + 
             10 * sin(2 * PI() * date_series.day_num / 365) + 
             (random() - 0.5) * 15 + 
             CASE WHEN extract(dow from date_series.date) IN (0,6) THEN -20 ELSE 0 END)::decimal(15,4)
          
          WHEN metric_types.type = 'quality' THEN
            -- Quality score (0-100) with gradual improvement over time
            (85 + 10 * date_series.day_num / 180 + 
             5 * sin(2 * PI() * date_series.day_num / 30) + 
             (random() - 0.5) * 8)::decimal(15,4)
          
          WHEN metric_types.type = 'safety' THEN
            -- Safety incidents (lower is better)
            greatest(0, (2 + sin(2 * PI() * date_series.day_num / 90) + 
             (random() - 0.5) * 1.5 + 
             CASE WHEN extract(dow from date_series.date) IN (0,6) THEN -0.5 ELSE 0 END))::decimal(15,4)
          
          WHEN metric_types.type = 'cost' THEN
            -- Cost efficiency (ZAR per unit)
            (450 + 100 * sin(2 * PI() * date_series.day_num / 365) + 
             (random() - 0.5) * 75 + 
             25 * date_series.day_num / 180)::decimal(15,4)
        END as metric_value,
        metric_types.unit,
        'team_' || (random() * 10 + 1)::int as team_id,
        'contractor_' || (random() * 20 + 1)::int as contractor_id,
        date_series.date as recorded_date,
        extract(week from date_series.date)::int as week_number,
        extract(month from date_series.date)::int as month_number,
        extract(year from date_series.date)::int as year
      FROM (
        SELECT 
          generate_series(
            current_date - interval '180 days',
            current_date,
            interval '1 day'
          ) as date,
          row_number() over() as day_num
      ) as date_series
      CROSS JOIN (
        VALUES 
          ('productivity', 'Poles Installed Per Day', 'poles/day'),
          ('productivity', 'Drops Completed Per Day', 'drops/day'),
          ('productivity', 'Fiber Meters Per Hour', 'm/hour'),
          ('quality', 'Installation Quality Score', 'score'),
          ('quality', 'Customer Satisfaction', 'score'),
          ('safety', 'Safety Incidents', 'incidents'),
          ('safety', 'Near Misses Reported', 'incidents'),
          ('cost', 'Material Cost Per Pole', 'ZAR'),
          ('cost', 'Labor Cost Per Drop', 'ZAR')
      ) as metric_types(type, name, unit);
    `;
    
    console.log('✅ KPI metrics populated');
  }

  private async populateStaffPerformance() {
    console.log('👥 Generating Staff Performance data...');
    
    await this.sql`
      INSERT INTO staff_performance (
        staff_id, staff_name, project_id, hours_worked, tasks_completed,
        quality_score, safety_score, period_type, period_start, period_end,
        productivity, efficiency
      )
      SELECT 
        'staff_' || staff_num as staff_id,
        staff_names.name || ' ' || surnames.surname as staff_name,
        'proj_' || (random() * 50 + 1)::int as project_id,
        -- Hours worked with realistic patterns
        (35 + 10 * sin(2 * PI() * date_series.week_num / 52) + 
         (random() - 0.5) * 8 + 
         CASE WHEN extract(dow from date_series.week_start) = 1 THEN 5 ELSE 0 END)::decimal(8,2) as hours_worked,
        -- Tasks completed
        (25 + 8 * sin(2 * PI() * date_series.week_num / 26) + 
         (random() - 0.5) * 10)::int as tasks_completed,
        -- Quality score improving over time
        (75 + 15 * date_series.week_num / 26 + 
         5 * sin(2 * PI() * date_series.week_num / 13) + 
         (random() - 0.5) * 10)::decimal(5,2) as quality_score,
        -- Safety score (high is good)
        (90 + 5 * sin(2 * PI() * date_series.week_num / 52) + 
         (random() - 0.5) * 6)::decimal(5,2) as safety_score,
        'weekly' as period_type,
        date_series.week_start as period_start,
        date_series.week_start + interval '6 days' as period_end,
        -- Productivity calculated field
        (2.5 + 0.8 * sin(2 * PI() * date_series.week_num / 52) + 
         (random() - 0.5) * 0.5)::decimal(8,4) as productivity,
        -- Efficiency percentage
        (82 + 12 * date_series.week_num / 26 + 
         4 * sin(2 * PI() * date_series.week_num / 13) + 
         (random() - 0.5) * 8)::decimal(5,2) as efficiency
      FROM (
        SELECT 
          generate_series(
            date_trunc('week', current_date - interval '180 days'),
            date_trunc('week', current_date),
            interval '1 week'
          ) as week_start,
          row_number() over() as week_num
      ) as date_series
      CROSS JOIN generate_series(1, 25) as staff_num
      CROSS JOIN (
        VALUES ('John'), ('Sarah'), ('Mike'), ('Lisa'), ('David'), ('Emma'), ('Chris'), ('Anna'), ('Tom'), ('Kate')
      ) as staff_names(name)
      CROSS JOIN (
        VALUES ('Smith'), ('Johnson'), ('Brown'), ('Davis'), ('Wilson'), ('Taylor'), ('Anderson'), ('Thomas')
      ) as surnames(surname)
      WHERE staff_num <= 25;
    `;
    
    console.log('✅ Staff performance data populated');
  }

  private async populateMaterialUsage() {
    console.log('🔧 Generating Material Usage analytics...');
    
    await this.sql`
      INSERT INTO material_usage (
        project_id, material_type, material_name, quantity_used, quantity_wasted,
        unit, unit_cost, total_cost, work_order_id, team_id, used_by, usage_date
      )
      SELECT 
        'proj_' || (random() * 50 + 1)::int as project_id,
        materials.type as material_type,
        materials.name as material_name,
        -- Quantity used with seasonal patterns
        (materials.base_qty * (1 + 0.3 * sin(2 * PI() * date_series.day_num / 365)) * 
         (0.8 + 0.4 * random()))::decimal(15,4) as quantity_used,
        -- Waste typically 5-10% with some variance
        (materials.base_qty * (0.05 + 0.05 * random()) * 
         (0.8 + 0.4 * random()))::decimal(15,4) as quantity_wasted,
        materials.unit,
        -- Unit cost in ZAR with inflation over time
        (materials.base_cost * (1 + 0.15 * date_series.day_num / 180) * 
         (0.9 + 0.2 * random()))::decimal(15,2) as unit_cost,
        -- Total cost calculated
        ((materials.base_qty * (1 + 0.3 * sin(2 * PI() * date_series.day_num / 365)) * 
          (0.8 + 0.4 * random())) * 
         (materials.base_cost * (1 + 0.15 * date_series.day_num / 180) * 
          (0.9 + 0.2 * random())))::decimal(15,2) as total_cost,
        'wo_' || (random() * 1000 + 1)::int as work_order_id,
        'team_' || (random() * 10 + 1)::int as team_id,
        'tech_' || (random() * 50 + 1)::int as used_by,
        date_series.date as usage_date
      FROM (
        SELECT 
          generate_series(
            current_date - interval '180 days',
            current_date,
            interval '1 day'
          ) as date,
          row_number() over() as day_num
      ) as date_series
      CROSS JOIN (
        VALUES 
          ('fiber', 'Single Mode Fiber Cable', 1500, 'meters', 45.00),
          ('fiber', 'Multi Mode Fiber Cable', 800, 'meters', 38.50),
          ('hardware', 'Fiber Splice Closure', 12, 'units', 285.00),
          ('hardware', 'Fiber Optic Connector SC/APC', 24, 'units', 15.75),
          ('hardware', 'Drop Cable 2-Core', 200, 'meters', 12.50),
          ('poles', 'Concrete Utility Pole 9m', 2, 'units', 1850.00),
          ('poles', 'Steel Cross Arm', 4, 'units', 265.00),
          ('hardware', 'Fiber Distribution Hub', 1, 'units', 2750.00),
          ('tools', 'Fusion Splicer Electrodes', 2, 'sets', 95.00),
          ('consumables', 'Cable Ties UV Resistant', 50, 'pieces', 2.85)
      ) as materials(type, name, base_qty, unit, base_cost)
      WHERE random() < 0.7; -- Not all materials used every day
    `;
    
    console.log('✅ Material usage data populated');
  }

  private async populateProjectAnalytics() {
    console.log('🏗️ Generating Project Analytics...');
    
    await this.sql`
      INSERT INTO project_analytics (
        project_id, project_name, client_id, client_name, total_poles, completed_poles,
        total_drops, completed_drops, total_budget, spent_budget, start_date, end_date,
        actual_end_date, completion_percentage, on_time_delivery, quality_score
      )
      SELECT 
        'proj_' || proj_num as project_id,
        project_types.name || ' - ' || locations.location || ' Phase ' || (proj_num % 5 + 1) as project_name,
        'client_' || (random() * 20 + 1)::int as client_id,
        clients.name as client_name,
        -- Project scale varies
        (50 + random() * 200)::int as total_poles,
        -- Completion varies by project age
        CASE 
          WHEN start_offset < 90 THEN (proj_completion * total_poles)::int
          ELSE total_poles
        END as completed_poles,
        -- Drops typically 3-8 per pole
        (total_poles * (3 + random() * 5))::int as total_drops,
        CASE 
          WHEN start_offset < 90 THEN ((total_poles * (3 + random() * 5)) * proj_completion)::int
          ELSE (total_poles * (3 + random() * 5))::int
        END as completed_drops,
        -- Budget in ZAR (realistic fiber project costs)
        (total_poles * (8500 + random() * 3500))::decimal(15,2) as total_budget,
        -- Spent budget with realistic burn rate
        ((total_poles * (8500 + random() * 3500)) * 
         (proj_completion * (0.85 + random() * 0.25)))::decimal(15,2) as spent_budget,
        (current_date - (start_offset || ' days')::interval) as start_date,
        (current_date - (start_offset || ' days')::interval + 
         (duration_days || ' days')::interval) as end_date,
        CASE 
          WHEN start_offset < 30 THEN NULL -- Project still running
          ELSE (current_date - (start_offset || ' days')::interval + 
                (duration_days || ' days')::interval + 
                (round((random() - 0.5) * 14) || ' days')::interval)
        END as actual_end_date,
        (proj_completion * 100)::decimal(5,2) as completion_percentage,
        CASE 
          WHEN start_offset < 30 THEN NULL
          WHEN random() > 0.25 THEN true
          ELSE false
        END as on_time_delivery,
        (75 + random() * 20)::decimal(5,2) as quality_score
      FROM (
        SELECT 
          proj_num,
          -- Project start dates spread over 180 days
          (random() * 180)::int as start_offset,
          -- Project duration 30-120 days
          (30 + random() * 90)::int as duration_days,
          -- Different completion stages
          CASE 
            WHEN random() < 0.3 THEN random() * 0.4 -- Early stage
            WHEN random() < 0.6 THEN 0.4 + random() * 0.4 -- Mid stage
            ELSE 0.8 + random() * 0.2 -- Near completion
          END as proj_completion,
          (50 + random() * 200)::int as total_poles
        FROM generate_series(1, 50) as proj_num
      ) as project_data
      CROSS JOIN (
        VALUES 
          ('Fiber Network Deployment'),
          ('FTTH Rollout'),
          ('Network Infrastructure'),
          ('Fiber Backbone Installation'),
          ('Last Mile Connectivity')
      ) as project_types(name)
      CROSS JOIN (
        VALUES 
          ('Cape Town CBD'), ('Stellenbosch'), ('Paarl'), ('Somerset West'), 
          ('Bellville'), ('Durbanville'), ('Brackenfell'), ('Kuils River'),
          ('Goodwood'), ('Parow'), ('Milnerton'), ('Century City')
      ) as locations(location)
      CROSS JOIN (
        VALUES 
          ('Vumatel'), ('Octotel'), ('MetroFibre'), ('OpenServe'), 
          ('Frogfoot'), ('Rise Fiber'), ('Herotel'), ('Cybersmart')
      ) as clients(name)
      WHERE proj_num <= 50;
    `;
    
    console.log('✅ Project analytics populated');
  }

  private async populateClientAnalytics() {
    console.log('🤝 Generating Client Analytics...');
    
    await this.sql`
      INSERT INTO client_analytics (
        client_id, client_name, total_projects, active_projects, completed_projects,
        total_revenue, outstanding_balance, average_project_value, payment_score,
        average_project_duration, on_time_completion_rate, satisfaction_score,
        last_project_date, next_follow_up_date, total_interactions, client_category, lifetime_value
      )
      WITH client_data AS (
        SELECT 
          'client_' || client_num as client_id,
          client_names.name as client_name,
          client_num,
          -- Project distribution varies by client size
          CASE 
            WHEN random() < 0.2 THEN (8 + random() * 15)::int -- Large clients
            WHEN random() < 0.5 THEN (3 + random() * 8)::int  -- Medium clients
            ELSE (1 + random() * 4)::int                      -- Small clients
          END as total_proj,
          (random() * 3 + 1)::int as active_proj
        FROM generate_series(1, 20) as client_num
        JOIN (
          VALUES 
            (1, 'Vumatel'), (2, 'Octotel'), (3, 'MetroFibre'), (4, 'OpenServe'), 
            (5, 'Frogfoot'), (6, 'Rise Fiber'), (7, 'Herotel'), (8, 'Cybersmart'),
            (9, 'WebAfrica'), (10, 'Mweb'), (11, 'Rain'), (12, 'Telkom'),
            (13, 'MTN Fiber'), (14, 'Vodacom Fiber'), (15, 'Cell C Fiber'), (16, 'TelkomOne'),
            (17, 'Axxess'), (18, 'Webafrica Business'), (19, 'IS'), (20, 'Internet Solutions')
        ) as client_names(id, name) ON client_num = client_names.id
      )
      SELECT 
        client_id,
        client_name,
        total_proj as total_projects,
        active_proj as active_projects,
        greatest(0, total_proj - active_proj - (random() * 2)::int) as completed_projects,
        -- Revenue in ZAR millions for major ISPs
        (total_proj * (2500000 + random() * 5000000))::decimal(15,2) as total_revenue,
        -- Outstanding balance (5-15% of revenue)
        ((total_proj * (2500000 + random() * 5000000)) * 
         (0.05 + random() * 0.1))::decimal(15,2) as outstanding_balance,
        (2500000 + random() * 5000000)::decimal(15,2) as average_project_value,
        -- Payment score (higher for established ISPs)
        CASE 
          WHEN client_name IN ('Vumatel', 'Octotel', 'MetroFibre', 'OpenServe') THEN (85 + random() * 15)::decimal(5,2)
          ELSE (70 + random() * 20)::decimal(5,2)
        END as payment_score,
        (45 + random() * 30)::int as average_project_duration,
        -- On-time rate varies by client maturity
        CASE 
          WHEN client_name IN ('Vumatel', 'Octotel') THEN (80 + random() * 15)::decimal(5,2)
          ELSE (65 + random() * 25)::decimal(5,2)
        END as on_time_completion_rate,
        (75 + random() * 20)::decimal(5,2) as satisfaction_score,
        (current_date - (round(random() * 90) || ' days')::interval) as last_project_date,
        (current_date + (round(random() * 30) || ' days')::interval) as next_follow_up_date,
        (total_proj * (8 + random() * 15))::int as total_interactions,
        CASE 
          WHEN client_name IN ('Vumatel', 'Octotel', 'MetroFibre') THEN 'VIP'
          WHEN total_proj >= 5 THEN 'Regular'
          ELSE 'Standard'
        END as client_category,
        -- Lifetime value calculation
        (total_proj * (2500000 + random() * 5000000) * 
         (1 + total_proj * 0.1))::decimal(15,2) as lifetime_value
      FROM client_data;
    `;
    
    console.log('✅ Client analytics populated');
  }

  private async populateFinancialTransactions() {
    console.log('💰 Generating Financial Transaction history...');
    
    await this.sql`
      INSERT INTO financial_transactions (
        id, transaction_type, project_id, client_id, amount, currency, status,
        invoice_number, po_number, transaction_date, due_date, paid_date,
        description, notes, created_by
      )
      SELECT 
        'txn_' || row_number() over() as id,
        transaction_types.type as transaction_type,
        'proj_' || (random() * 50 + 1)::int as project_id,
        'client_' || (random() * 20 + 1)::int as client_id,
        -- Transaction amounts in ZAR
        CASE 
          WHEN transaction_types.type = 'invoice' THEN
            (250000 + random() * 2000000)::decimal(15,2)
          WHEN transaction_types.type = 'payment' THEN
            (250000 + random() * 2000000)::decimal(15,2)
          WHEN transaction_types.type = 'expense' THEN
            (5000 + random() * 150000)::decimal(15,2)
        END as amount,
        'ZAR' as currency,
        -- Status distribution
        CASE 
          WHEN date_series.date < current_date - interval '60 days' AND transaction_types.type != 'expense' THEN
            CASE WHEN random() < 0.9 THEN 'paid' ELSE 'overdue' END
          WHEN date_series.date < current_date - interval '30 days' AND transaction_types.type != 'expense' THEN
            CASE WHEN random() < 0.7 THEN 'paid' WHEN random() < 0.9 THEN 'approved' ELSE 'pending' END
          ELSE
            CASE WHEN random() < 0.3 THEN 'paid' WHEN random() < 0.6 THEN 'approved' ELSE 'pending' END
        END as status,
        CASE 
          WHEN transaction_types.type = 'invoice' THEN 'INV-' || to_char(date_series.date, 'YYYY') || '-' || lpad((row_number() over())::text, 4, '0')
          ELSE NULL
        END as invoice_number,
        CASE 
          WHEN transaction_types.type != 'payment' THEN 'PO-' || to_char(date_series.date, 'YYYY') || '-' || lpad((random() * 9999 + 1)::int::text, 4, '0')
          ELSE NULL
        END as po_number,
        date_series.date as transaction_date,
        CASE 
          WHEN transaction_types.type IN ('invoice', 'expense') THEN 
            date_series.date + interval '30 days'
          ELSE NULL
        END as due_date,
        CASE 
          WHEN (CASE 
            WHEN date_series.date < current_date - interval '60 days' AND transaction_types.type != 'expense' THEN
              CASE WHEN random() < 0.9 THEN 'paid' ELSE 'overdue' END
            WHEN date_series.date < current_date - interval '30 days' AND transaction_types.type != 'expense' THEN
              CASE WHEN random() < 0.7 THEN 'paid' WHEN random() < 0.9 THEN 'approved' ELSE 'pending' END
            ELSE
              CASE WHEN random() < 0.3 THEN 'paid' WHEN random() < 0.6 THEN 'approved' ELSE 'pending' END
          END) IN ('paid') THEN 
            date_series.date + (round(random() * 45) || ' days')::interval
          ELSE NULL
        END as paid_date,
        transaction_types.description as description,
        CASE 
          WHEN random() < 0.3 THEN 'Auto-generated transaction for analytics'
          ELSE NULL
        END as notes,
        'system_user' as created_by
      FROM (
        SELECT 
          generate_series(
            current_date - interval '180 days',
            current_date,
            interval '1 day'
          ) as date,
          row_number() over() as day_num
      ) as date_series
      CROSS JOIN (
        VALUES 
          ('invoice', 'Project milestone payment'),
          ('invoice', 'Material supply invoice'),
          ('payment', 'Client payment received'),
          ('expense', 'Material purchase'),
          ('expense', 'Equipment rental'),
          ('expense', 'Subcontractor payment')
      ) as transaction_types(type, description)
      WHERE random() < 0.4; -- Not every type every day
    `;
    
    console.log('✅ Financial transactions populated');
  }

  private async showSummary() {
    console.log('\n📈 Analytics Data Summary:');
    
    const tables = [
      'kpi_metrics',
      'staff_performance',
      'material_usage',
      'project_analytics',
      'client_analytics',
      'financial_transactions'
    ];
    
    for (const table of tables) {
      try {
        const result = await this.sql(`SELECT COUNT(*) as count FROM ${table};`);
        const count = result[0]?.count || 0;
        console.log(`  ${table}: ${count} records`);
      } catch (error) {
        console.log(`  ${table}: Table may not exist`);
      }
    }
    
    // Show date ranges
    try {
      const dateRanges = await this.sql`
        SELECT 
          'kpi_metrics' as table_name,
          MIN(recorded_date)::date as start_date,
          MAX(recorded_date)::date as end_date
        FROM kpi_metrics
        UNION ALL
        SELECT 
          'financial_transactions' as table_name,
          MIN(transaction_date)::date as start_date,
          MAX(transaction_date)::date as end_date
        FROM financial_transactions
        UNION ALL
        SELECT 
          'material_usage' as table_name,
          MIN(usage_date)::date as start_date,
          MAX(usage_date)::date as end_date
        FROM material_usage;
      `;
      
      console.log('\n📅 Date Ranges:');
      dateRanges.forEach((range: any) => {
        console.log(`  ${range.table_name}: ${range.start_date} to ${range.end_date}`);
      });
    } catch (error) {
      console.log('📅 Could not retrieve date ranges');
    }
    
    // Show sample metrics
    try {
      const metrics = await this.sql`
        SELECT 
          metric_type,
          metric_name,
          AVG(metric_value::numeric) as avg_value,
          MIN(metric_value::numeric) as min_value,
          MAX(metric_value::numeric) as max_value,
          unit
        FROM kpi_metrics
        GROUP BY metric_type, metric_name, unit
        ORDER BY metric_type, metric_name;
      `;
      
      console.log('\n📊 Sample KPI Metrics:');
      metrics.forEach((metric: any) => {
        console.log(`  ${metric.metric_name}: ${Number(metric.avg_value).toFixed(2)} ${metric.unit} (${Number(metric.min_value).toFixed(1)}-${Number(metric.max_value).toFixed(1)})`);
      });
    } catch (error) {
      console.log('📊 Could not retrieve sample metrics');
    }
  }
}

// Execute the population
async function main() {
  try {
    const populator = new AnalyticsDataPopulator();
    await populator.populateAll();
    process.exit(0);
  } catch (error) {
    console.error('❌ Population failed:', error);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  main();
}

export { AnalyticsDataPopulator };