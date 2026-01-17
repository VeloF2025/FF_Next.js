import type { NextPage } from 'next';
import { AppLayout } from '@/components/layout/AppLayout';
import { StockItemsPage } from '@/modules/stock-items';

const StockItemsIndexPage: NextPage = () => {
  return (
    <AppLayout>
      <StockItemsPage />
    </AppLayout>
  );
};

export default StockItemsIndexPage;

export const getServerSideProps = async () => {
  return {
    props: {},
  };
};
