/**
 * Report New H&S Incident
 * /projects/health-safety/incidents/new - Redirect to main new incident page
 * (Full implementation at /health-safety/incidents/new)
 */

import type { GetServerSideProps } from 'next';

export const getServerSideProps: GetServerSideProps = async () => {
  return {
    redirect: {
      destination: '/health-safety/incidents/new',
      permanent: false,
    },
  };
};

export default function NewIncidentRedirect() {
  return null;
}
