/**
 * Health & Safety redirect
 * /health-safety → /projects/health-safety
 */

import type { GetServerSideProps } from 'next';

export const getServerSideProps: GetServerSideProps = async () => {
  return {
    redirect: {
      destination: '/projects/health-safety',
      permanent: true,
    },
  };
};

export default function HealthSafetyRedirect() {
  return null;
}
