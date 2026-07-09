import type { GetServerSideProps, NextPage } from 'next';
import { AppLayout } from '@/components/layout/AppLayout';
import { FnoAtlasDashboard } from '@/modules/fno-atlas/components/FnoAtlasDashboard';
import { verifyToken } from '@/lib/auth/jwt';

// Auth cookie name — mirrors AUTH_COOKIE_NAME in @/lib/auth/middleware. Declared
// locally so this page never imports the middleware barrel (which pulls a neon
// client) into its module graph.
const AUTH_COOKIE_NAME = 'ff_auth_token';

const FnoAtlasPage: NextPage = () => {
  return (
    <AppLayout>
      <FnoAtlasDashboard />
    </AppLayout>
  );
};

export default FnoAtlasPage;

// Server-side auth guard. FNO Atlas exposes competitor coverage intelligence,
// so the page must not render for unauthenticated visitors. The JWT is verified
// in-memory (jose, no DB) to keep getServerSideProps cheap and avoid a pre-auth
// DB read; full session validation (revocation, user active) still happens in
// withAuth on the /api/fno-atlas/* endpoints this page calls.
export const getServerSideProps: GetServerSideProps = async ({ req, resolvedUrl }) => {
  const token = req.cookies[AUTH_COOKIE_NAME];
  const payload = token ? await verifyToken(token) : null;

  if (!payload) {
    return {
      redirect: {
        destination: `/sign-in?returnUrl=${encodeURIComponent(resolvedUrl)}`,
        permanent: false,
      },
    };
  }

  return { props: {} };
};
