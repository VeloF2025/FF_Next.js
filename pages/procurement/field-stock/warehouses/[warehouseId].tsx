import type { GetServerSideProps, NextPage } from 'next';
import { AppLayout } from '@/components/layout';
import { SerialDrilldownView } from '@/components/field-stock/SerialDrilldownView';
import { getWarehouseName } from '@/modules/procurement/field-stock/services/serialHoldingsService';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface PageProps {
  warehouseId: string;
  warehouseName: string;
}

const WarehouseDrilldownPage: NextPage<PageProps> = ({ warehouseId, warehouseName }) => (
  <AppLayout>
    <SerialDrilldownView
      kicker="Warehouse"
      heading={warehouseName}
      fixedFilter={{ warehouseId }}
      backHref="/procurement/field-stock/warehouses"
      backLabel="All warehouses"
    />
  </AppLayout>
);

export const getServerSideProps: GetServerSideProps<PageProps> = async (ctx) => {
  const raw = ctx.params?.warehouseId;
  const warehouseId = Array.isArray(raw) ? raw[0] : raw;
  if (!warehouseId || !UUID_RE.test(warehouseId)) {
    return { notFound: true };
  }
  const warehouseName = await getWarehouseName(warehouseId);
  if (!warehouseName) {
    return { notFound: true };
  }
  return { props: { warehouseId, warehouseName } };
};

export default WarehouseDrilldownPage;
