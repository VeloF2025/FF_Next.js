# Section 3.5: Analytics & Reporting Module

## Overview

The Analytics & Reporting module provides **comprehensive business intelligence and reporting capabilities** for FibreFlow. It aggregates real-time data from all modules to deliver actionable insights through dashboards, KPIs, and custom reports.

### Module Scope
- **Real-time Dashboards**: Executive and operational dashboards
- **KPI Management**: Key performance indicator tracking
- **Financial Analytics**: Budget, cost, and profitability analysis
- **Operational Reports**: Project progress, resource utilization
- **Custom Reporting**: Ad-hoc report generation

### Key Features
- Real-time data aggregation from Neon database
- Interactive charts and visualizations
- Drill-down capabilities
- Export to Excel/PDF
- Scheduled report generation
- Role-based dashboard access
- **Reports Sandbox** with multi-report financial analysis (Cashflow, Revenue, Expense, Project Financial)
- SharePoint Excel integration for report distribution
- RBAC-controlled analytics access

## Database Schema

### Analytics Tables (`src/lib/neon/schema/analytics/`)

```typescript
// Project analytics aggregation
export const projectAnalytics = pgTable('project_analytics', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id').references(() => projects.id),
  
  // Performance metrics
  progressPercentage: decimal('progress_percentage'),
  budgetUtilization: decimal('budget_utilization'),
  scheduleVariance: integer('schedule_variance'), // days
  costVariance: decimal('cost_variance'),
  
  // Resource metrics
  totalStaff: integer('total_staff'),
  staffUtilization: decimal('staff_utilization'),
  contractorCount: integer('contractor_count'),
  
  // Quality metrics
  defectRate: decimal('defect_rate'),
  reworkPercentage: decimal('rework_percentage'),
  customerSatisfaction: decimal('customer_satisfaction'),
  
  // Calculated daily
  calculatedAt: timestamp('calculated_at').defaultNow(),
});

// KPI metrics tracking
export const kpiMetrics = pgTable('kpi_metrics', {
  id: uuid('id').primaryKey().defaultRandom(),
  kpiCode: varchar('kpi_code', { length: 50 }).unique(),
  name: varchar('name', { length: 255 }),
  category: varchar('category', { length: 100 }), // financial, operational, quality
  
  // Target vs Actual
  targetValue: decimal('target_value'),
  actualValue: decimal('actual_value'),
  variance: decimal('variance'),
  status: varchar('status'), // on_track, at_risk, off_track
  
  // Time period
  periodType: varchar('period_type'), // daily, weekly, monthly, quarterly
  periodStart: timestamp('period_start'),
  periodEnd: timestamp('period_end'),
  
  calculatedAt: timestamp('calculated_at').defaultNow(),
});

// Financial transactions for analytics
export const financialTransactions = pgTable('financial_transactions', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id').references(() => projects.id),
  transactionType: varchar('transaction_type'), // revenue, cost, budget
  category: varchar('category'),
  amount: decimal('amount'),
  transactionDate: timestamp('transaction_date'),
  description: text('description'),
});

// Report cache for performance
export const reportCache = pgTable('report_cache', {
  id: uuid('id').primaryKey().defaultRandom(),
  reportType: varchar('report_type'),
  parameters: json('parameters'),
  data: json('data'),
  generatedAt: timestamp('generated_at').defaultNow(),
  expiresAt: timestamp('expires_at'),
});
```

## API Endpoints

### Dashboard APIs (`api/analytics/dashboard/`)

```javascript
// GET /api/analytics/dashboard/stats - Executive dashboard stats
export async function getDashboardStats() {
  const stats = await sql`
    SELECT 
      -- Project metrics
      COUNT(DISTINCT p.id) as total_projects,
      COUNT(DISTINCT CASE WHEN p.status = 'active' THEN p.id END) as active_projects,
      
      -- Financial metrics
      SUM(p.budget) as total_budget,
      SUM(p.actual_cost) as total_spent,
      AVG(p.profit_margin) as avg_profit_margin,
      
      -- Resource metrics
      COUNT(DISTINCT s.id) as total_staff,
      COUNT(DISTINCT c.id) as total_contractors,
      
      -- Performance
      AVG(pa.progress_percentage) as avg_progress,
      AVG(pa.budget_utilization) as avg_budget_utilization
      
    FROM projects p
    LEFT JOIN project_analytics pa ON p.id = pa.project_id
    LEFT JOIN staff s ON s.status = 'active'
    LEFT JOIN contractors c ON c.status = 'active'
    WHERE p.created_at >= NOW() - INTERVAL '1 year'
  `;
  
  return stats[0];
}

// GET /api/analytics/dashboard/trends - Trend analysis
export async function getTrends(period = '30d') {
  return await sql`
    SELECT 
      DATE_TRUNC('day', calculated_at) as date,
      AVG(progress_percentage) as avg_progress,
      SUM(budget_utilization) as total_utilization,
      AVG(staff_utilization) as avg_staff_utilization
    FROM project_analytics
    WHERE calculated_at >= NOW() - INTERVAL ${period}
    GROUP BY DATE_TRUNC('day', calculated_at)
    ORDER BY date ASC
  `;
}
```

### KPI APIs (`api/analytics/kpis/`)

```javascript
// GET /api/analytics/kpis/calculate - Calculate current KPIs
export async function calculateKPIs() {
  const kpis = [];
  
  // Project delivery KPI
  const projectDelivery = await sql`
    SELECT 
      COUNT(CASE WHEN actual_end_date <= end_date THEN 1 END)::float / 
      COUNT(*)::float * 100 as on_time_delivery
    FROM projects
    WHERE status = 'completed'
    AND actual_end_date IS NOT NULL
  `;
  
  kpis.push({
    kpiCode: 'PROJECT_DELIVERY',
    name: 'On-Time Project Delivery',
    actualValue: projectDelivery[0].on_time_delivery,
    targetValue: 95,
    status: projectDelivery[0].on_time_delivery >= 95 ? 'on_track' : 'at_risk',
  });
  
  // Budget performance KPI
  const budgetPerformance = await sql`
    SELECT 
      AVG(CASE 
        WHEN actual_cost <= budget THEN 100 
        ELSE (budget / actual_cost) * 100 
      END) as budget_performance
    FROM projects
    WHERE actual_cost > 0
  `;
  
  kpis.push({
    kpiCode: 'BUDGET_PERFORMANCE',
    name: 'Budget Performance',
    actualValue: budgetPerformance[0].budget_performance,
    targetValue: 100,
    status: budgetPerformance[0].budget_performance >= 90 ? 'on_track' : 'off_track',
  });
  
  // Store calculated KPIs
  for (const kpi of kpis) {
    await sql`
      INSERT INTO kpi_metrics (
        kpi_code, name, actual_value, target_value, status, calculated_at
      ) VALUES (
        ${kpi.kpiCode}, ${kpi.name}, ${kpi.actualValue}, 
        ${kpi.targetValue}, ${kpi.status}, NOW()
      )
      ON CONFLICT (kpi_code) DO UPDATE SET
        actual_value = ${kpi.actualValue},
        status = ${kpi.status},
        calculated_at = NOW()
    `;
  }
  
  return kpis;
}
```

### Financial Analytics (`api/analytics/financial/`)

```javascript
// GET /api/analytics/financial/summary - Financial summary
export async function getFinancialSummary(projectId) {
  const summary = await sql`
    SELECT 
      p.budget,
      p.actual_cost,
      p.budget - p.actual_cost as variance,
      (p.budget - p.actual_cost) / p.budget * 100 as profit_margin,
      
      -- Monthly burn rate
      p.actual_cost / 
        GREATEST(1, EXTRACT(EPOCH FROM (NOW() - p.actual_start_date)) / 2592000) 
        as monthly_burn_rate,
      
      -- Projected completion cost
      p.actual_cost / GREATEST(0.01, pa.progress_percentage) * 100 
        as projected_total_cost
        
    FROM projects p
    LEFT JOIN project_analytics pa ON p.id = pa.project_id
    WHERE p.id = ${projectId}
  `;
  
  return summary[0];
}

// GET /api/analytics/financial/budgets - Budget analysis
export async function getBudgetAnalysis() {
  return await sql`
    SELECT 
      c.company_name as client,
      COUNT(p.id) as project_count,
      SUM(p.budget) as total_budget,
      SUM(p.actual_cost) as total_spent,
      AVG(pa.budget_utilization) as avg_utilization,
      SUM(p.budget - p.actual_cost) as total_savings
    FROM projects p
    JOIN clients c ON p.client_id = c.id
    LEFT JOIN project_analytics pa ON p.id = pa.project_id
    GROUP BY c.id, c.company_name
    ORDER BY total_budget DESC
  `;
}
```

### Project Analytics (`api/analytics/projects/`)

```javascript
// GET /api/analytics/projects/performance - Project performance metrics
export async function getProjectPerformance() {
  return await sql`
    SELECT 
      p.project_code,
      p.project_name,
      pa.progress_percentage,
      pa.budget_utilization,
      pa.schedule_variance,
      pa.cost_variance,
      
      -- RAG status
      CASE 
        WHEN pa.progress_percentage < 30 AND pa.budget_utilization > 40 THEN 'red'
        WHEN pa.schedule_variance > 10 OR pa.cost_variance > 10000 THEN 'amber'
        ELSE 'green'
      END as rag_status
      
    FROM projects p
    JOIN project_analytics pa ON p.id = pa.project_id
    WHERE p.status = 'active'
    ORDER BY rag_status DESC, pa.progress_percentage ASC
  `;
}

// GET /api/analytics/projects/comparison - Cross-project comparison
export async function compareProjects(projectIds) {
  return await sql`
    SELECT 
      p.project_name,
      pa.*,
      RANK() OVER (ORDER BY pa.progress_percentage DESC) as progress_rank,
      RANK() OVER (ORDER BY pa.budget_utilization ASC) as efficiency_rank
    FROM projects p
    JOIN project_analytics pa ON p.id = pa.project_id
    WHERE p.id = ANY(${projectIds})
  `;
}
```

## Reports Sandbox

The **Reports Sandbox** is a comprehensive financial reporting feature enabling multi-dimensional analysis of project finances, cashflow, and revenue projections. Introduced in commit `ca95b24af9c418e02b45b9d43d92d106fdc23f81` (2026-03-21), the Reports Sandbox provides seven specialized report types with Excel export and SharePoint integration.

### Supported Report Types

#### 1. Cashflow Overview Report
- **Purpose**: Tracks inflow and outflow of funds across projects and time periods
- **Metrics**: Opening balance, cash receipts, cash disbursements, closing balance
- **Scope**: Period-based view (daily, weekly, monthly, quarterly)
- **Access**: Role-based (Admin, Manager; restricted for Technician/Viewer by RBAC)

#### 2. Revenue Overview Report
- **Purpose**: Aggregated revenue analysis across all projects and clients
- **Metrics**: Gross revenue, net revenue, revenue by project, revenue trend
- **Scope**: Client-level and project-level granularity
- **Access**: Admin, Manager, Finance roles

#### 3. Project Revenue Projections Report
- **Purpose**: Forecast revenue completion and trend analysis for individual projects
- **Metrics**: Projected completion revenue, burn-down/burn-up curves, variance analysis
- **Calculation**: Based on historical burn rate and project progress
- **Access**: Project Manager, Admin

#### 4. Expense Pivot Report
- **Purpose**: Multi-dimensional expense analysis by category, supplier, and time period
- **Metrics**: Total expenses, expense ratio (%), trend analysis, cost drivers
- **Pivot Dimensions**: Category, supplier, cost center, project, time period
- **Access**: Finance, Admin roles

#### 5. Project Financial Detail Report
- **Purpose**: Deep-dive financial metrics for a single project
- **Metrics**: Budget vs. Actual (full variance), item-level costs, profitability, forecast-to-complete
- **Format**: Tabular with drill-down to purchase orders and invoices
- **Access**: Project Manager, Finance, Admin

#### 6. Project Detail Report
- **Purpose**: Comprehensive project metadata and status with linked financial snapshot
- **Includes**: Project dates, scope, status, resources, KPIs, attached financials
- **Format**: Single-page summary with drill-down capability
- **Access**: All roles with project assignment (filtered by RBAC)

#### 7. Legacy Expense Summary (Archive)
- **Purpose**: Backward-compatible expense roll-up report
- **Deprecated**: Superseded by Expense Pivot in new workflows

### API Endpoints (`/api/analytics/reports/*`)

```javascript
// GET /api/analytics/reports/cashflow - Cashflow Overview
export async function getCashflowReport(filters = {}) {
  const { projectId, dateRange, granularity } = filters;
  // Returns: { openingBalance, receipts, disbursements, closingBalance, periods }
}

// GET /api/analytics/reports/revenue-overview - Revenue aggregation
export async function getRevenueOverviewReport(filters = {}) {
  const { clientId, projectIds, dateRange } = filters;
  // Returns: { totalRevenue, byProject, byClient, trends }
}

// GET /api/analytics/reports/project-revenue-projection - Revenue forecast
export async function getProjectRevenueProjectionReport(projectId, filters = {}) {
  const { includeHistorical, forecastMethod } = filters;
  // Returns: { projectedCompletion, burnDown, variance, confidence }
}

// GET /api/analytics/reports/expense-pivot - Multi-dimensional expenses
export async function getExpensePivotReport(filters = {}) {
  const { dimensions, categories, dateRange } = filters;
  // Returns: pivoted data by selected dimensions
}

// GET /api/analytics/reports/project-financial-detail - Deep-dive financials
export async function getProjectFinancialDetailReport(projectId) {
  // Returns: { budget, actualCost, variance, forecast, line_items[] }
}

// GET /api/analytics/reports/project-detail - Project summary
export async function getProjectDetailReport(projectId) {
  // Returns: { project metadata, status, financials, resources, kpis }
}

// POST /api/analytics/reports/export - Export to Excel/PDF
export async function exportReport(reportType, filters, format = 'xlsx') {
  // Returns: { downloadUrl, expiresAt, format }
}
```

### Excel Export & SharePoint Integration

All Reports Sandbox reports support **direct export to Excel** with:
- Formatted headers and styling
- Column width auto-fitting
- Pivot table structures (where applicable)
- Shareable links via SharePoint OneDrive

**SharePoint Integration Details:**
- Reports export to `/sites/FibreFlow/Shared Documents/Reports/` structure
- Excel workbooks include metadata tabs (timestamp, filters applied, prepared by)
- Power BI read-enabled for dashboard integration
- Synchronization cadence: 8 PM UTC daily (configurable)

See [`docs/integrations/sharepoint-excel.md`](../integrations/sharepoint-excel.md) for detailed setup.

### RBAC Permission Mapping (SQL Migration 248)

| Report Type | Admin | Manager | Finance | ProjectMgr | Technician | Viewer |
|---|---|---|---|---|---|---|
| Cashflow Overview | ✓ | ✓ | ✓ | ✓ | ✗ | ✗ |
| Revenue Overview | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ |
| Project Revenue Projection | ✓ | ✓ | ✓ | ✓ | ✗ | ✗ |
| Expense Pivot | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ |
| Project Financial Detail | ✓ | ✓ | ✓ | ✓* | ✗ | ✗ |
| Project Detail | ✓ | ✓ | ✓ | ✓* | ✓* | ✓* |

*ProjectMgr, Technician, Viewer: own projects only (scoped by projectId)

**Permission Keys (database):**
- `analytics:reports:cashflow:view`
- `analytics:reports:revenue:view`
- `analytics:reports:projection:view`
- `analytics:reports:expense:view`
- `analytics:reports:financial-detail:view`
- `analytics:reports:project-detail:view`
- `analytics:reports:export:excel`
- `analytics:reports:export:pdf`

### Usage Example

```typescript
// React hook for Reports Sandbox
const useReportSandbox = (reportType: string, filters: ReportFilters) => {
  return useQuery(
    ['analytics', 'report', reportType],
    () => fetch(`/api/analytics/reports/${reportType}?${new URLSearchParams(filters)}`).then(r => r.json()),
    { staleTime: 15 * 60 * 1000 } // 15 min cache
  );
};

// Component example
export function CashflowReportPage() {
  const [filters, setFilters] = useState({ dateRange: 'current-month' });
  const { data, isLoading } = useReportSandbox('cashflow', filters);
  
  return (
    <div>
      <ReportFilters value={filters} onChange={setFilters} />
      <CashflowTable data={data} />
      <button onClick={() => exportReport('cashflow', filters, 'xlsx')}>
        Export to Excel
      </button>
    </div>
  );
}
```

## React Components

### Dashboard Components

#### Executive Dashboard (`src/pages/analytics/Dashboard.tsx`)
```typescript
function ExecutiveDashboard() {
  const { data: stats } = useDashboardStats();
  const { data: trends } = useTrends('30d');
  const { data: kpis } = useKPIs();
  
  return (
    <DashboardLayout>
      {/* KPI Cards */}
      <div className="grid grid-cols-4 gap-4">
        <KPICard
          title="Active Projects"
          value={stats?.activeProjects}
          total={stats?.totalProjects}
          icon={<ProjectsIcon />}
        />
        <KPICard
          title="Budget Utilization"
          value={`${stats?.avgBudgetUtilization}%`}
          trend={calculateTrend(stats?.previousUtilization)}
          icon={<BudgetIcon />}
        />
        <KPICard
          title="On-Time Delivery"
          value={`${kpis?.onTimeDelivery}%`}
          target={95}
          icon={<ClockIcon />}
        />
        <KPICard
          title="Profit Margin"
          value={`${stats?.avgProfitMargin}%`}
          status={stats?.avgProfitMargin > 15 ? 'good' : 'warning'}
          icon={<ProfitIcon />}
        />
      </div>
      
      {/* Charts */}
      <div className="grid grid-cols-2 gap-6">
        <TrendChart
          data={trends}
          title="Project Progress Trend"
          dataKey="avgProgress"
        />
        <PieChart
          data={stats?.projectsByStatus}
          title="Projects by Status"
        />
      </div>
      
      {/* Data Tables */}
      <ProjectPerformanceTable />
    </DashboardLayout>
  );
}
```

#### KPI Dashboard (`src/pages/analytics/KPIDashboard.tsx`)
```typescript
function KPIDashboard() {
  const { data: kpis } = useKPIs();
  const [selectedCategory, setSelectedCategory] = useState('all');
  
  const filteredKPIs = kpis?.filter(kpi => 
    selectedCategory === 'all' || kpi.category === selectedCategory
  );
  
  return (
    <div className="kpi-dashboard">
      <KPICategoryFilter 
        selected={selectedCategory}
        onChange={setSelectedCategory}
      />
      
      <div className="kpi-grid">
        {filteredKPIs?.map(kpi => (
          <KPIWidget
            key={kpi.kpiCode}
            kpi={kpi}
            showTrend
            showTarget
          />
        ))}
      </div>
      
      <KPITrendAnalysis kpis={filteredKPIs} />
    </div>
  );
}
```

### Chart Components

#### Trend Chart
```typescript
function TrendChart({ data, title, dataKey }) {
  return (
    <Card>
      <CardHeader>{title}</CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="date" />
            <YAxis />
            <Tooltip />
            <Legend />
            <Line 
              type="monotone" 
              dataKey={dataKey} 
              stroke="#8884d8"
              strokeWidth={2}
            />
          </LineChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
```

#### Performance Matrix
```typescript
function PerformanceMatrix({ projects }) {
  // Plot projects on budget vs schedule performance
  const data = projects.map(p => ({
    name: p.projectCode,
    x: p.schedulePerformance,
    y: p.budgetPerformance,
    z: p.progressPercentage,
  }));
  
  return (
    <ScatterChart width={600} height={400} data={data}>
      <CartesianGrid />
      <XAxis dataKey="x" name="Schedule" unit="%" />
      <YAxis dataKey="y" name="Budget" unit="%" />
      <ZAxis dataKey="z" name="Progress" range={[50, 400]} />
      <Tooltip cursor={{ strokeDasharray: '3 3' }} />
      <Scatter name="Projects" data={data} fill="#8884d8" />
      {/* Quadrant lines */}
      <ReferenceLine x={100} stroke="green" />
      <ReferenceLine y={100} stroke="green" />
    </ScatterChart>
  );
}
```

## Report Generation

### Custom Report Builder

```typescript
// src/services/analytics/reportBuilder.ts
export class ReportBuilder {
  async generateReport(config: ReportConfig) {
    // Check cache first
    const cached = await this.checkCache(config);
    if (cached && !this.isExpired(cached)) {
      return cached.data;
    }
    
    // Build query based on config
    const query = this.buildQuery(config);
    const data = await executeQuery(query);
    
    // Process and aggregate data
    const processed = this.processData(data, config);
    
    // Cache results
    await this.cacheReport(config, processed);
    
    return processed;
  }
  
  private buildQuery(config: ReportConfig) {
    const { entity, metrics, filters, groupBy, orderBy } = config;
    
    return sql`
      SELECT 
        ${groupBy.join(', ')},
        ${metrics.map(m => this.getMetricSQL(m)).join(', ')}
      FROM ${entity}
      WHERE ${this.buildWhereClause(filters)}
      GROUP BY ${groupBy.join(', ')}
      ORDER BY ${orderBy}
    `;
  }
}
```

### Export Functionality

```typescript
// Export to Excel
export async function exportToExcel(reportData: any[], filename: string) {
  const worksheet = XLSX.utils.json_to_sheet(reportData);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Report');
  
  // Add formatting
  worksheet['!cols'] = calculateColumnWidths(reportData);
  
  // Generate file
  const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
  downloadFile(buffer, `${filename}.xlsx`);
}

// Export to PDF
export async function exportToPDF(reportData: any[], title: string) {
  const doc = new jsPDF();
  
  // Add title
  doc.setFontSize(16);
  doc.text(title, 14, 15);
  
  // Add data table
  doc.autoTable({
    startY: 25,
    head: [Object.keys(reportData[0])],
    body: reportData.map(row => Object.values(row)),
  });
  
  doc.save(`${title.toLowerCase().replace(/ /g, '-')}.pdf`);
}
```

## Performance Optimization

### Query Optimization
```typescript
// Materialized views for complex aggregations
CREATE MATERIALIZED VIEW project_performance_summary AS
SELECT 
  p.id,
  p.project_code,
  -- Pre-calculated metrics
  AVG(pa.progress_percentage) as avg_progress,
  SUM(ft.amount) as total_cost,
  -- More aggregations...
FROM projects p
JOIN project_analytics pa ON p.id = pa.project_id
JOIN financial_transactions ft ON p.id = ft.project_id
GROUP BY p.id, p.project_code;

// Refresh periodically
REFRESH MATERIALIZED VIEW project_performance_summary;
```

### Caching Strategy
```typescript
// React Query caching for analytics
const analyticsQueryOptions = {
  staleTime: 15 * 60 * 1000, // 15 minutes
  cacheTime: 30 * 60 * 1000, // 30 minutes
  refetchInterval: 5 * 60 * 1000, // 5 minutes
};
```

## Next.js Migration Impact

### Server-side Analytics
```typescript
// app/analytics/dashboard/page.tsx
export default async function DashboardPage() {
  // Calculate analytics server-side
  const stats = await calculateDashboardStats();
  const kpis = await calculateKPIs();
  
  return (
    <Dashboard 
      initialStats={stats}
      initialKPIs={kpis}
    />
  );
}
```

### Streaming Analytics
```typescript
// app/api/analytics/stream/route.ts
export async function GET() {
  const stream = new TransformStream();
  const writer = stream.writable.getWriter();
  
  // Stream real-time analytics updates
  const interval = setInterval(async () => {
    const update = await getLatestMetrics();
    await writer.write(JSON.stringify(update));
  }, 5000);
  
  return new Response(stream.readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
    },
  });
}
```

## Best Practices

### Do's
- ✅ Use materialized views for complex queries
- ✅ Cache expensive calculations
- ✅ Provide drill-down capabilities
- ✅ Include data export options

### Don'ts
- ❌ Don't calculate metrics on every request
- ❌ Don't ignore query performance
- ❌ Don't show stale data without indication
- ❌ Don't overload dashboards with metrics

## Summary

The Analytics & Reporting module provides comprehensive business intelligence capabilities with real-time data from the Neon database. It delivers actionable insights through interactive dashboards, KPI tracking, and custom reporting, enabling data-driven decision making across the organization.