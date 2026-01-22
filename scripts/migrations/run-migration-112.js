/**
 * Run Migration 112: Staff Notifications Table
 */

const { neon } = require('@neondatabase/serverless');
const fs = require('fs');
const path = require('path');

const DATABASE_URL = process.env.DATABASE_URL ||
  'postgresql://neondb_owner:npg_MIUZXrg1tEY0@ep-dry-night-a9qyh4sj-pooler.gwc.azure.neon.tech/neondb?sslmode=require';

const sql = neon(DATABASE_URL);

async function runMigration() {
  console.log('Running migration 112: Staff Notifications Table...\n');

  try {
    // Create staff_notifications table
    await sql`
      CREATE TABLE IF NOT EXISTS staff_notifications (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        notification_type VARCHAR(50) NOT NULL,
        recipient_email VARCHAR(255) NOT NULL,
        subject VARCHAR(500) NOT NULL,
        message TEXT,
        metadata JSONB DEFAULT '{}',
        status VARCHAR(20) DEFAULT 'sent',
        error_message TEXT,
        sent_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )
    `;
    console.log('✓ Created staff_notifications table');

    // Create indexes
    try {
      await sql`CREATE INDEX IF NOT EXISTS idx_staff_notifications_type ON staff_notifications(notification_type)`;
      console.log('✓ Created index on notification_type');
    } catch (e) {
      console.log('⚠ Index on notification_type may already exist');
    }

    try {
      await sql`CREATE INDEX IF NOT EXISTS idx_staff_notifications_sent_at ON staff_notifications(sent_at DESC)`;
      console.log('✓ Created index on sent_at');
    } catch (e) {
      console.log('⚠ Index on sent_at may already exist');
    }

    try {
      await sql`CREATE INDEX IF NOT EXISTS idx_staff_notifications_status ON staff_notifications(status)`;
      console.log('✓ Created index on status');
    } catch (e) {
      console.log('⚠ Index on status may already exist');
    }

    // Add expiry columns to staff table if they don't exist
    const checkColumns = await sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'staff'
      AND column_name IN ('medical_certificate_expiry', 'police_clearance_expiry', 'work_permit_expiry')
    `;

    const existingColumns = checkColumns.map(r => r.column_name);

    if (!existingColumns.includes('medical_certificate_expiry')) {
      await sql`ALTER TABLE staff ADD COLUMN medical_certificate_expiry DATE`;
      console.log('✓ Added medical_certificate_expiry column');
    } else {
      console.log('⚠ medical_certificate_expiry column already exists');
    }

    if (!existingColumns.includes('police_clearance_expiry')) {
      await sql`ALTER TABLE staff ADD COLUMN police_clearance_expiry DATE`;
      console.log('✓ Added police_clearance_expiry column');
    } else {
      console.log('⚠ police_clearance_expiry column already exists');
    }

    if (!existingColumns.includes('work_permit_expiry')) {
      await sql`ALTER TABLE staff ADD COLUMN work_permit_expiry DATE`;
      console.log('✓ Added work_permit_expiry column');
    } else {
      console.log('⚠ work_permit_expiry column already exists');
    }

    console.log('\n✅ Migration 112 completed successfully!');
  } catch (error) {
    console.error('\n❌ Migration failed:', error.message);
    process.exit(1);
  }
}

runMigration();
