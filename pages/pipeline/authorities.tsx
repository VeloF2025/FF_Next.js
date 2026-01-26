/**
 * Pipeline authorities redirect
 * /pipeline/authorities → /projects/pipeline/authorities
 */

import type { GetServerSideProps } from 'next';

export const getServerSideProps: GetServerSideProps = async () => {
  return {
    redirect: {
      destination: '/projects/pipeline/authorities',
      permanent: true,
    },
  };
};

export default function PipelineAuthoritiesRedirect() {
  return null;
}
