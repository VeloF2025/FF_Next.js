import type { ComponentType } from 'react';
import type { ApprovalRequestRecord, WorkflowType } from './types';
import { SummaryFallbackPanel } from './panels/SummaryFallbackPanel';
import { PurchaseOrderPanel } from './panels/PurchaseOrderPanel';
import { RequisitionPanel } from './panels/RequisitionPanel';

type PanelProps = { record: ApprovalRequestRecord };
const REGISTRY: Partial<Record<WorkflowType, ComponentType<PanelProps>>> = {
  purchase_order: PurchaseOrderPanel,
  purchase_requisition: RequisitionPanel,
};

export function ApprovalDetailPanel({ record }: PanelProps) {
  const Panel = REGISTRY[record.documentType] ?? SummaryFallbackPanel;
  return <Panel record={record} />;
}
