import { GetServerSideProps } from 'next';
import dynamic from 'next/dynamic';

const SOWListPage = dynamic(() => import('@/modules/sow/SOWListPage').then(mod => mod.SOWListPage || mod.default), {
  ssr: false,
  loading: () => <div>Loading SOW list...</div>
});

export default function SOWListPageWrapper() {
  return <SOWListPage />;
}

export const getServerSideProps: GetServerSideProps = async (ctx) => {
  return { props: {} };
};