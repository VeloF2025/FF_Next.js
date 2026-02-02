#!/usr/bin/env node
/**
 * Access Control CLI
 * Manage user permissions from command line
 *
 * Usage:
 *   node scripts/access-control.mjs check <email>
 *   node scripts/access-control.mjs grant <email> <permission>
 *   node scripts/access-control.mjs deny <email> <permission>
 *   node scripts/access-control.mjs list [module]
 *   node scripts/access-control.mjs debug <email> <permission>
 */

import { neon } from '@neondatabase/serverless';
import { config } from 'dotenv';

config({ path: '.env.local' });

const sql = neon(process.env.DATABASE_URL);

const [,, command, ...args] = process.argv;

async function checkUser(email) {
  const result = await sql`
    WITH user_perms AS (
      SELECT
        u.id as user_id,
        u.email,
        u.role,
        rp.permission_key,
        (rp.actions->>'view')::boolean as has_role_perm
      FROM users u
      JOIN role_permissions rp ON rp.role = u.role
      WHERE u.email = ${email}
    ),
    user_overrides AS (
      SELECT
        upo.permission_key,
        upo.override_type,
        (upo.actions->>'view')::boolean as can_view
      FROM user_permission_overrides upo
      JOIN users u ON u.id = upo.user_id
      WHERE u.email = ${email}
    )
    SELECT
      COALESCE(up.permission_key, uo.permission_key) as permission_key,
      CASE
        WHEN uo.permission_key IS NOT NULL THEN
          CASE WHEN uo.can_view = false THEN false ELSE true END
        WHEN up.has_role_perm THEN true
        ELSE false
      END as can_access,
      CASE
        WHEN uo.permission_key IS NOT NULL THEN 'override'
        ELSE 'role'
      END as source
    FROM user_perms up
    FULL OUTER JOIN user_overrides uo ON up.permission_key = uo.permission_key
    ORDER BY COALESCE(up.permission_key, uo.permission_key)
  `;

  const user = await sql`SELECT email, role FROM users WHERE email = ${email}`;

  if (!user[0]) {
    console.log(`User not found: ${email}`);
    return;
  }

  console.log(`\nUser: ${user[0].email}`);
  console.log(`Role: ${user[0].role}`);
  console.log(`\n${'Permission'.padEnd(45)} | Access | Source`);
  console.log(`${'-'.repeat(45)}-|--------|--------`);

  result.forEach(r => {
    const access = r.can_access ? '✓' : '✗';
    console.log(`${r.permission_key.padEnd(45)} | ${access.padEnd(6)} | ${r.source}`);
  });
  console.log('');
}

async function grantPermission(email, permissionKey) {
  const user = await sql`SELECT id FROM users WHERE email = ${email}`;
  if (!user[0]) {
    console.log(`User not found: ${email}`);
    return;
  }

  await sql`
    INSERT INTO user_permission_overrides (id, user_id, permission_key, override_type, actions, granted_at)
    VALUES (gen_random_uuid(), ${user[0].id}, ${permissionKey}, 'grant', '{"view": true}'::jsonb, NOW())
    ON CONFLICT (user_id, permission_key)
    DO UPDATE SET actions = '{"view": true}'::jsonb, override_type = 'grant', granted_at = NOW()
  `;

  console.log(`✓ Granted ${permissionKey} to ${email}`);
}

async function denyPermission(email, permissionKey) {
  const user = await sql`SELECT id FROM users WHERE email = ${email}`;
  if (!user[0]) {
    console.log(`User not found: ${email}`);
    return;
  }

  await sql`
    INSERT INTO user_permission_overrides (id, user_id, permission_key, override_type, actions, granted_at)
    VALUES (gen_random_uuid(), ${user[0].id}, ${permissionKey}, 'grant', '{"view": false}'::jsonb, NOW())
    ON CONFLICT (user_id, permission_key)
    DO UPDATE SET actions = '{"view": false}'::jsonb, override_type = 'grant', granted_at = NOW()
  `;

  console.log(`✗ Denied ${permissionKey} to ${email}`);
}

async function listPermissions(module) {
  const pattern = module ? `${module}%` : '%';
  const result = await sql`
    SELECT key, label, type, parent_key
    FROM access_permissions
    WHERE key LIKE ${pattern}
    ORDER BY key
  `;

  console.log(`\nAvailable Permissions${module ? ` (${module})` : ''}:`);
  console.log(`${'Key'.padEnd(50)} | Type`);
  console.log(`${'-'.repeat(50)}-|------`);

  result.forEach(r => {
    console.log(`${r.key.padEnd(50)} | ${r.type || 'page'}`);
  });
  console.log(`\nTotal: ${result.length} permissions\n`);
}

async function debugPermission(email, permissionKey) {
  const user = await sql`SELECT id, email, role FROM users WHERE email = ${email}`;
  if (!user[0]) {
    console.log(`User not found: ${email}`);
    return;
  }

  const rolePerms = await sql`
    SELECT permission_key, (actions->>'view')::boolean as can_view
    FROM role_permissions
    WHERE role = ${user[0].role} AND permission_key = ${permissionKey}
  `;

  const override = await sql`
    SELECT override_type, actions, (actions->>'view')::boolean as can_view
    FROM user_permission_overrides
    WHERE user_id = ${user[0].id} AND permission_key = ${permissionKey}
  `;

  console.log(`\nDebug: ${email} -> ${permissionKey}`);
  console.log(`${'='.repeat(60)}`);
  console.log(`User Role: ${user[0].role}`);
  const roleHasPerm = rolePerms.length > 0 && rolePerms[0].can_view === true;
  console.log(`Role has permission: ${roleHasPerm ? 'YES' : 'NO'}`);

  if (override[0]) {
    console.log(`Override exists: YES`);
    console.log(`  Type: ${override[0].override_type}`);
    console.log(`  Actions: ${JSON.stringify(override[0].actions)}`);
    console.log(`  Can View: ${override[0].can_view}`);
  } else {
    console.log(`Override exists: NO`);
  }

  const finalAccess = override[0]
    ? override[0].can_view !== false
    : roleHasPerm;

  console.log(`\nFINAL ACCESS: ${finalAccess ? '✓ GRANTED' : '✗ DENIED'}`);

  if (!finalAccess) {
    console.log(`\nReason: ${override[0] && override[0].can_view === false
      ? 'Override denies access (view: false)'
      : 'Permission not granted to role and no override exists'}`);
  }
  console.log('');
}

async function showHelp() {
  console.log(`
Access Control CLI

Usage:
  node scripts/access-control.mjs <command> [args]

Commands:
  check <email>                    Check user's permissions
  grant <email> <permission>       Grant permission to user
  deny <email> <permission>        Deny permission to user
  list [module]                    List available permissions
  debug <email> <permission>       Debug permission access

Examples:
  node scripts/access-control.mjs check janice@velocityfibre.co.za
  node scripts/access-control.mjs grant janice@velocityfibre.co.za system.data-sync.olt.pending
  node scripts/access-control.mjs deny janice@velocityfibre.co.za system.data-sync.olt.import
  node scripts/access-control.mjs list system
  node scripts/access-control.mjs debug janice@velocityfibre.co.za system.data-sync
`);
}

async function main() {
  try {
    switch (command) {
      case 'check':
        if (!args[0]) {
          console.log('Usage: check <email>');
          return;
        }
        await checkUser(args[0]);
        break;

      case 'grant':
        if (!args[0] || !args[1]) {
          console.log('Usage: grant <email> <permission>');
          return;
        }
        await grantPermission(args[0], args[1]);
        break;

      case 'deny':
        if (!args[0] || !args[1]) {
          console.log('Usage: deny <email> <permission>');
          return;
        }
        await denyPermission(args[0], args[1]);
        break;

      case 'list':
        await listPermissions(args[0]);
        break;

      case 'debug':
        if (!args[0] || !args[1]) {
          console.log('Usage: debug <email> <permission>');
          return;
        }
        await debugPermission(args[0], args[1]);
        break;

      default:
        await showHelp();
    }
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

main();
