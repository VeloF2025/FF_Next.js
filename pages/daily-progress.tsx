/**
 * Daily Progress redirect
 * /daily-progress → /projects/progress
 */

import type { GetServerSideProps } from 'next';

export const getServerSideProps: GetServerSideProps = async () => {
  return {
    redirect: {
      destination: '/projects/progress',
      permanent: true,
    },
  };
};

export default function DailyProgressRedirect() {
  return null;
}
