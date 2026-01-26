/**
 * New pipeline project redirect
 * /pipeline/new → /projects/pipeline/new
 */

import type { GetServerSideProps } from 'next';

export const getServerSideProps: GetServerSideProps = async () => {
  return {
    redirect: {
      destination: '/projects/pipeline/new',
      permanent: true,
    },
  };
};

export default function NewPipelineRedirect() {
  return null;
}
