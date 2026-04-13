/**
 * Neon Database Schema for FibreFlow Analytics Data
 * Placeholder schema to fix build errors
 */

import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

// Basic projects table for reference
export const projects = pgTable('projects', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  code: text('code'),
  status: text('status'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow()
});

// Basic contractors table
export const contractors = pgTable('contractors', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  email: text('email'),
  status: text('status'),
  createdAt: timestamp('created_at').defaultNow()
});

// Export all tables as neonTables
export const neonTables = {
  projects,
  contractors
};

// Default export for compatibility
export default neonTables;