/**
 * Forgot Password API
 * POST /api/auth/forgot-password
 *
 * Initiates password reset flow by generating a token and sending email.
 * Always returns success to prevent email enumeration attacks.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { generateResetToken } from '@/lib/auth';
import logger from '@/lib/logger';
import { log } from '@/lib/logger';

const sql = neon(process.env.DATABASE_URL!);

// In-memory rate limiter for forgot password attempts (per IP)
const forgotPasswordAttempts = new Map<string, { count: number; resetAt: number }>();
const MAX_FORGOT_ATTEMPTS = 3;
const FORGOT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = forgotPasswordAttempts.get(ip);
  if (!entry || now > entry.resetAt) {
    forgotPasswordAttempts.set(ip, { count: 1, resetAt: now + FORGOT_WINDOW_MS });
    return false;
  }
  entry.count++;
  return entry.count > MAX_FORGOT_ATTEMPTS;
}

// Clean up stale entries every 30 minutes
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of forgotPasswordAttempts) {
    if (now > entry.resetAt) forgotPasswordAttempts.delete(ip);
  }
}, 30 * 60 * 1000).unref();

// Email sending configuration
const SMTP_ENABLED = process.env.SMTP_HOST && process.env.SMTP_USER;
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://app.fibreflow.app';

interface ForgotPasswordRequest {
  email: string;
}

/**
 * Send password reset email
 * Uses nodemailer if configured, otherwise logs the link
 */
async function sendResetEmail(
  email: string,
  resetLink: string,
  firstName: string
): Promise<boolean> {
  // For now, log the reset link (in production, send via email)
  logger.info(
    { email, resetLink: resetLink.substring(0, 50) + '...' },
    'Password reset requested'
  );

  if (!SMTP_ENABLED) {
    // In development, log the full link
    log.debug('forgot-password', {
      action: 'devModeResetLink',
      email,
      resetLink,
      message: 'Password reset link generated in dev mode'
    });
    return true;
  }

  try {
    // Dynamic import - nodemailer is only needed when SMTP is configured
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const nodemailer = require(/* webpackIgnore: true */ 'nodemailer');

    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT || '587'),
      secure: process.env.SMTP_SECURE === 'true',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
      tls: {
        // Only disable cert validation when explicitly opted in (e.g., ISP with expired cert)
        rejectUnauthorized: process.env.SMTP_REJECT_UNAUTHORIZED !== 'false',
      },
    });

    await transporter.sendMail({
      from: process.env.SMTP_FROM || 'noreply@fibreflow.app',
      to: email,
      subject: 'Reset Your FibreFlow Password',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #1a1a2e;">Reset Your Password</h2>
          <p>Hi ${firstName || 'there'},</p>
          <p>We received a request to reset your FibreFlow password. Click the button below to create a new password:</p>
          <p style="margin: 30px 0;">
            <a href="${resetLink}"
               style="background-color: #3b82f6; color: white; padding: 12px 24px;
                      text-decoration: none; border-radius: 6px; display: inline-block;">
              Reset Password
            </a>
          </p>
          <p style="color: #666; font-size: 14px;">
            This link will expire in 1 hour. If you didn't request this, you can safely ignore this email.
          </p>
          <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">
          <p style="color: #999; font-size: 12px;">
            FibreFlow - Fiber Network Management
          </p>
        </div>
      `,
      text: `
        Reset Your Password

        Hi ${firstName || 'there'},

        We received a request to reset your FibreFlow password.

        Click here to reset: ${resetLink}

        This link will expire in 1 hour.

        If you didn't request this, you can safely ignore this email.
      `,
    });

    logger.info({ email }, 'Password reset email sent');
    return true;
  } catch (error) {
    logger.error({ error, email }, 'Failed to send password reset email');
    return false;
  }
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
    log.warn('forgot-password', { ip: clientIp, message: 'Rate limited' });
    return res.status(429).json({
      success: false,
      error: { code: 'RATE_LIMITED', message: 'Too many password reset attempts. Please try again later.' },
    });
  }

  try {
    const { email } = req.body as ForgotPasswordRequest;

    if (!email) {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_INPUT', message: 'Email is required' },
      });
    }

    const normalizedEmail = email.toLowerCase().trim();

    // Always return success to prevent email enumeration
    // But only actually send email if user exists
    const successResponse = {
      success: true,
      message: 'If an account exists with this email, you will receive a password reset link.',
    };

    // Find user by email
    const users = await sql`
      SELECT id, first_name, email
      FROM users
      WHERE email = ${normalizedEmail}
      AND is_active = true
    `;

    if (users.length === 0) {
      // User doesn't exist, but don't reveal this
      logger.info({ email: normalizedEmail }, 'Password reset requested for non-existent email');
      return res.status(200).json(successResponse);
    }

    const user = users[0] as { id: string; first_name: string; email: string };

    // Generate reset token
    const { token, hashedToken, expiresAt } = generateResetToken();

    // Store hashed token in database
    await sql`
      UPDATE users
      SET
        reset_token = ${hashedToken},
        reset_token_expires = ${expiresAt.toISOString()}
      WHERE id = ${user.id}
    `;

    // Build reset link
    const resetLink = `${APP_URL}/auth/reset-password?token=${token}&email=${encodeURIComponent(normalizedEmail)}`;

    // Send email
    await sendResetEmail(normalizedEmail, resetLink, user.first_name || '');

    return res.status(200).json(successResponse);
  } catch (error) {
    logger.error({ error }, 'Forgot password error');
    return res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: 'An error occurred' },
    });
  }
}
