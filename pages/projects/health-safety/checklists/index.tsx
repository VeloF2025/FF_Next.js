/**
 * Health & Safety Checklists
 * /projects/health-safety/checklists - Redirect to main checklists page
 * (Full implementation at /health-safety/checklists)
 */

import type { GetServerSideProps } from 'next';

export const getServerSideProps: GetServerSideProps = async () => {
  return {
    redirect: {
      destination: '/health-safety/checklists',
      permanent: false,
    },
  };
};

export default function ChecklistsRedirect() {
  return null;
}
