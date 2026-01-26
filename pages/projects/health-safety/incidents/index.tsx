/**
 * Health & Safety Incidents List
 * /projects/health-safety/incidents - Redirect to main incidents page
 * (Full implementation at /health-safety/incidents)
 */

import type { GetServerSideProps } from 'next';

export const getServerSideProps: GetServerSideProps = async () => {
  return {
    redirect: {
      destination: '/health-safety/incidents',
      permanent: false,
    },
  };
};

export default function IncidentsRedirect() {
  return null;
}
