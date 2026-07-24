/**
 * Health & Safety Toolbox Talks
 * /projects/health-safety/toolbox - Redirect to the main toolbox page
 * (Full implementation at /health-safety/toolbox)
 */

import type { GetServerSideProps } from 'next';

export const getServerSideProps: GetServerSideProps = async () => {
  return {
    redirect: {
      destination: '/health-safety/toolbox',
      permanent: false,
    },
  };
};

export default function ToolboxRedirect() {
  return null;
}
