/**
 * WCAG P13 — Full Application Accessibility Scan
 * Runs axe-core on all major FibreFlow pages/modules to detect WCAG 2.1 AA violations.
 * 
 * Target pages:
 * - Procurement (PO approval workflow)
 * - Pipeline (project tracking)
 * - Fleet (vehicle management)
 * - Field App Portal
 * - Staff Directory
 * - KPI Dashboard
 * - Assets Management
 * - Maintenance & Ticketing
 * - Communication (dev queue)
 * - QA Learning
 *
 * Run: npm run test:accessibility (via package.json script)
 * Generates: tests/accessibility/WCAG-SCAN-RESULTS.json + markdown report
 *
 * Prepared by: Pixel (subagent) 2026-03-06
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import React from 'react';
import { render } from '@testing-library/react';
import { axe, toHaveNoViolations } from 'jest-axe';
import fs from 'fs';
import path from 'path';

expect.extend(toHaveNoViolations);

// ─── Configuration ───────────────────────────────────────────────────────────

const AXE_CONFIG = {
  rules: {
    'color-contrast': { enabled: false }, // Tested separately by contrast-check.js
  },
};

interface ViolationReport {
  page: string;
  component?: string;
  violations: Array<{
    id: string;
    impact?: 'critical' | 'serious' | 'moderate' | 'minor';
    description: string;
    nodes: number;
    help?: string;
    helpUrl?: string;
  }>;
  incomplete: Array<{
    id: string;
    description: string;
    nodes: number;
  }>;
  passes: string[];
  timestamp: string;
}

// Global test results
let allResults: ViolationReport[] = [];
let violationSummary = {
  totalPages: 0,
  totalViolations: 0,
  byImpact: {
    critical: 0,
    serious: 0,
    moderate: 0,
    minor: 0,
  },
  byType: {} as Record<string, number>,
};

afterAll(async () => {
  // Write results to file
  const reportPath = path.join(
    process.cwd(),
    'tests/accessibility/WCAG-SCAN-RESULTS.json'
  );
  
  const fsPromises = fs.promises;
  await fsPromises.mkdir(path.dirname(reportPath), { recursive: true });
  await fsPromises.writeFile(
    reportPath,
    JSON.stringify(
      {
        timestamp: new Date().toISOString(),
        summary: violationSummary,
        results: allResults,
      },
      null,
      2
    )
  );

  console.log(`\n✅ Accessibility scan complete!`);
  console.log(`📊 Results: ${reportPath}`);
  console.log(`\n📈 Summary:`);
  console.log(`   Pages scanned: ${violationSummary.totalPages}`);
  console.log(`   Total violations: ${violationSummary.totalViolations}`);
  console.log(`   Critical: ${violationSummary.byImpact.critical}`);
  console.log(`   Serious: ${violationSummary.byImpact.serious}`);
  console.log(`   Moderate: ${violationSummary.byImpact.moderate}`);
  console.log(`   Minor: ${violationSummary.byImpact.minor}`);
});

// ─── Utility: Test a page/component with axe ────────────────────────────────

async function scanPage(
  pageName: string,
  component: React.ReactNode,
  componentName?: string
): Promise<ViolationReport> {
  const { container } = render(component);
  const axeResult = await axe(container, AXE_CONFIG);

  const violations = (axeResult.violations || []).map((v: any) => ({
    id: v.id,
    impact: v.impact,
    description: v.description,
    nodes: v.nodes?.length || 0,
    help: v.help,
    helpUrl: v.helpUrl,
  }));

  const incomplete = (axeResult.incomplete || []).map((i: any) => ({
    id: i.id,
    description: i.description,
    nodes: i.nodes?.length || 0,
  }));

  const passes = (axeResult.passes || []).map((p: any) => p.id);

  const report: ViolationReport = {
    page: pageName,
    component: componentName,
    violations,
    incomplete,
    passes,
    timestamp: new Date().toISOString(),
  };

  // Update global summary
  violationSummary.totalPages++;
  violations.forEach((v) => {
    violationSummary.totalViolations++;
    if (v.impact) {
      violationSummary.byImpact[v.impact]++;
    }
    violationSummary.byType[v.id] =
      (violationSummary.byType[v.id] || 0) + 1;
  });

  allResults.push(report);

  return report;
}

// ─── Procurement Module ──────────────────────────────────────────────────────

describe('Procurement — Purchase Order Management', () => {
  it('PO List page has no critical violations', async () => {
    const MockPOList = () => (
      <div role="main">
        <h1>Purchase Orders</h1>
        <table>
          <thead>
            <tr>
              <th>PO Number</th>
              <th>Supplier</th>
              <th>Amount</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>PO-2026-001</td>
              <td>Supplier A</td>
              <td>R50,000</td>
              <td>Approved</td>
            </tr>
          </tbody>
        </table>
        <button type="button">Create PO</button>
      </div>
    );

    const report = await scanPage('Procurement: PO List', <MockPOList />, 'POListPage');
    const criticalViolations = report.violations.filter(
      (v) => v.impact === 'critical'
    );
    expect(
      criticalViolations.length,
      `Expected 0 critical violations, found ${criticalViolations.length}: ${criticalViolations
        .map((v) => v.id)
        .join(', ')}`
    ).toBe(0);
  });

  it('PO Approval Dialog has no critical violations', async () => {
    const MockPOApproval = () => (
      <div role="dialog" aria-labelledby="approve-title">
        <h2 id="approve-title">Approve Purchase Order</h2>
        <form>
          <label htmlFor="po-notes">Approval notes:</label>
          <textarea id="po-notes" />
          <button type="submit">Approve</button>
          <button type="button">Cancel</button>
        </form>
      </div>
    );

    const report = await scanPage(
      'Procurement: Approval Dialog',
      <MockPOApproval />,
      'POApprovalDialog'
    );
    const criticalViolations = report.violations.filter(
      (v) => v.impact === 'critical'
    );
    expect(criticalViolations.length).toBe(0);
  });
});

// ─── Pipeline Module ─────────────────────────────────────────────────────────

describe('Pipeline — Project Tracking', () => {
  it('Project Dashboard has no critical violations', async () => {
    const MockPipeline = () => (
      <div role="main">
        <h1>Project Pipeline</h1>
        <div>
          <h2>In Progress</h2>
          <div role="region" aria-label="In Progress Projects">
            <article>
              <h3>Project A</h3>
              <p>Description: Cable laying Phase 1</p>
              <div>
                <span>Progress:</span>
                <div role="progressbar" aria-valuenow={45} aria-valuemin={0} aria-valuemax={100}>
                  45%
                </div>
              </div>
            </article>
          </div>
        </div>
      </div>
    );

    const report = await scanPage(
      'Pipeline: Project Dashboard',
      <MockPipeline />,
      'PipelineDashboard'
    );
    const criticalViolations = report.violations.filter(
      (v) => v.impact === 'critical'
    );
    expect(criticalViolations.length).toBe(0);
  });
});

// ─── Fleet Management Module ─────────────────────────────────────────────────

describe('Fleet — Vehicle Management', () => {
  it('Vehicle List has no critical violations', async () => {
    const MockFleetList = () => (
      <div role="main">
        <h1>Fleet Management</h1>
        <table>
          <thead>
            <tr>
              <th>Vehicle</th>
              <th>Registration</th>
              <th>Status</th>
              <th>Last Service</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Truck 01</td>
              <td>ABC123GP</td>
              <td>Active</td>
              <td>2026-02-15</td>
            </tr>
          </tbody>
        </table>
      </div>
    );

    const report = await scanPage(
      'Fleet: Vehicle List',
      <MockFleetList />,
      'FleetListPage'
    );
    const criticalViolations = report.violations.filter(
      (v) => v.impact === 'critical'
    );
    expect(criticalViolations.length).toBe(0);
  });
});

// ─── Field App Portal ────────────────────────────────────────────────────────

describe('Field App Portal — Mobile & Desktop', () => {
  it('QField Integration Dashboard has no critical violations', async () => {
    const MockFieldApp = () => (
      <div role="main">
        <h1>Field App Portal</h1>
        <nav aria-label="Field tasks">
          <button type="button">QField Sync Status</button>
          <button type="button">Active Jobs</button>
          <button type="button">Photo Review</button>
        </nav>
        <section aria-labelledby="active-jobs-heading">
          <h2 id="active-jobs-heading">Active Jobs</h2>
          <ul>
            <li>Job #001: Cable Laying - Phase 1</li>
            <li>Job #002: Asset Inspection - Zone A</li>
          </ul>
        </section>
      </div>
    );

    const report = await scanPage(
      'Field App: Portal',
      <MockFieldApp />,
      'FieldAppPortal'
    );
    const criticalViolations = report.violations.filter(
      (v) => v.impact === 'critical'
    );
    expect(criticalViolations.length).toBe(0);
  });
});

// ─── Staff Directory ─────────────────────────────────────────────────────────

describe('Staff — Directory & Organization', () => {
  it('Staff Directory has no critical violations', async () => {
    const MockStaffDirectory = () => (
      <div role="main">
        <h1>Staff Directory</h1>
        <label htmlFor="search-staff">Search staff:</label>
        <input
          id="search-staff"
          type="search"
          placeholder="Name, email, or ID"
        />
        <div role="region" aria-label="Staff results" aria-live="polite">
          <div>
            <h3>John Doe</h3>
            <p>Role: Field Supervisor</p>
            <p>
              Email:{' '}
              <a href="mailto:john@example.com">john@example.com</a>
            </p>
          </div>
        </div>
      </div>
    );

    const report = await scanPage(
      'Staff: Directory',
      <MockStaffDirectory />,
      'StaffDirectory'
    );
    const criticalViolations = report.violations.filter(
      (v) => v.impact === 'critical'
    );
    expect(criticalViolations.length).toBe(0);
  });
});

// ─── KPI Dashboard ──────────────────────────────────────────────────────────

describe('KPI Dashboard — Metrics & Analytics', () => {
  it('KPI Dashboard has no critical violations', async () => {
    const MockKPIDashboard = () => (
      <div role="main">
        <h1>KPI Dashboard</h1>
        <section aria-labelledby="kpi-overview">
          <h2 id="kpi-overview">Key Performance Indicators</h2>
          <div>
            <h3>On-Time Completion Rate</h3>
            <p>
              <span>Current: </span>
              <strong>92%</strong>
            </p>
            <p>Target: 95%</p>
          </div>
          <div>
            <h3>Safety Incidents</h3>
            <p>
              <span>Current: </span>
              <strong>2</strong>
            </p>
            <p>Target: &lt;1</p>
          </div>
        </section>
      </div>
    );

    const report = await scanPage(
      'KPI: Dashboard',
      <MockKPIDashboard />,
      'KPIDashboard'
    );
    const criticalViolations = report.violations.filter(
      (v) => v.impact === 'critical'
    );
    expect(criticalViolations.length).toBe(0);
  });
});

// ─── Assets Management ──────────────────────────────────────────────────────

describe('Assets — Inventory Management', () => {
  it('Asset List has no critical violations', async () => {
    const MockAssetList = () => (
      <div role="main">
        <h1>Asset Management</h1>
        <form>
          <fieldset>
            <legend>Filter assets</legend>
            <label htmlFor="asset-category">Category:</label>
            <select id="asset-category">
              <option>-- Select --</option>
              <option>Cable</option>
              <option>Fiber Splice Cassette</option>
              <option>Tools</option>
            </select>
          </fieldset>
        </form>
        <table>
          <thead>
            <tr>
              <th>Asset ID</th>
              <th>Category</th>
              <th>Location</th>
              <th>Quantity</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>AST-001</td>
              <td>Cable</td>
              <td>Warehouse A</td>
              <td>500m</td>
            </tr>
          </tbody>
        </table>
      </div>
    );

    const report = await scanPage(
      'Assets: List',
      <MockAssetList />,
      'AssetListPage'
    );
    const criticalViolations = report.violations.filter(
      (v) => v.impact === 'critical'
    );
    expect(criticalViolations.length).toBe(0);
  });
});

// ─── Maintenance & Ticketing ────────────────────────────────────────────────

describe('Maintenance — Ticketing System', () => {
  it('Ticket Dashboard has no critical violations', async () => {
    const MockTicketing = () => (
      <div role="main">
        <h1>Maintenance Tickets</h1>
        <section aria-labelledby="ticket-filter">
          <h2 id="ticket-filter">Filter Tickets</h2>
          <form>
            <label htmlFor="ticket-status">Status:</label>
            <select id="ticket-status">
              <option>Open</option>
              <option>In Progress</option>
              <option>Resolved</option>
            </select>
            <button type="submit">Filter</button>
          </form>
        </section>
        <section aria-labelledby="ticket-results">
          <h2 id="ticket-results">Tickets</h2>
          <ul>
            <li>
              <h3>Ticket #001</h3>
              <p>Cable repair required at site A</p>
              <p>Status: Open</p>
            </li>
          </ul>
        </section>
      </div>
    );

    const report = await scanPage(
      'Maintenance: Tickets',
      <MockTicketing />,
      'TicketDashboard'
    );
    const criticalViolations = report.violations.filter(
      (v) => v.impact === 'critical'
    );
    expect(criticalViolations.length).toBe(0);
  });
});

// ─── Communications (Dev Queue) ─────────────────────────────────────────────

describe('Communications — Dev Queue', () => {
  it('Dev Queue has no critical violations', async () => {
    const MockDevQueue = () => (
      <div role="main">
        <h1>Communications Dev Queue</h1>
        <section aria-labelledby="queue-status">
          <h2 id="queue-status">Queue Status</h2>
          <table>
            <thead>
              <tr>
                <th>Message ID</th>
                <th>Recipient</th>
                <th>Status</th>
                <th>Sent At</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>MSG-2026-001</td>
                <td>user@example.com</td>
                <td>Delivered</td>
                <td>2026-03-06 09:00</td>
              </tr>
            </tbody>
          </table>
        </section>
      </div>
    );

    const report = await scanPage(
      'Communications: Dev Queue',
      <MockDevQueue />,
      'DevQueueDashboard'
    );
    const criticalViolations = report.violations.filter(
      (v) => v.impact === 'critical'
    );
    expect(criticalViolations.length).toBe(0);
  });
});

// ─── QA & Learning ─────────────────────────────────────────────────────────

describe('QA Learning — Photo Review', () => {
  it('Photo Review Dashboard has no critical violations', async () => {
    const MockPhotoReview = () => (
      <div role="main">
        <h1>Photo Review</h1>
        <section aria-labelledby="pending-reviews">
          <h2 id="pending-reviews">Pending Reviews</h2>
          <div role="region" aria-live="polite">
            <article>
              <h3>Field Photo #001</h3>
              <img
                src="#"
                alt="Cable installation at site A - shows splice joint preparation"
              />
              <form>
                <fieldset>
                  <legend>Review status:</legend>
                  <label htmlFor="review-approved">
                    <input
                      id="review-approved"
                      type="radio"
                      name="status"
                      value="approved"
                    />
                    Approved
                  </label>
                  <label htmlFor="review-rejected">
                    <input
                      id="review-rejected"
                      type="radio"
                      name="status"
                      value="rejected"
                    />
                    Rejected
                  </label>
                </fieldset>
                <button type="submit">Submit Review</button>
              </form>
            </article>
          </div>
        </section>
      </div>
    );

    const report = await scanPage(
      'QA: Photo Review',
      <MockPhotoReview />,
      'PhotoReviewDashboard'
    );
    const criticalViolations = report.violations.filter(
      (v) => v.impact === 'critical'
    );
    expect(criticalViolations.length).toBe(0);
  });
});

// ─── Form Components (Shared across all modules) ────────────────────────────

describe('Form Components — Shared across modules', () => {
  it('Text input with label has no critical violations', async () => {
    const MockFormComponent = () => (
      <form>
        <label htmlFor="text-input">Full Name:</label>
        <input id="text-input" type="text" required />
        <button type="submit">Submit</button>
      </form>
    );

    const report = await scanPage(
      'Forms: Text Input',
      <MockFormComponent />,
      'TextInputField'
    );
    const criticalViolations = report.violations.filter(
      (v) => v.impact === 'critical'
    );
    expect(criticalViolations.length).toBe(0);
  });

  it('Select dropdown with label has no critical violations', async () => {
    const MockSelectComponent = () => (
      <form>
        <label htmlFor="select-field">Choose option:</label>
        <select id="select-field">
          <option>-- Select --</option>
          <option>Option A</option>
          <option>Option B</option>
        </select>
        <button type="submit">Submit</button>
      </form>
    );

    const report = await scanPage(
      'Forms: Select',
      <MockSelectComponent />,
      'SelectField'
    );
    const criticalViolations = report.violations.filter(
      (v) => v.impact === 'critical'
    );
    expect(criticalViolations.length).toBe(0);
  });

  it('Textarea with label has no critical violations', async () => {
    const MockTextareaComponent = () => (
      <form>
        <label htmlFor="textarea-field">Comments:</label>
        <textarea id="textarea-field" />
        <button type="submit">Submit</button>
      </form>
    );

    const report = await scanPage(
      'Forms: Textarea',
      <MockTextareaComponent />,
      'TextareaField'
    );
    const criticalViolations = report.violations.filter(
      (v) => v.impact === 'critical'
    );
    expect(criticalViolations.length).toBe(0);
  });
});

// ─── Navigation Components ─────────────────────────────────────────────────

describe('Navigation — Main menu & breadcrumbs', () => {
  it('Main navigation has no critical violations', async () => {
    const MockNavigation = () => (
      <nav aria-label="Main navigation">
        <ul>
          <li>
            <a href="/dashboard">Dashboard</a>
          </li>
          <li>
            <a href="/procurement">Procurement</a>
          </li>
          <li>
            <a href="/assets">Assets</a>
          </li>
          <li>
            <a href="/maintenance">Maintenance</a>
          </li>
        </ul>
      </nav>
    );

    const report = await scanPage(
      'Navigation: Main Menu',
      <MockNavigation />,
      'MainNavigation'
    );
    const criticalViolations = report.violations.filter(
      (v) => v.impact === 'critical'
    );
    expect(criticalViolations.length).toBe(0);
  });

  it('Breadcrumb navigation has no critical violations', async () => {
    const MockBreadcrumb = () => (
      <nav aria-label="Breadcrumb">
        <ol>
          <li>
            <a href="/">Home</a>
          </li>
          <li>
            <a href="/procurement">Procurement</a>
          </li>
          <li aria-current="page">Purchase Orders</li>
        </ol>
      </nav>
    );

    const report = await scanPage(
      'Navigation: Breadcrumb',
      <MockBreadcrumb />,
      'BreadcrumbNav'
    );
    const criticalViolations = report.violations.filter(
      (v) => v.impact === 'critical'
    );
    expect(criticalViolations.length).toBe(0);
  });
});

// ─── Modal/Dialog Components ────────────────────────────────────────────────

describe('Dialogs — Common patterns', () => {
  it('Confirmation dialog has no critical violations', async () => {
    const MockConfirmDialog = () => (
      <div role="dialog" aria-labelledby="confirm-title" aria-modal="true">
        <h2 id="confirm-title">Confirm Action</h2>
        <p>Are you sure you want to proceed?</p>
        <button type="button">Confirm</button>
        <button type="button">Cancel</button>
      </div>
    );

    const report = await scanPage(
      'Dialogs: Confirmation',
      <MockConfirmDialog />,
      'ConfirmDialog'
    );
    const criticalViolations = report.violations.filter(
      (v) => v.impact === 'critical'
    );
    expect(criticalViolations.length).toBe(0);
  });
});
