// src/types/field-stock/dashboardV2.ts
export interface StockValueByLocationRow {
  name: string;
  type: string;
  value: number;
  itemCount: number;
}

export interface ContractorExposureRow {
  name: string;
  heldValue: number;
  unaccountedValue: number;
  isBlocked: boolean;
}

export interface DashboardV2Summary {
  stockValue: {
    total: number;
    byLocation: StockValueByLocationRow[];
  };
  contractorExposure: {
    totalHeldValue: number;
    totalUnaccountedValue: number;
    totalPendingRecovery: number;
    blockedCount: number;
    top: ContractorExposureRow[];
  };
  serialsLifecycle: {
    byStatus: Record<string, number>;
    installed: number;
    activated: number;
    recentlyInstalled: number;
    recentlyActivated: number;
  };
  ageing: {
    thresholdDays: number;
    stagnantStockCount: number;
    stagnantStockValue: number;
    serialsIssuedNotInstalled: number;
  };
}
