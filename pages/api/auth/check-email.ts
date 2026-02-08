/**
 * Check Email API
 * POST /api/auth/check-email
 *
 * Checks if an email exists in the staff table and determines auth status:
 * - STAFF_NOT_FOUND: Email not in staff table (not authorized)
 * - FIRST_TIME_USER: Staff exists but no user account yet
 * - PASSWORD_REQUIRED: User exists with password set (normal login)
 * - PASSWORD_SETUP_REQUIRED: User exists but no password (first-time setup needed)
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import logger from '@/lib/logger';
import { log } from '@/lib/logger';

const sql = neon(process.env.DATABASE_URL!);

// In-memory rate limiter for check-email attempts (per IP)
const checkEmailAttempts = new Map<string, { count: number; resetAt: number }>();
const MAX_CHECK_ATTEMPTS = 10;
const CHECK_WINDOW_MS = 15 * 60 * 1000; // 15 minutes

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = checkEmailAttempts.get(ip);
  if (!entry || now > entry.resetAt) {
    checkEmailAttempts.set(ip, { count: 1, resetAt: now + CHECK_WINDOW_MS });
    return false;
  }
  entry.count++;
  return entry.count > MAX_CHECK_ATTEMPTS;
}

// Clean up stale entries every 30 minutes
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of checkEmailAttempts) {
    if (now > entry.resetAt) checkEmailAttempts.delete(ip);
  }
}, 30 * 60 * 1000).unref();

interface CheckEmailRequest {
  email: string;
}

type EmailStatus =
  | 'STAFF_NOT_FOUND'
  | 'FIRST_TIME_USER'
  | 'PASSWORD_REQUIRED'
  | 'PASSWORD_SETUP_REQUIRED'
  | 'USER_DISABLED';

interface StaffInfo {
  id: string;
  firstName: string;
  lastName: string;
  position?: string;
  department?: string;
}

interface CheckEmailResponse {
  success: boolean;
  data?: {
    status: EmailStatus;
    staff?: StaffInfo;
    message: string;
  };
  error?: {
    code: string;
    message: string;
  };
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<CheckEmailResponse>
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
    log.warn('check-email', { ip: clientIp, message: 'Rate limited' });
    return res.status(429).json({
      success: false,
      error: { code: 'RATE_LIMITED', message: 'Too many email check attempts. Please try again later.' },
    });
  }

  try {
    const { email } = req.body as CheckEmailRequest;

    // Validate input
    if (!email || typeof email !== 'string') {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_INPUT', message: 'Email is required' },
      });
    }

    const normalizedEmail = email.toLowerCase().trim();

    // Step 1: Check if email exists in staff table
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
      logger.info('check-email: Email not found in staff table', { email: normalizedEmail });
      return res.status(200).json({
        success: true,
        data: {
          status: 'STAFF_NOT_FOUND',
          message: 'Email not found. Please contact your administrator.',
        },
      });
    }

    const staffMember = staffResult[0]!;
    const staffInfo: StaffInfo = {
      id: String(staffMember.id),
      firstName: String(staffMember.first_name || ''),
      lastName: String(staffMember.last_name || ''),
      position: staffMember.position ? String(staffMember.position) : undefined,
      department: staffMember.department ? String(staffMember.department) : undefined,
    };

    // Step 2: Check if user account exists (via user_id or direct email lookup)
    let userResult;

    if (staffMember.user_id) {
      // Staff already linked to a user
      userResult = await sql`
        SELECT id, email, password, is_active
        FROM users
        WHERE id = ${staffMember.user_id}
      `;
    } else {
      // Check if user exists by email (not yet linked)
      userResult = await sql`
        SELECT id, email, password, is_active
        FROM users
        WHERE email = ${normalizedEmail}
      `;
    }

    // Step 3: Determine status based on user existence and password
    if (userResult.length === 0) {
      // No user account exists - first time user
      logger.info('check-email: First time user detected', { email: normalizedEmail, staffId: staffMember.id });
      return res.status(200).json({
        success: true,
        data: {
          status: 'FIRST_TIME_USER',
          staff: staffInfo,
          message: `Welcome ${staffInfo.firstName}! Please set up your password to get started.`,
        },
      });
    }

    const user = userResult[0]!;

    // Check if user is active
    if (!user.is_active) {
      return res.status(200).json({
        success: true,
        data: {
          status: 'USER_DISABLED',
          message: 'Your account has been disabled. Please contact your administrator.',
        },
      });
    }

    // Check if password is set
    if (!user.password) {
      logger.info('check-email: User exists but no password', { email: normalizedEmail });
      return res.status(200).json({
        success: true,
        data: {
          status: 'PASSWORD_SETUP_REQUIRED',
          staff: staffInfo,
          message: `Welcome back ${staffInfo.firstName}! Please set up your password.`,
        },
      });
    }

    // User exists with password - normal login flow
    return res.status(200).json({
      success: true,
      data: {
        status: 'PASSWORD_REQUIRED',
        staff: staffInfo,
        message: `Welcome back ${staffInfo.firstName}!`,
      },
    });

  } catch (error) {
    logger.error('check-email: Error checking email', { error });
    return res.status(500).json({
      success: false,
      error: { code: 'CHECK_EMAIL_ERROR', message: 'An error occurred. Please try again.' },
    });
  }
}
