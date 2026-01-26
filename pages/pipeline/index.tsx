/**
 * Pipeline redirect
 * /pipeline → /projects/pipeline
 */

import type { GetServerSideProps } from 'next';

export const getServerSideProps: GetServerSideProps = async () => {
  return {
    redirect: {
      destination: '/projects/pipeline',
      permanent: true,
    },
  };
};

export default function PipelineRedirect() {
  return null;
}
