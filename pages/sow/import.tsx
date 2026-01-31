import { GetServerSideProps } from 'next';
import dynamic from 'next/dynamic';

const SOWImportPage = dynamic(() => import('@/modules/sow/SOWImportPage').then(mod => mod.SOWImportPage || mod.default), {
  ssr: false,
  loading: () => <div>Loading SOW import...</div>
});

export default function SOWImportPageWrapper() {
  return <SOWImportPage />;
}

export const getServerSideProps: GetServerSideProps = async (ctx) => {
  return { props: {} };
};