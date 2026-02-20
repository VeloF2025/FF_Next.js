/**
 * Setup Password API
 * POST /api/auth/setup-password
 *
 * Creates a new user account linked to staff or updates existing user with password.
 * Auto-logs in the user after successful setup.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { serialize } from 'cookie';
import { v4 as uuidv4 } from 'uuid';
import {
  hashPassword,
  checkPasswordStrength,
  signToken,
  createSession,
  AUTH_COOKIE_NAME,
  type AuthUser,
  type AuthRole,
} from '@/lib/auth';
import logger from '@/lib/logger';
import { log } from '@/lib/logger';

const sql = neon(process.env.DATABASE_URL!);

// In-memory rate limiter for setup password attempts (per IP)
const setupPasswordAttempts = new Map<string, { count: number; resetAt: number }>();
const MAX_SETUP_ATTEMPTS = 5;
const SETUP_WINDOW_MS = 15 * 60 * 1000; // 15 minutes

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = setupPasswordAttempts.get(ip);
  if (!entry || now > entry.resetAt) {
    setupPasswordAttempts.set(ip, { count: 1, resetAt: now + SETUP_WINDOW_MS });
    return false;
  }
  entry.count++;
  return entry.count > MAX_SETUP_ATTEMPTS;
}

// Clean up stale entries every 30 minutes
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of setupPasswordAttempts) {
    if (now > entry.resetAt) setupPasswordAttempts.delete(ip);
  }
}, 30 * 60 * 1000).unref();

interface SetupPasswordRequest {
  email: string;
  password: string;
  confirmPassword: string;
}

/**
 * Suggest a role based on position title (for admin reference only — not auto-assigned)
 */
function getSuggestedRole(position: string | null): AuthRole {
  if (!position) return 'viewer';
  const p = position.toLowerCase();
  if (p.includes('admin') || p.includes('director') || p.includes('ceo') || p.includes('cso')) return 'admin';
  if (p.includes('manager') || p.includes('supervisor') || p.includes('head') || p.includes('lead')) return 'manager';
  if (p.includes('technician') || p.includes('installer') || p.includes('engineer')) return 'technician';
  return 'viewer';
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    return res.status(405).json({
      success: false,
      error: { code: 'METHOD_NOT_ALLOWED', message: 'Only POST allowed' },
    });
  }

  // Rate limit by IP
  const clientIp = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.socket.remoteAddress || 'unknown';
  if (isRateLimited(clientIp)) {
    log.warn('setup-password', { ip: clientIp, message: 'Rate limited' });
    return res.status(429).json({
      success: false,
      error: { code: 'RATE_LIMITED', message: 'Too many password setup attempts. Please try again later.' },
    });
  }

  try {
    const { email, password, confirmPassword } = req.body as SetupPasswordRequest;

    // Validate input
    if (!email || !password || !confirmPassword) {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_INPUT', message: 'All fields are required' },
      });
    }

    if (password !== confirmPassword) {
      return res.status(400).json({
        success: false,
        error: { code: 'PASSWORD_MISMATCH', message: 'Passwords do not match' },
      });
    }

    // Validate password strength
    const strengthResult = checkPasswordStrength(password);
    if (!strengthResult.isValid) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'WEAK_PASSWORD',
          message: strengthResult.issues.join('. '),
        },
      });
    }

    const normalizedEmail = email.toLowerCase().trim();

    // Step 1: Verify staff record exists
    const staffResult = await sql`
      SELECT
        id,
        first_name,
        last_name,
        email,
        position,
        department,
        user_id,
        is_active
      FROM staff
      WHERE email = ${normalizedEmail}
      AND is_active = true
    `;

    if (staffResult.length === 0) {
      return res.status(404).json({
        success: false,
        error: { code: 'STAFF_NOT_FOUND', message: 'Email not found in staff records' },
      });
    }

    const staffMember = staffResult[0]!;

    // Step 2: Check for existing user
    let userId: string;
    let isNewUser = false;

    if (staffMember.user_id) {
      // User already exists via staff link
      const existingUser = await sql`
        SELECT id, password FROM users WHERE id = ${staffMember.user_id}
      `;

      if (existingUser.length > 0 && existingUser[0]!.password) {
        return res.status(400).json({
          success: false,
          error: { code: 'PASSWORD_ALREADY_SET', message: 'Password is already set. Please use login.' },
        });
      }

      userId = String(staffMember.user_id);
    } else {
      // Check if user exists by email (not linked to staff yet)
      const existingUser = await sql`
        SELECT id, password FROM users WHERE email = ${normalizedEmail}
      `;

      if (existingUser.length > 0) {
        const existing = existingUser[0]!;
        if (existing.password) {
          return res.status(400).json({
            success: false,
            error: { code: 'PASSWORD_ALREADY_SET', message: 'Password is already set. Please use login.' },
          });
        }
        userId = String(existing.id);
      } else {
        // Create new user
        userId = uuidv4();
        isNewUser = true;
      }
    }

    // Step 3: Hash password
    const hashedPassword = await hashPassword(password);

    // Step 4: Determine auth role using database-driven RBAC
    // Super admin emails can be configured via environment variable
    // Format: comma-separated list e.g. "admin@example.com,ceo@example.com"
    const BOOTSTRAP_SUPER_ADMIN_EMAILS = process.env.SUPER_ADMIN_EMAILS
      ? process.env.SUPER_ADMIN_EMAILS.split(',').map(e => e.trim().toLowerCase())
      : [];

    // Check if this is the first user (bootstrap super admin)
    const userCountResult = await sql`SELECT COUNT(*) as count FROM users`;
    const isFirstUser = parseInt(String(userCountResult[0]?.count || '0')) === 0;

    // Determine if this user should be super_admin:
    // 1. First user ONLY if BOOTSTRAP_SUPER_ADMIN=true is set (prevents attacker registration on wiped DB)
    // 2. Email is in the SUPER_ADMIN_EMAILS env variable
    // 3. Otherwise, all new users default to 'viewer' (admin can promote later)
    const bootstrapEnabled = process.env.BOOTSTRAP_SUPER_ADMIN === 'true';
    const isSuperAdmin = (isFirstUser && bootstrapEnabled) || BOOTSTRAP_SUPER_ADMIN_EMAILS.includes(normalizedEmail);

    // Default all users to 'viewer' — admins promote manually
    // Log suggested role based on position for admin reference
    const suggestedRole = getSuggestedRole(staffMember.position as string | null);
    if (suggestedRole !== 'viewer') {
      log.info('setup-password', {
        action: 'suggestedRole',
        email: normalizedEmail,
        position: staffMember.position,
        suggestedRole,
        message: 'New user defaulted to viewer. Admin can promote to suggested role.',
      });
    }

    const authRole = isSuperAdmin
      ? 'super_admin' as AuthRole
      : 'viewer' as AuthRole;

    // Super admins get the 'all' permission for full system access
    const userPermissions = isSuperAdmin ? ['all'] : [];

    // Step 5: Create or update user
    if (isNewUser) {
      await sql`
        INSERT INTO users (
          id,
          email,
          password,
          first_name,
          last_name,
          role,
          permissions,
          department,
          is_active,
          created_at,
          updated_at
        ) VALUES (
          ${userId},
          ${normalizedEmail},
          ${hashedPassword},
          ${staffMember.first_name},
          ${staffMember.last_name},
          ${authRole},
          ${JSON.stringify(userPermissions)}::jsonb,
          ${staffMember.department},
          true,
          NOW(),
          NOW()
        )
      `;

      logger.info('setup-password: Created new user account', {
        userId,
        email: normalizedEmail,
        staffId: staffMember.id,
        role: authRole,
        isSuperAdmin,
      });
    } else {
      await sql`
        UPDATE users
        SET
          password = ${hashedPassword},
          first_name = ${staffMember.first_name},
          last_name = ${staffMember.last_name},
          role = ${authRole},
          permissions = ${JSON.stringify(userPermissions)}::jsonb,
          department = ${staffMember.department},
          updated_at = NOW()
        WHERE id = ${userId}
      `;

      logger.info('setup-password: Updated existing user with password', {
        userId,
        email: normalizedEmail,
        role: authRole,
        isSuperAdmin,
      });
    }

    // Step 6: Link staff to user
    await sql`
      UPDATE staff
      SET user_id = ${userId}, updated_at = NOW()
      WHERE id = ${staffMember.id}
    `;

    // Step 7: Auto-login - Create session and JWT
    const user: AuthUser = {
      id: userId,
      email: normalizedEmail,
      firstName: (staffMember.first_name as string) || '',
      lastName: (staffMember.last_name as string) || '',
      role: authRole,
      permissions: userPermissions,
      isActive: true,
      department: staffMember.department as string | undefined,
    };

    const ipAddress = (req.headers['x-forwarded-for'] as string)?.split(',')[0] || req.socket.remoteAddress;
    const userAgent = req.headers['user-agent'];

    const session = await createSession(user.id, '', ipAddress, userAgent);
    const token = await signToken(user, session.id, '24h');

    // Update session with token hash
    await sql`
      UPDATE user_sessions
      SET token_hash = encode(sha256(${token}::bytea), 'hex')
      WHERE id = ${session.id}
    `;

    // Set httpOnly cookie
    const cookie = serialize(AUTH_COOKIE_NAME, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 24 * 60 * 60, // 24 hours
      path: '/',
    });

    res.setHeader('Set-Cookie', cookie);

    logger.info('setup-password: Password setup complete, user logged in', {
      userId,
      email: normalizedEmail,
      isNewUser,
    });

    return res.status(200).json({
      success: true,
      data: {
        message: 'Password set successfully! You are now logged in.',
        user: {
          id: user.id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          role: user.role,
          department: user.department,
        },
        isNewUser,
      },
    });

  } catch (error) {
    logger.error('setup-password: Error setting up password', { error });
    return res.status(500).json({
      success: false,
      error: { code: 'SETUP_ERROR', message: 'An error occurred. Please try again.' },
    });
  }
}
