#!/usr/bin/env npx ts-node
/**
 * Odoo Attachment Sync CLI
 *
 * Syncs attachments/documents from Odoo to FibreFlow
 *
 * Usage:
 *   npx ts-node scripts/odoo-sync-attachments.ts [options]
 *
 * Options:
 *   --dry-run         Preview changes without making them
 *   --model <model>   Only sync specific Odoo model (e.g., purchase.order)
 *   --limit <n>       Limit number of attachments to process
 *   --skip-orphans    Don't sync orphaned documents
 *   --stats           Show sync statistics only
 *   --orphans         List orphaned documents
 *   --help            Show this help message
 *
 * Environment:
 *   DATABASE_URL      PostgreSQL connection string (required)
 *   ODOO_URL          Odoo server URL
 *   ODOO_DB           Odoo database name
 *   ODOO_USERNAME     Odoo username
 *   ODOO_PASSWORD     Odoo password
 *
 * Examples:
 *   # Dry run to preview all attachments
 *   DATABASE_URL='...' npx ts-node scripts/odoo-sync-attachments.ts --dry-run
 *
 *   # Sync only PO attachments
 *   DATABASE_URL='...' npx ts-node scripts/odoo-sync-attachments.ts --model purchase.order
 *
 *   # Check sync statistics
 *   DATABASE_URL='...' npx ts-node scripts/odoo-sync-attachments.ts --stats
 */

import { OdooClient } from '../src/services/odoo/odooClient';
import {
  syncAttachments,
  getAttachmentSyncStats,
  getOrphanedDocuments,
} from '../src/services/odoo/entities/attachmentSync';

// ============================================================================
// Configuration
// ============================================================================

const DATABASE_URL = process.env.DATABASE_URL;
const ODOO_URL = process.env.ODOO_URL || 'https://velocityfibre.odoo.com';
const ODOO_DB = process.env.ODOO_DB || 'velocityfibre';
const ODOO_USERNAME = process.env.ODOO_USERNAME || 'hein@velocityfibre.co.za';
const ODOO_PASSWORD = process.env.ODOO_PASSWORD || 'Velocity@2025!';

// ============================================================================
// CLI Argument Parsing
// ============================================================================

interface CLIArgs {
  dryRun: boolean;
  model?: string;
  limit: number;
  skipOrphans: boolean;
  showStats: boolean;
  showOrphans: boolean;
  help: boolean;
}

function parseArgs(): CLIArgs {
  const args = process.argv.slice(2);
  const result: CLIArgs = {
    dryRun: false,
    limit: 500,
    skipOrphans: false,
    showStats: false,
    showOrphans: false,
    help: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case '--dry-run':
        result.dryRun = true;
        break;
      case '--model':
        result.model = args[++i];
        break;
      case '--limit':
        result.limit = parseInt(args[++i], 10);
        break;
      case '--skip-orphans':
        result.skipOrphans = true;
        break;
      case '--stats':
        result.showStats = true;
        break;
      case '--orphans':
        result.showOrphans = true;
        break;
      case '--help':
      case '-h':
        result.help = true;
        break;
    }
  }

  return result;
}

function showHelp(): void {
  console.log(`
Odoo Attachment Sync CLI

Usage:
  npx ts-node scripts/odoo-sync-attachments.ts [options]

Options:
  --dry-run         Preview changes without making them
  --model <model>   Only sync specific Odoo model (e.g., purchase.order)
  --limit <n>       Limit number of attachments to process (default: 500)
  --skip-orphans    Don't sync orphaned documents
  --stats           Show sync statistics only
  --orphans         List orphaned documents
  --help, -h        Show this help message

Supported Odoo Models:
  purchase.order    Purchase orders
  fleet.vehicle     Fleet vehicles
  product.product   Products
  res.partner       Suppliers/partners
  stock.picking     Stock pickings/GRN

Examples:
  # Dry run to preview all attachments
  DATABASE_URL='postgresql://...' npx ts-node scripts/odoo-sync-attachments.ts --dry-run

  # Sync only PO attachments
  DATABASE_URL='postgresql://...' npx ts-node scripts/odoo-sync-attachments.ts --model purchase.order

  # Check sync statistics
  DATABASE_URL='postgresql://...' npx ts-node scripts/odoo-sync-attachments.ts --stats

  # List orphaned documents
  DATABASE_URL='postgresql://...' npx ts-node scripts/odoo-sync-attachments.ts --orphans
  `);
}

// ============================================================================
// Display Functions
// ============================================================================

function formatSize(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = bytes;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }
  return `${size.toFixed(1)} ${units[unitIndex]}`;
}

async function showStats(): Promise<void> {
  if (!DATABASE_URL) {
    console.error('ERROR: DATABASE_URL environment variable is required');
    process.exit(1);
  }

  console.log('='.repeat(60));
  console.log('Odoo Attachment Sync Statistics');
  console.log('='.repeat(60));
  console.log('');

  const stats = await getAttachmentSyncStats(DATABASE_URL);

  console.log('Overview:');
  console.log(`  Total documents:  ${stats.total}`);
  console.log(`  Synced:          ${stats.synced}`);
  console.log(`  Orphaned:        ${stats.orphaned}`);
  console.log(`  Failed:          ${stats.failed}`);
  console.log('');

  if (stats.byModel.length > 0) {
    console.log('By Odoo Model:');
    for (const m of stats.byModel) {
      console.log(`  ${m.model}: ${m.count}`);
    }
    console.log('');
  }

  if (stats.byEntityType.length > 0) {
    console.log('By FF Entity Type:');
    for (const e of stats.byEntityType) {
      console.log(`  ${e.entityType}: ${e.count}`);
    }
    console.log('');
  }
}

async function showOrphans(): Promise<void> {
  if (!DATABASE_URL) {
    console.error('ERROR: DATABASE_URL environment variable is required');
    process.exit(1);
  }

  console.log('='.repeat(60));
  console.log('Orphaned Documents (Need Manual Linking)');
  console.log('='.repeat(60));
  console.log('');

  const orphans = await getOrphanedDocuments(DATABASE_URL, { limit: 50 });

  if (orphans.length === 0) {
    console.log('No orphaned documents found.');
    return;
  }

  console.log(`Found ${orphans.length} orphaned documents:\n`);

  // Group by model
  const byModel = new Map<string, typeof orphans>();
  for (const doc of orphans) {
    const list = byModel.get(doc.odooModel) || [];
    list.push(doc);
    byModel.set(doc.odooModel, list);
  }

  for (const [model, docs] of byModel) {
    console.log(`${model} (${docs.length}):`);
    for (const doc of docs.slice(0, 10)) {
      console.log(`  - ${doc.fileName}`);
      console.log(`    Odoo ID: ${doc.odooAttachmentId}, Record ID: ${doc.odooRecordId}`);
      console.log(`    Path: ${doc.filePath}`);
    }
    if (docs.length > 10) {
      console.log(`  ... and ${docs.length - 10} more`);
    }
    console.log('');
  }
}

// ============================================================================
// Main Sync Function
// ============================================================================

async function runSync(args: CLIArgs): Promise<void> {
  if (!DATABASE_URL) {
    console.error('ERROR: DATABASE_URL environment variable is required');
    process.exit(1);
  }

  console.log('='.repeat(60));
  console.log('Odoo Attachment Sync');
  console.log('='.repeat(60));
  console.log('');

  if (args.dryRun) {
    console.log('*** DRY RUN - No changes will be made ***');
    console.log('');
  }

  console.log('Configuration:');
  console.log(`  Odoo URL:      ${ODOO_URL}`);
  console.log(`  Odoo DB:       ${ODOO_DB}`);
  console.log(`  Model filter:  ${args.model || 'all'}`);
  console.log(`  Limit:         ${args.limit}`);
  console.log(`  Skip orphans:  ${args.skipOrphans}`);
  console.log('');

  // Initialize Odoo client
  console.log('Connecting to Odoo...');
  const client = new OdooClient({
    url: ODOO_URL,
    db: ODOO_DB,
    username: ODOO_USERNAME,
    password: ODOO_PASSWORD,
  });

  await client.authenticate();
  console.log('✓ Connected to Odoo');
  console.log('');

  // Count attachments
  const totalCount = await client.countAttachments(args.model);
  console.log(`Found ${totalCount} attachments in Odoo${args.model ? ` for ${args.model}` : ''}`);
  console.log('');

  // Run sync
  console.log('Starting sync...');
  console.log('');

  const result = await syncAttachments(client, DATABASE_URL, {
    dryRun: args.dryRun,
    models: args.model ? [args.model] : undefined,
    limit: args.limit,
    includeOrphans: !args.skipOrphans,
  });

  // Display results
  console.log('');
  console.log('='.repeat(60));
  console.log('Sync Results');
  console.log('='.repeat(60));
  console.log('');
  console.log(`  Synced:    ${result.synced}`);
  console.log(`  Orphaned:  ${result.orphaned}`);
  console.log(`  Skipped:   ${result.skipped}`);
  console.log(`  Errors:    ${result.errors.length}`);
  console.log('');

  if (result.errors.length > 0) {
    console.log('Errors:');
    for (const error of result.errors.slice(0, 10)) {
      console.log(`  - ${error}`);
    }
    if (result.errors.length > 10) {
      console.log(`  ... and ${result.errors.length - 10} more errors`);
    }
    console.log('');
  }

  // Show summary by action
  const synced = result.details.filter((d) => d.action === 'synced');
  const orphaned = result.details.filter((d) => d.action === 'orphaned');

  if (synced.length > 0) {
    console.log('Synced Attachments:');
    for (const d of synced.slice(0, 10)) {
      console.log(`  ✓ ${d.name}`);
      console.log(`    Model: ${d.model} → ${d.ffEntityType}:${d.ffEntityId}`);
    }
    if (synced.length > 10) {
      console.log(`  ... and ${synced.length - 10} more`);
    }
    console.log('');
  }

  if (orphaned.length > 0) {
    console.log('Orphaned Attachments:');
    for (const d of orphaned.slice(0, 10)) {
      console.log(`  ⚠ ${d.name}`);
      console.log(`    Model: ${d.model} (no FF mapping)`);
    }
    if (orphaned.length > 10) {
      console.log(`  ... and ${orphaned.length - 10} more`);
    }
    console.log('');
  }

  console.log('='.repeat(60));
  console.log(args.dryRun ? 'Dry run complete!' : 'Sync complete!');
  console.log('='.repeat(60));
}

// ============================================================================
// Entry Point
// ============================================================================

async function main(): Promise<void> {
  const args = parseArgs();

  if (args.help) {
    showHelp();
    return;
  }

  try {
    if (args.showStats) {
      await showStats();
    } else if (args.showOrphans) {
      await showOrphans();
    } else {
      await runSync(args);
    }
  } catch (error) {
    console.error('');
    console.error('ERROR:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

main();
