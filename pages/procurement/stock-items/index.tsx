import type { NextPage } from 'next';
import { AppLayout } from '@/components/layout/AppLayout';
import { StockItemsPage } from '@/modules/stock-items';

const ProcurementStockItemsPage: NextPage = () => {
  return (
    <AppLayout>
      <StockItemsPage />
    </AppLayout>
  );
};

export default ProcurementStockItemsPage;

export const getServerSideProps = async () => {
  return {
    props: {},
  };
};
