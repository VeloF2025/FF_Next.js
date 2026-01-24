/**
 * Password Utilities
 * Secure password hashing and verification using bcryptjs
 */

import * as bcrypt from 'bcryptjs';
import { randomBytes, createHash } from 'crypto';

// Cost factor for bcrypt (10-12 is recommended for production)
const SALT_ROUNDS = 12;

/**
 * Hash a password
 */
export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS);
}

/**
 * Verify a password against a hash
 */
export async function verifyPassword(
  password: string,
  hash: string
): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

/**
 * Check password strength
 * Returns an object with strength score and issues
 */
export function checkPasswordStrength(password: string): {
  score: number; // 0-4 (0 = very weak, 4 = very strong)
  issues: string[];
  isValid: boolean;
} {
  const issues: string[] = [];
  let score = 0;

  // Minimum length check
  if (password.length < 8) {
    issues.push('Password must be at least 8 characters');
  } else {
    score++;
    if (password.length >= 12) score++;
  }

  // Uppercase check
  if (!/[A-Z]/.test(password)) {
    issues.push('Password should contain at least one uppercase letter');
  } else {
    score++;
  }

  // Lowercase check
  if (!/[a-z]/.test(password)) {
    issues.push('Password should contain at least one lowercase letter');
  }

  // Number check
  if (!/[0-9]/.test(password)) {
    issues.push('Password should contain at least one number');
  } else {
    score++;
  }

  // Special character check
  if (!/[!@#$%^&*(),.?":{}|<>]/.test(password)) {
    issues.push('Password should contain at least one special character');
  }

  return {
    score: Math.min(score, 4),
    issues,
    isValid: password.length >= 8 && issues.length <= 2,
  };
}

/**
 * Generate a random password
 */
export function generateRandomPassword(length: number = 16): string {
  const uppercase = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const lowercase = 'abcdefghijklmnopqrstuvwxyz';
  const numbers = '0123456789';
  const special = '!@#$%^&*';
  const all = uppercase + lowercase + numbers + special;

  let password = '';

  // Ensure at least one of each type
  password += uppercase[Math.floor(Math.random() * uppercase.length)];
  password += lowercase[Math.floor(Math.random() * lowercase.length)];
  password += numbers[Math.floor(Math.random() * numbers.length)];
  password += special[Math.floor(Math.random() * special.length)];

  // Fill the rest
  for (let i = 4; i < length; i++) {
    password += all[Math.floor(Math.random() * all.length)];
  }

  // Shuffle the password
  return password
    .split('')
    .sort(() => Math.random() - 0.5)
    .join('');
}

/**
 * Generate a secure password reset token
 * Returns both the plain token (to send to user) and hashed token (to store in DB)
 */
export function generateResetToken(): {
  token: string;
  hashedToken: string;
  expiresAt: Date;
} {
  // Generate 32 random bytes = 64 hex characters
  const token = randomBytes(32).toString('hex');

  // Hash the token for storage (so even if DB is compromised, tokens can't be used)
  const hashedToken = createHash('sha256').update(token).digest('hex');

  // Token expires in 1 hour
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000);

  return { token, hashedToken, expiresAt };
}

/**
 * Hash a reset token for comparison
 */
export function hashResetToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Check if a reset token has expired
 */
export function isResetTokenExpired(expiresAt: Date | string): boolean {
  const expiry = typeof expiresAt === 'string' ? new Date(expiresAt) : expiresAt;
  return expiry < new Date();
}
