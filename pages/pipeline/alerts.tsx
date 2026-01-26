/**
 * Pipeline alerts redirect
 * /pipeline/alerts → /projects/pipeline/alerts
 */

import type { GetServerSideProps } from 'next';

export const getServerSideProps: GetServerSideProps = async () => {
  return {
    redirect: {
      destination: '/projects/pipeline/alerts',
      permanent: true,
    },
  };
};

export default function PipelineAlertsRedirect() {
  return null;
}
