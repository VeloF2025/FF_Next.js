/**
 * JWT Utilities
 * Token signing and verification using jose library
 */

import { SignJWT, jwtVerify, JWTPayload as JosePayload } from 'jose';
import type { JWTPayload, AuthUser, AuthRole } from './types';

// Secret key for JWT signing - must be set in environment
const getJWTSecret = (): Uint8Array => {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET environment variable is not set');
  }
  return new TextEncoder().encode(secret);
};

// Token expiration times
const ACCESS_TOKEN_EXPIRY = '24h'; // 24 hours

/**
 * Parameters for creating an impersonation JWT.
 */
export interface ImpersonationParams {
  /** Must be true to flag this token as an impersonation session */
  isImpersonation: boolean;
  /** User ID of the admin who initiated the impersonation */
  impersonatedBy: string;
}

/**
 * Sign a JWT token for a user.
 * Optionally accepts impersonation params to embed impersonation claims.
 */
export async function signToken(
  user: AuthUser,
  sessionId: string,
  expiresIn: string = ACCESS_TOKEN_EXPIRY,
  impersonation?: ImpersonationParams
): Promise<string> {
  const secret = getJWTSecret();

  const claims: Record<string, unknown> = {
    email: user.email,
    role: user.role,
    sessionId,
  };

  if (impersonation) {
    claims.isImpersonation = impersonation.isImpersonation;
    claims.impersonatedBy = impersonation.impersonatedBy;
  }

  const token = await new SignJWT(claims)
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(user.id)
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(secret);

  return token;
}

/**
 * Verify and decode a JWT token
 */
export async function verifyToken(token: string): Promise<JWTPayload | null> {
  try {
    const secret = getJWTSecret();
    const { payload } = await jwtVerify(token, secret);

    // Type assertion with validation
    if (!payload.sub || !payload.email || !payload.role || !payload.sessionId) {
      return null;
    }

    const result: JWTPayload = {
      sub: payload.sub as string,
      email: payload.email as string,
      role: payload.role as AuthRole,
      permissions: [], // Permissions fetched from DB via getUserAndValidateSession()
      sessionId: payload.sessionId as string,
      iat: payload.iat || 0,
      exp: payload.exp || 0,
    };

    if (payload.isImpersonation === true) {
      result.isImpersonation = true;
      result.impersonatedBy = payload.impersonatedBy as string;
    }

    return result;
  } catch (error) {
    // Token invalid or expired
    return null;
  }
}

/**
 * Decode token without verification (for debugging)
 */
export function decodeToken(token: string): JosePayload | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;

    const part = parts[1];
    if (!part) return null;
    const payload = JSON.parse(
      Buffer.from(part, 'base64url' as BufferEncoding).toString('utf-8')
    );
    return payload;
  } catch {
    return null;
  }
}

/**
 * Check if token is expired
 */
export function isTokenExpired(token: string): boolean {
  const decoded = decodeToken(token);
  if (!decoded || !decoded.exp) return true;

  return Date.now() >= decoded.exp * 1000;
}

/**
 * Get time until token expires (in seconds)
 */
export function getTokenExpiryTime(token: string): number {
  const decoded = decodeToken(token);
  if (!decoded || !decoded.exp) return 0;

  const expiresAt = decoded.exp * 1000;
  const now = Date.now();

  return Math.max(0, Math.floor((expiresAt - now) / 1000));
}
