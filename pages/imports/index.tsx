import { GetServerSideProps } from 'next';
import dynamic from 'next/dynamic';

const ImportsDataGridPage = dynamic(() => import('@/modules/sow/ImportsDataGridPage').then(mod => mod.ImportsDataGridPage || mod.default), {
  ssr: false,
  loading: () => <div>Loading Imports Data Grid...</div>
});

export default function ImportsPageWrapper() {
  return <ImportsDataGridPage />;
}

export const getServerSideProps: GetServerSideProps = async (ctx) => {
  return { props: {} };
};