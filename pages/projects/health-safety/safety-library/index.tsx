/**
 * H&S Safety Library
 * /projects/health-safety/safety-library - Redirect to the main page
 * (Full implementation at /health-safety/safety-library)
 */

import type { GetServerSideProps } from 'next';

export const getServerSideProps: GetServerSideProps = async () => {
  return {
    redirect: {
      destination: '/health-safety/safety-library',
      permanent: false,
    },
  };
};

export default function SafetyLibraryRedirect() {
  return null;
}
