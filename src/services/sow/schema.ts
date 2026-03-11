/**
 * SOW Database Schema Manager
 * Handles database table creation and initialization
 */

import { getSql } from '@/lib/neon-sql';
import { SOWTableType } from './types';
import { log } from '@/lib/logger';

const query = (sqlString: string) => {
  const sql = getSql();
  return sql([sqlString] as unknown as TemplateStringsArray);
};

/**
 * Helper function to safely create table names
 */
export function getTableName(projectId: string, tableType: SOWTableType): string {
  const safeProjectId = projectId.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
  return `sow_${tableType}_${safeProjectId}`;
}

/**
 * SOW database schema management
 */
export class SOWSchemaService {
  /**
   * Initialize all database tables for a project
   */
  static async initializeTables(projectId: string): Promise<{ success: boolean }> {
    try {
      await Promise.all([
        this.createPolesTable(projectId),
        this.createDropsTable(projectId),
        this.createFibreTable(projectId),
        this.createProjectSummaryTable()
      ]);

      return { success: true };
    } catch (error) {
      log.error('Error initializing Neon tables:', { data: error }, 'schema');
      throw error;
    }
  }

  /**
   * Create poles table for a project
   */
  private static async createPolesTable(projectId: string): Promise<void> {
    const tableName = getTableName(projectId, 'poles');
    
    await query(`
      CREATE TABLE IF NOT EXISTS ${tableName} (
        id SERIAL PRIMARY KEY,
        project_id VARCHAR(255) NOT NULL,
        pole_number VARCHAR(255) UNIQUE NOT NULL,
        latitude DECIMAL(10, 8),
        longitude DECIMAL(11, 8),
        status VARCHAR(100),
        pole_type VARCHAR(100),
        pole_spec VARCHAR(255),
        height VARCHAR(50),
        diameter VARCHAR(50),
        owner VARCHAR(100),
        pon_no INTEGER,
        zone_no INTEGER,
        address TEXT,
        municipality VARCHAR(255),
        created_date TIMESTAMP,
        created_by VARCHAR(100),
        comments TEXT,
        raw_data JSONB,
        uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
  }

  /**
   * Create drops table for a project
   */
  private static async createDropsTable(projectId: string): Promise<void> {
    const tableName = getTableName(projectId, 'drops');
    
    await query(`
      CREATE TABLE IF NOT EXISTS ${tableName} (
        id SERIAL PRIMARY KEY,
        project_id VARCHAR(255) NOT NULL,
        drop_number VARCHAR(255) UNIQUE NOT NULL,
        pole_number VARCHAR(255),
        cable_type VARCHAR(100),
        cable_spec VARCHAR(255),
        cable_length VARCHAR(50),
        cable_capacity VARCHAR(50),
        start_point VARCHAR(255),
        end_point VARCHAR(255),
        latitude DECIMAL(10, 8),
        longitude DECIMAL(11, 8),
        address TEXT,
        pon_no INTEGER,
        zone_no INTEGER,
        municipality VARCHAR(255),
        created_date TIMESTAMP,
        created_by VARCHAR(100),
        raw_data JSONB,
        uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
  }

  /**
   * Create fibre table for a project
   */
  private static async createFibreTable(projectId: string): Promise<void> {
    const tableName = getTableName(projectId, 'fibre');
    
    await query(`
      CREATE TABLE IF NOT EXISTS ${tableName} (
        id SERIAL PRIMARY KEY,
        project_id VARCHAR(255) NOT NULL,
        segment_id VARCHAR(255) UNIQUE NOT NULL,
        cable_size VARCHAR(50),
        layer VARCHAR(100),
        length DECIMAL(10, 2),
        pon_no INTEGER,
        zone_no INTEGER,
        string_completed DECIMAL(10, 2),
        date_completed DATE,
        contractor VARCHAR(100),
        is_complete BOOLEAN,
        raw_data JSONB,
        uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
  }

  /**
   * Create project summary table (shared across all projects)
   */
  private static async createProjectSummaryTable(): Promise<void> {
    await query(`
      CREATE TABLE IF NOT EXISTS sow_project_summary (
        id SERIAL PRIMARY KEY,
        project_id VARCHAR(255) UNIQUE NOT NULL,
        project_name VARCHAR(255),
        total_poles INTEGER DEFAULT 0,
        total_drops INTEGER DEFAULT 0,
        total_fibre_segments INTEGER DEFAULT 0,
        total_fibre_length DECIMAL(12, 2) DEFAULT 0,
        last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
  }
}