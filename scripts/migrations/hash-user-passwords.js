/**
 * Migration: Hash User Passwords
 *
 * This script converts existing plaintext/weak-hash passwords to bcrypt.
 * Run once to migrate existing users.
 *
 * Usage:
 *   DATABASE_URL='...' node scripts/migrations/hash-user-passwords.js
 *
 * Options:
 *   --dry-run    Show what would be changed without making changes
 *   --password   Set a default password for all users (for testing)
 */

const { neon } = require('@neondatabase/serverless');
const bcrypt = require('bcryptjs');

const SALT_ROUNDS = 12;
const DEFAULT_PASSWORD = 'FibreFlow2026!'; // Default for migration, users should change

async function main() {
  const isDryRun = process.argv.includes('--dry-run');
  const customPassword = process.argv.find(arg => arg.startsWith('--password='))?.split('=')[1];
  const passwordToSet = customPassword || DEFAULT_PASSWORD;

  if (!process.env.DATABASE_URL) {
    console.error('ERROR: DATABASE_URL environment variable is required');
    process.exit(1);
  }

  const sql = neon(process.env.DATABASE_URL);

  console.log('=== Password Migration Script ===');
  console.log(`Mode: ${isDryRun ? 'DRY RUN (no changes)' : 'LIVE'}`);
  console.log(`Default password: ${passwordToSet}`);
  console.log('');

  try {
    // Get all users
    const users = await sql`
      SELECT id, email, password
      FROM users
      ORDER BY email
    `;

    console.log(`Found ${users.length} users\n`);

    let updated = 0;
    let skipped = 0;

    for (const user of users) {
      // Check if password is already bcrypt hashed
      const isBcrypt = user.password && user.password.startsWith('$2');

      if (isBcrypt) {
        console.log(`SKIP: ${user.email} - already bcrypt hashed`);
        skipped++;
        continue;
      }

      // Hash the new password
      const hashedPassword = await bcrypt.hash(passwordToSet, SALT_ROUNDS);

      if (isDryRun) {
        console.log(`WOULD UPDATE: ${user.email}`);
        console.log(`  Old: ${user.password?.substring(0, 20)}...`);
        console.log(`  New: ${hashedPassword.substring(0, 20)}...`);
      } else {
        await sql`
          UPDATE users
          SET password = ${hashedPassword}, updated_at = NOW()
          WHERE id = ${user.id}
        `;
        console.log(`UPDATED: ${user.email}`);
      }

      updated++;
    }

    console.log('\n=== Summary ===');
    console.log(`Total users: ${users.length}`);
    console.log(`Updated: ${updated}`);
    console.log(`Skipped (already bcrypt): ${skipped}`);

    if (!isDryRun && updated > 0) {
      console.log(`\n⚠️  IMPORTANT: All updated users now have password: ${passwordToSet}`);
      console.log('   Users should change their password after first login.');
    }

    if (isDryRun) {
      console.log('\n📝 This was a dry run. Run without --dry-run to apply changes.');
    }

  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  }
}

main();
