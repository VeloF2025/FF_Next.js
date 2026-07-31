/**
 * H&S CAPA
 * /projects/health-safety/capa - Redirect to the main page
 * (Full implementation at /health-safety/capa)
 */

import type { GetServerSideProps } from 'next';

export const getServerSideProps: GetServerSideProps = async () => {
  return {
    redirect: {
      destination: '/health-safety/capa',
      permanent: false,
    },
  };
};

export default function CapaRedirect() {
  return null;
}
