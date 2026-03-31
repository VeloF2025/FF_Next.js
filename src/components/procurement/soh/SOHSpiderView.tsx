/**
 * SOHSpiderView — Relationship diagram showing all DB tables/modules
 * that touch Stock on Hand (SOH) data in FibreFlow.
 *
 * Diagnostic/scoping tool for Phase 1 of the SOH flow redesign.
 * Built with ReactFlow (already installed).
 */
'use client';
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  type Node,
  type Edge,
  BackgroundVariant,
  Panel,
} from 'reactflow';
import 'reactflow/dist/style.css';

// ─── Node definitions ─────────────────────────────────────────────────────────

const DB_NODES: Node[] = [
  // Core stock table
  {
    id: 'stock_items',
    type: 'default',
    position: { x: 500, y: 300 },
    data: { label: '🗄️ stock_items\nqty_available\nqty_reserved\nmin_stock_level' },
    style: nodeStyle('#1e40af', '#3b82f6'),
  },
  // Warehouse breakdown
  {
    id: 'stock_levels',
    type: 'default',
    position: { x: 750, y: 150 },
    data: { label: '🏭 stock_levels\nqty_on_hand (per warehouse)\nqty_available (generated)\nwarehouse_id' },
    style: nodeStyle('#1e3a5f', '#60a5fa'),
  },
  // BOQ items
  {
    id: 'boq_items',
    type: 'default',
    position: { x: 250, y: 150 },
    data: { label: '📋 boq_items\nstock_item_id (FK)\nquantity (planned)\nunit_price (BOQ rate)' },
    style: nodeStyle('#14532d', '#22c55e'),
  },
  // Purchase orders
  {
    id: 'purchase_order_items',
    type: 'default',
    position: { x: 100, y: 350 },
    data: { label: '🛒 purchase_order_items\nboq_item_id (FK)\nquantity_ordered\nstatus' },
    style: nodeStyle('#78350f', '#f59e0b'),
  },
  // GRN
  {
    id: 'grn',
    type: 'default',
    position: { x: 100, y: 550 },
    data: { label: '📦 goods_receipt_items\nboq_item_id (FK)\nquantity_accepted\n→ increments qty_available' },
    style: nodeStyle('#7c2d12', '#f97316'),
  },
  // Field stock
  {
    id: 'field_stock',
    type: 'default',
    position: { x: 750, y: 500 },
    data: { label: '🏗️ field_stock_quantities\nquantity_on_hand (per tech)\nquantity_reserved\nproject / technician' },
    style: nodeStyle('#4c1d95', '#a78bfa'),
  },
  // Odoo sync
  {
    id: 'odoo_sync',
    type: 'default',
    position: { x: 850, y: 300 },
    data: { label: '🔄 Odoo Sync\nstockLevelSync.ts\nsyncs qty_on_hand\nper warehouse → stock_levels' },
    style: nodeStyle('#1c1917', '#a8a29e'),
  },
  // SOH Audit (manual import)
  {
    id: 'soh_audit',
    type: 'default',
    position: { x: 500, y: 550 },
    data: { label: '📊 soh_audit_entries\nManual import (Phase 1)\nversion-stamped\nquantities JSONB per warehouse' },
    style: nodeStyle('#831843', '#f472b6'),
  },
  // Accounting
  {
    id: 'accounting',
    type: 'default',
    position: { x: 250, y: 550 },
    data: { label: '💰 Accounting\nitem_opening_balances\nitem_adjustments\nquantity_on_hand (accounting view)' },
    style: nodeStyle('#134e4a', '#2dd4bf'),
  },
  // BOQ View (UI)
  {
    id: 'boq_view',
    type: 'default',
    position: { x: 500, y: 50 },
    data: { label: '👁️ BOQ Stock View (UI)\nPlanned / Ordered / Delivered\nSOH = MAX(stock_items.qty_available)\nper boq_item → stock_item join' },
    style: nodeStyle('#1e2433', '#94a3b8'),
  },
  // Low stock alerts
  {
    id: 'low_stock',
    type: 'default',
    position: { x: 900, y: 440 },
    data: { label: '🚨 Low Stock Alerts\nqty_available ≤ min_stock_level\naggregate-metrics.ts\ntab-badges.ts' },
    style: nodeStyle('#450a0a', '#ef4444'),
  },
];

const EDGES: Edge[] = [
  // BOQ items → stock_items (FK link)
  { id: 'e1', source: 'boq_items', target: 'stock_items', label: 'stock_item_id FK', animated: false, style: edgeStyle('#22c55e') },
  // PO items → BOQ items
  { id: 'e2', source: 'purchase_order_items', target: 'boq_items', label: 'boq_item_id FK', animated: false, style: edgeStyle('#f59e0b') },
  // GRN → stock_items (increments qty_available)
  { id: 'e3', source: 'grn', target: 'stock_items', label: '+ qty_available', animated: true, style: edgeStyle('#f97316') },
  // GRN → PO items (links back)
  { id: 'e4', source: 'grn', target: 'purchase_order_items', label: 'purchase_order_item_id FK', animated: false, style: edgeStyle('#78350f') },
  // Odoo sync → stock_levels
  { id: 'e5', source: 'odoo_sync', target: 'stock_levels', label: 'syncs qty_on_hand', animated: true, style: edgeStyle('#a8a29e') },
  // stock_levels → stock_items (aggregated)
  { id: 'e6', source: 'stock_levels', target: 'stock_items', label: 'aggregates to qty_available', animated: false, style: edgeStyle('#60a5fa') },
  // stock_items → BOQ View (UI reads)
  { id: 'e7', source: 'stock_items', target: 'boq_view', label: 'MAX(qty_available) = SOH', animated: false, style: edgeStyle('#94a3b8') },
  // BOQ items → BOQ View
  { id: 'e8', source: 'boq_items', target: 'boq_view', label: 'planned qty / BOQ rate', animated: false, style: edgeStyle('#94a3b8') },
  // stock_items → field_stock (conceptual — separate system)
  { id: 'e9', source: 'stock_items', target: 'field_stock', label: 'issued to field', animated: false, style: { ...edgeStyle('#a78bfa'), strokeDasharray: '5,5' } },
  // stock_items → low stock alerts
  { id: 'e10', source: 'stock_items', target: 'low_stock', label: 'qty_available ≤ min_stock_level', animated: false, style: edgeStyle('#ef4444') },
  // accounting → stock_items (opening balances set qty)
  { id: 'e11', source: 'accounting', target: 'stock_items', label: 'opening balances → qty_on_hand', animated: false, style: edgeStyle('#2dd4bf') },
  // soh_audit → (future) stock_items
  { id: 'e12', source: 'soh_audit', target: 'stock_items', label: 'Phase 2: feeds live data', animated: false, style: { ...edgeStyle('#f472b6'), strokeDasharray: '6,4' } },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function nodeStyle(bg: string, border: string): React.CSSProperties {
  return {
    background: bg,
    border: `1.5px solid ${border}`,
    borderRadius: 8,
    color: '#f1f5f9',
    fontSize: 11,
    fontFamily: 'monospace',
    whiteSpace: 'pre-line',
    padding: '8px 12px',
    minWidth: 220,
    textAlign: 'left' as const,
    boxShadow: `0 0 12px ${border}33`,
  };
}

function edgeStyle(color: string): React.CSSProperties {
  return { stroke: color, strokeWidth: 1.5 };
}

// ─── Component ────────────────────────────────────────────────────────────────

export function SOHSpiderView() {
  return (
    <div style={{ height: 'calc(100vh - 280px)', width: '100%', borderRadius: 8, overflow: 'hidden', border: '1px solid var(--ff-border-light)' }}>
      <ReactFlow
        nodes={DB_NODES}
        edges={EDGES}
        fitView
        fitViewOptions={{ padding: 0.15 }}
        nodesDraggable={true}
        nodesConnectable={false}
        elementsSelectable={true}
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#1e293b" />
        <Controls showInteractive={false} style={{ background: '#0f172a', border: '1px solid #1e293b' }} />
        <MiniMap
          style={{ background: '#0f172a', border: '1px solid #1e293b' }}
          nodeColor={(n) => (n.style?.border as string ?? '#334155').replace('1.5px solid ', '')}
        />
        <Panel position="top-left">
          <div style={{
            background: '#0f172a',
            border: '1px solid #1e293b',
            borderRadius: 6,
            padding: '8px 12px',
            fontSize: 11,
            color: '#94a3b8',
            maxWidth: 260,
          }}>
            <div style={{ fontWeight: 600, color: '#e2e8f0', marginBottom: 6 }}>SOH Data Flow — Phase 1</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <LegendItem color="#f97316" label="GRN → increments stock" />
              <LegendItem color="#a8a29e" label="Odoo Sync → warehouse levels" />
              <LegendItem color="#f472b6" label="Audit import (manual, Phase 1)" dashed />
              <LegendItem color="#a78bfa" label="Field stock (separate system)" dashed />
              <LegendItem color="#ef4444" label="Low stock alerts" />
              <div style={{ marginTop: 6, color: '#64748b', fontSize: 10 }}>
                Dashed = planned / Phase 2 connection
              </div>
            </div>
          </div>
        </Panel>
      </ReactFlow>
    </div>
  );
}

function LegendItem({ color, label, dashed }: { color: string; label: string; dashed?: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <div style={{
        width: 24,
        height: 2,
        background: dashed ? 'none' : color,
        borderTop: dashed ? `2px dashed ${color}` : 'none',
        flexShrink: 0,
      }} />
      <span style={{ fontSize: 10 }}>{label}</span>
    </div>
  );
}
