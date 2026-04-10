/**
 * Ticket Migration Service
 *
 * Handles the migration of existing FF-format ticket UIDs to the new VF format.
 *
 * Features:
 * - Renumbers tickets by original creation date (chronological order)
 * - Creates audit trail in maintenance_ticket_uid_migrations table
 * - Preserves external_id (FT reference) unchanged
 * - Supports dry-run mode for previewing changes
 * - Batch processing for large datasets
 *
 * VF Format: VF-YYYYMMDD-NNN (e.g., VF-20260122-001)
 */

import { query, queryOne } from '../utils/db';
import { createLogger } from '@/lib/logger';

const logger = createLogger('maintenance:migration');

/**
 * Migration result for a single ticket
 */
export interface TicketMigrationMapping {
  ticket_id: string;
  old_uid: string;
  new_uid: string;
  created_at: string;
  external_id: string | null;
}

/**
 * Error during migration
 */
export interface MigrationError {
  ticket_id: string;
  old_uid: string;
  error: string;
}

/**
 * Migration result summary
 */
export interface MigrationResult {
  success: boolean;
  total: number;
  migrated: number;
  skipped: number;
  errors: MigrationError[];
  mappings: TicketMigrationMapping[];
  dry_run: boolean;
  started_at: string;
  completed_at: string;
}

/**
 * Migration options
 */
export interface MigrationOptions {
  dryRun?: boolean;
  batchSize?: number;
  userId?: string;
}

/**
 * Generate VF UID for a specific date using atomic sequence
 */
async function generateVfUidForDate(date: Date): Promise<string> {
  const dateStr = date.toISOString().split('T')[0]!;
  const formattedDate = dateStr.replace(/-/g, '');

  const result = await queryOne<{ last_sequence: number }>(
    `INSERT INTO maintenance_ticket_sequences (sequence_date, last_sequence)
     VALUES ($1::date, 1)
     ON CONFLICT (sequence_date)
     DO UPDATE SET
       last_sequence = maintenance_ticket_sequences.last_sequence + 1,
       updated_at = NOW()
     RETURNING last_sequence`,
    [dateStr]
  );

  if (!result) {
    throw new Error(`Failed to generate VF UID for date ${dateStr}`);
  }

  const seqNum = result.last_sequence;
  const paddedSeq = String(seqNum).padStart(3, '0');

  return `VF-${formattedDate}-${paddedSeq}`;
}

/**
 * Migrate all tickets from FF format to VF format
 *
 * @param options - Migration options (dryRun, batchSize, userId)
 * @returns MigrationResult with summary and mappings
 */
export async function migrateTicketsToVfFormat(
  options: MigrationOptions = {}
): Promise<MigrationResult> {
  const { dryRun = false, batchSize = 100, userId = null } = options;
  const startedAt = new Date().toISOString();

  logger.info('Starting ticket UID migration', { dryRun, batchSize });

  const result: MigrationResult = {
    success: true,
    total: 0,
    migrated: 0,
    skipped: 0,
    errors: [],
    mappings: [],
    dry_run: dryRun,
    started_at: startedAt,
    completed_at: '',
  };

  try {
    // Fetch all tickets ordered by creation date
    const tickets = await query<{
      id: string;
      ticket_uid: string;
      created_at: string;
      external_id: string | null;
    }>(
      `SELECT id, ticket_uid, created_at, external_id
       FROM maintenance_tickets
       ORDER BY created_at ASC`
    );

    result.total = tickets.length;
    logger.info(`Found ${tickets.length} tickets to process`);

    if (tickets.length === 0) {
      result.completed_at = new Date().toISOString();
      return result;
    }

    // Process tickets in batches
    for (let i = 0; i < tickets.length; i += batchSize) {
      const batch = tickets.slice(i, i + batchSize);

      for (const ticket of batch) {
        try {
          // Skip tickets already in VF format
          if (ticket.ticket_uid.startsWith('VF-')) {
            result.skipped++;
            logger.debug(`Skipping ${ticket.ticket_uid} - already VF format`);
            continue;
          }

          // Generate new VF UID based on creation date
          const createdDate = new Date(ticket.created_at);
          const newUid = await generateVfUidForDate(createdDate);

          const mapping: TicketMigrationMapping = {
            ticket_id: ticket.id,
            old_uid: ticket.ticket_uid,
            new_uid: newUid,
            created_at: ticket.created_at,
            external_id: ticket.external_id,
          };

          if (!dryRun) {
            // Update the ticket UID
            await queryOne(
              `UPDATE maintenance_tickets
               SET ticket_uid = $1, updated_at = NOW()
               WHERE id = $2
               RETURNING id`,
              [newUid, ticket.id]
            );

            // Record in audit table
            await queryOne(
              `INSERT INTO maintenance_ticket_uid_migrations
               (ticket_id, old_ticket_uid, new_ticket_uid, migrated_by)
               VALUES ($1, $2, $3, $4)
               RETURNING id`,
              [ticket.id, ticket.ticket_uid, newUid, userId]
            );
          }

          result.mappings.push(mapping);
          result.migrated++;

          logger.debug(`Migrated ${ticket.ticket_uid} -> ${newUid}`);
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error);
          result.errors.push({
            ticket_id: ticket.id,
            old_uid: ticket.ticket_uid,
            error: errorMsg,
          });
          logger.error(`Failed to migrate ticket ${ticket.ticket_uid}`, { error });
        }
      }

      logger.info(`Processed batch ${Math.floor(i / batchSize) + 1}, migrated: ${result.migrated}`);
    }

    result.success = result.errors.length === 0;
    result.completed_at = new Date().toISOString();

    logger.info('Migration completed', {
      total: result.total,
      migrated: result.migrated,
      skipped: result.skipped,
      errors: result.errors.length,
      dryRun,
    });

    return result;
  } catch (error) {
    logger.error('Migration failed', { error });
    result.success = false;
    result.completed_at = new Date().toISOString();
    throw error;
  }
}

/**
 * Get migration status and history
 */
export async function getMigrationStatus(): Promise<{
  total_tickets: number;
  ff_format: number;
  vf_format: number;
  migrated_count: number;
  last_migration: string | null;
}> {
  const stats = await queryOne<{
    total: string;
    ff_count: string;
    vf_count: string;
  }>(
    `SELECT
       COUNT(*) as total,
       COUNT(*) FILTER (WHERE ticket_uid LIKE 'FF%') as ff_count,
       COUNT(*) FILTER (WHERE ticket_uid LIKE 'VF-%') as vf_count
     FROM maintenance_tickets`
  );

  const lastMigration = await queryOne<{ migrated_at: string }>(
    `SELECT migrated_at FROM maintenance_ticket_uid_migrations
     ORDER BY migrated_at DESC LIMIT 1`
  );

  const migratedCount = await queryOne<{ count: string }>(
    `SELECT COUNT(*) as count FROM maintenance_ticket_uid_migrations`
  );

  return {
    total_tickets: parseInt(stats?.total || '0', 10),
    ff_format: parseInt(stats?.ff_count || '0', 10),
    vf_format: parseInt(stats?.vf_count || '0', 10),
    migrated_count: parseInt(migratedCount?.count || '0', 10),
    last_migration: lastMigration?.migrated_at || null,
  };
}

/**
 * Rollback migration (restore old UIDs)
 *
 * @param options - Rollback options
 */
export async function rollbackMigration(options: { dryRun?: boolean } = {}): Promise<{
  success: boolean;
  restored: number;
  errors: MigrationError[];
}> {
  const { dryRun = false } = options;

  logger.info('Starting migration rollback', { dryRun });

  const result = {
    success: true,
    restored: 0,
    errors: [] as MigrationError[],
  };

  try {
    // Get all migration records
    const migrations = await query<{
      id: string;
      ticket_id: string;
      old_ticket_uid: string;
      new_ticket_uid: string;
    }>(
      `SELECT id, ticket_id, old_ticket_uid, new_ticket_uid
       FROM maintenance_ticket_uid_migrations
       ORDER BY migrated_at DESC`
    );

    for (const migration of migrations) {
      try {
        if (!dryRun) {
          // Restore old UID
          await queryOne(
            `UPDATE maintenance_tickets
             SET ticket_uid = $1, updated_at = NOW()
             WHERE id = $2`,
            [migration.old_ticket_uid, migration.ticket_id]
          );

          // Remove migration record
          await queryOne(
            `DELETE FROM maintenance_ticket_uid_migrations WHERE id = $1`,
            [migration.id]
          );
        }

        result.restored++;
        logger.debug(`Rolled back ${migration.new_ticket_uid} -> ${migration.old_ticket_uid}`);
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        result.errors.push({
          ticket_id: migration.ticket_id,
          old_uid: migration.new_ticket_uid,
          error: errorMsg,
        });
      }
    }

    result.success = result.errors.length === 0;

    logger.info('Rollback completed', {
      restored: result.restored,
      errors: result.errors.length,
      dryRun,
    });

    return result;
  } catch (error) {
    logger.error('Rollback failed', { error });
    result.success = false;
    throw error;
  }
}
