/**
 * Health & Safety Incidents List - Redirect
 * /projects/health-safety/incidents → /health-safety/incidents
 */

import type { GetServerSideProps } from 'next';

export const getServerSideProps: GetServerSideProps = async () => {
  return {
    redirect: {
      destination: '/health-safety/incidents',
      permanent: true,
    },
  };
};

export default function IncidentsRedirect() {
  return null;
}
