/**
 * Login API
 * POST /api/auth/login
 * Authenticates user and returns JWT in httpOnly cookie
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { serialize } from 'cookie';
import {
  verifyPassword,
  signToken,
  createSession,
  AUTH_COOKIE_NAME,
  type AuthUser,
  type AuthRole,
} from '@/lib/auth';
import { createLogger } from '@/lib/logger';

const sql = neon(process.env.DATABASE_URL!);
const log = createLogger('auth:login');

// In-memory rate limiter for login attempts (per IP)
const loginAttempts = new Map<string, { count: number; resetAt: number }>();
const MAX_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60 * 1000; // 15 minutes

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = loginAttempts.get(ip);
  if (!entry || now > entry.resetAt) {
    loginAttempts.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return false;
  }
  entry.count++;
  return entry.count > MAX_ATTEMPTS;
}

// Clean up stale entries every 30 minutes
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of loginAttempts) {
    if (now > entry.resetAt) loginAttempts.delete(ip);
  }
}, 30 * 60 * 1000).unref();

interface LoginRequestBody {
  email: string;
  password: string;
  rememberMe?: boolean;
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
    log.warn({ ip: clientIp }, 'Login rate limited');
    return res.status(429).json({
      success: false,
      error: { code: 'RATE_LIMITED', message: 'Too many login attempts. Please try again later.' },
    });
  }

  try {
    const { email, password, rememberMe = false } = req.body as LoginRequestBody;

    // Validate input
    if (!email || !password) {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_INPUT', message: 'Email and password are required' },
      });
    }

    // Find user by email
    const users = await sql`
      SELECT
        id, email, password, first_name, last_name, role, permissions,
        is_active, profile_picture, department
      FROM users
      WHERE email = ${email.toLowerCase().trim()}
    `;

    if (users.length === 0) {
      // Don't reveal if user exists
      return res.status(401).json({
        success: false,
        error: { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password' },
      });
    }

    const dbUser = users[0]!; // Guaranteed by length check above

    // Check if user is active — return same error as invalid credentials to prevent enumeration
    if (!dbUser.is_active) {
      return res.status(401).json({
        success: false,
        error: { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password' },
      });
    }

    // Verify password
    const passwordValid = await verifyPassword(password, dbUser.password);
    if (!passwordValid) {
      return res.status(401).json({
        success: false,
        error: { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password' },
      });
    }

    // Build user object
    const user: AuthUser = {
      id: dbUser.id,
      email: dbUser.email,
      firstName: dbUser.first_name || '',
      lastName: dbUser.last_name || '',
      role: dbUser.role as AuthRole,
      permissions: dbUser.permissions || [],
      isActive: dbUser.is_active,
      profilePicture: dbUser.profile_picture,
      department: dbUser.department,
    };

    // Create session and sign JWT with session ID
    const expiresIn = rememberMe ? '30d' : '24h';
    const ipAddress = (req.headers['x-forwarded-for'] as string)?.split(',')[0] || req.socket.remoteAddress;
    const userAgent = req.headers['user-agent'];

    // Create session first to get session ID
    const session = await createSession(user.id, '', ipAddress, userAgent);

    // Sign final token with session ID
    const finalToken = await signToken(user, session.id, expiresIn);

    // Update session with token hash
    await sql`
      UPDATE user_sessions
      SET token_hash = encode(sha256(${finalToken}::bytea), 'hex')
      WHERE id = ${session.id}
    `;

    // Update last login
    await sql`
      UPDATE users SET last_login = NOW() WHERE id = ${user.id}
    `;

    // Set httpOnly cookie
    const maxAge = rememberMe ? 30 * 24 * 60 * 60 : 24 * 60 * 60; // 30 days or 24 hours
    const cookie = serialize(AUTH_COOKIE_NAME, finalToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge,
      path: '/',
    });

    res.setHeader('Set-Cookie', cookie);

    return res.status(200).json({
      success: true,
      data: {
        user: {
          id: user.id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          role: user.role,
          permissions: user.permissions,
          profilePicture: user.profilePicture,
          department: user.department,
        },
      },
    });
  } catch (error) {
    log.error({ error }, 'Login error');
    return res.status(500).json({
      success: false,
      error: { code: 'LOGIN_ERROR', message: 'An error occurred during login' },
    });
  }
}
