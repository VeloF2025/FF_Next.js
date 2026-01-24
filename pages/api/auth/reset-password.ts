/**
 * Reset Password API
 * POST /api/auth/reset-password
 *
 * Validates reset token and updates user password.
 * Invalidates all existing sessions for security.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import {
  hashPassword,
  checkPasswordStrength,
  hashResetToken,
  isResetTokenExpired,
  deleteAllUserSessions,
} from '@/lib/auth';
import logger from '@/lib/logger';

const sql = neon(process.env.DATABASE_URL!);

interface ResetPasswordRequest {
  token: string;
  email: string;
  password: string;
  confirmPassword: string;
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

  try {
    const { token, email, password, confirmPassword } = req.body as ResetPasswordRequest;

    // Validate input
    if (!token || !email || !password || !confirmPassword) {
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
    const hashedToken = hashResetToken(token);

    // Find user with matching token
    const users = await sql`
      SELECT id, reset_token, reset_token_expires
      FROM users
      WHERE email = ${normalizedEmail}
      AND is_active = true
    `;

    if (users.length === 0) {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_TOKEN', message: 'Invalid or expired reset link' },
      });
    }

    const user = users[0] as { id: string; reset_token: string | null; reset_token_expires: string | null };

    // Verify token matches
    if (user.reset_token !== hashedToken) {
      logger.warn({ email: normalizedEmail }, 'Invalid reset token attempted');
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_TOKEN', message: 'Invalid or expired reset link' },
      });
    }

    // Check if token expired
    if (!user.reset_token_expires || isResetTokenExpired(user.reset_token_expires)) {
      logger.warn({ email: normalizedEmail }, 'Expired reset token attempted');
      return res.status(400).json({
        success: false,
        error: { code: 'TOKEN_EXPIRED', message: 'Reset link has expired. Please request a new one.' },
      });
    }

    // Hash new password
    const passwordHash = await hashPassword(password);

    // Update password and clear reset token
    await sql`
      UPDATE users
      SET
        password_hash = ${passwordHash},
        reset_token = NULL,
        reset_token_expires = NULL,
        password_changed_at = NOW(),
        updated_at = NOW()
      WHERE id = ${user.id}
    `;

    // Invalidate all existing sessions for security
    try {
      await deleteAllUserSessions(user.id);
      logger.info({ userId: user.id }, 'All sessions invalidated after password reset');
    } catch (sessionError) {
      // Don't fail the password reset if session cleanup fails
      logger.warn({ userId: user.id, error: sessionError }, 'Failed to clear sessions after password reset');
    }

    logger.info({ userId: user.id, email: normalizedEmail }, 'Password reset successful');

    return res.status(200).json({
      success: true,
      message: 'Password has been reset successfully. Please log in with your new password.',
    });
  } catch (error) {
    logger.error({ error }, 'Reset password error');
    return res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: 'An error occurred' },
    });
  }
}
