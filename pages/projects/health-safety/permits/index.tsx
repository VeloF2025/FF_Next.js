/**
 * Health & Safety Permits
 * /projects/health-safety/permits - Redirect to the main permits page
 * (Full implementation at /health-safety/permits)
 */

import type { GetServerSideProps } from 'next';

export const getServerSideProps: GetServerSideProps = async () => {
  return {
    redirect: {
      destination: '/health-safety/permits',
      permanent: false,
    },
  };
};

export default function PermitsRedirect() {
  return null;
}
