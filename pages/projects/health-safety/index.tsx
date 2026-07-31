/**
 * Health & Safety Dashboard
 * /projects/health-safety - Redirect to the main page
 * (Full implementation at /health-safety)
 */

import type { GetServerSideProps } from 'next';

export const getServerSideProps: GetServerSideProps = async () => {
  return {
    redirect: {
      destination: '/health-safety',
      permanent: false,
    },
  };
};

export default function HealthSafetyRedirect() {
  return null;
}
