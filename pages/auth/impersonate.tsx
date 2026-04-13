/**
 * Impersonation token exchange page
 * SSR page: validates JWT token, sets auth cookie, redirects to /.
 * Only reached via the impersonation flow — normal users never land here.
 */

import type { GetServerSideProps } from 'next';
import { serialize } from 'cookie';
import { verifyToken, AUTH_COOKIE_NAME } from '@/lib/auth';

// No UI — this page only sets a cookie and redirects
export default function ImpersonatePage() {
  return null;
}

export const getServerSideProps: GetServerSideProps = async ({ query, res }) => {
  const token = typeof query.token === 'string' ? query.token : null;

  if (!token) {
    return {
      redirect: { destination: '/login?error=missing_impersonation_token', permanent: false },
    };
  }

  const payload = await verifyToken(token);
  if (!payload || !payload.isImpersonation) {
    return {
      redirect: { destination: '/login?error=invalid_impersonation_token', permanent: false },
    };
  }

  const cookie = serialize(AUTH_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 60 * 60, // 1 hour
    path: '/',
  });

  res.setHeader('Set-Cookie', cookie);

  return {
    redirect: { destination: '/', permanent: false },
  };
};
