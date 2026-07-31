/**
 * H&S Risk Register
 * /projects/health-safety/risks - Redirect to the main page
 * (Full implementation at /health-safety/risks)
 */

import type { GetServerSideProps } from 'next';

export const getServerSideProps: GetServerSideProps = async () => {
  return {
    redirect: {
      destination: '/health-safety/risks',
      permanent: false,
    },
  };
};

export default function RisksRedirect() {
  return null;
}
