/**
 * Health & Safety Analytics
 * /projects/health-safety/analytics - Redirect to the main analytics page
 * (Full implementation at /health-safety/analytics)
 */

import type { GetServerSideProps } from 'next';

export const getServerSideProps: GetServerSideProps = async () => {
  return {
    redirect: {
      destination: '/health-safety/analytics',
      permanent: false,
    },
  };
};

export default function AnalyticsRedirect() {
  return null;
}
