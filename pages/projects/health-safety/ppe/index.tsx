/**
 * Health & Safety PPE
 * /projects/health-safety/ppe - Redirect to the main PPE register page
 * (Full implementation at /health-safety/ppe)
 */

import type { GetServerSideProps } from 'next';

export const getServerSideProps: GetServerSideProps = async () => {
  return {
    redirect: {
      destination: '/health-safety/ppe',
      permanent: false,
    },
  };
};

export default function PPERedirect() {
  return null;
}
