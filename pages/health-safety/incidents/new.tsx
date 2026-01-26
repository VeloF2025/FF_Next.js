/**
 * Report New H&S Incident redirect
 * /health-safety/incidents/new → /projects/health-safety/incidents/new
 */

import type { GetServerSideProps } from 'next';

export const getServerSideProps: GetServerSideProps = async () => {
  return {
    redirect: {
      destination: '/projects/health-safety/incidents/new',
      permanent: true,
    },
  };
};

export default function NewIncidentRedirect() {
  return null;
}
