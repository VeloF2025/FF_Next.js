"""
Lawley API Routes - Daily Performance Report Processing

Endpoints:
- POST /api/v1/lawley/process - Process Lawley Performance Excel file
- GET /api/v1/lawley/reports - List generated reports
- GET /api/v1/lawley/reports/{date} - Get specific report

Authority: n8n Integration for Lawley FibreTime Daily Reports
"""

import os
import sys
import base64
import tempfile
from pathlib import Path
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
import pandas as pd

# Add project root to path
project_root = Path(__file__).parent.parent.parent
sys.path.insert(0, str(project_root))


router = APIRouter(prefix="/api/v1/lawley", tags=["lawley"])


class LawleyProcessRequest(BaseModel):
    """Request model for Lawley file processing."""
    file_name: str
    file_content_base64: str
    email_subject: Optional[str] = None
    email_received: Optional[str] = None
    trigger_type: str = "manual"  # scheduled, manual, webhook
    trigger_time: Optional[str] = None


class LawleyProcessResponse(BaseModel):
    """Response model for Lawley processing."""
    status: str
    report_path: Optional[str] = None
    metrics: Optional[dict] = None
    error: Optional[str] = None
    processing_time_ms: int = 0


@router.post("/process", response_model=LawleyProcessResponse)
async def process_lawley_file(request: LawleyProcessRequest):
    """
    Process Lawley Performance Excel file and generate daily report.

    This endpoint:
    1. Decodes the base64 Excel file
    2. Extracts performance metrics (homes, revenue, TRPHC, etc.)
    3. Generates a markdown report
    4. Returns key metrics for notification

    Called by n8n workflow at 7:30 SAST daily.
    """
    import time
    start_time = time.time()

    try:
        # Decode base64 file content
        file_content = base64.b64decode(request.file_content_base64)

        # Save to temp file for processing
        with tempfile.NamedTemporaryFile(
            suffix=".xlsx",
            delete=False,
            prefix="lawley_"
        ) as tmp_file:
            tmp_file.write(file_content)
            tmp_path = Path(tmp_file.name)

        # Also save to docs folder for archival
        docs_dir = project_root / "docs"
        docs_dir.mkdir(exist_ok=True)
        archive_path = docs_dir / request.file_name
        archive_path.write_bytes(file_content)

        # Process the Excel file
        metrics = await _extract_lawley_metrics(tmp_path)

        # Generate report
        report_path = await _generate_lawley_report(
            metrics=metrics,
            file_name=request.file_name,
            email_subject=request.email_subject,
            email_received=request.email_received
        )

        # Cleanup temp file
        tmp_path.unlink(missing_ok=True)

        processing_time = int((time.time() - start_time) * 1000)

        return LawleyProcessResponse(
            status="success",
            report_path=str(report_path),
            metrics=metrics,
            processing_time_ms=processing_time
        )

    except Exception as e:
        processing_time = int((time.time() - start_time) * 1000)
        return LawleyProcessResponse(
            status="error",
            error=str(e),
            processing_time_ms=processing_time
        )


async def _extract_lawley_metrics(file_path: Path) -> dict:
    """
    Extract key metrics from Lawley Performance Excel file.

    Expected sheets:
    - Area Overview: Summary metrics (homes, revenue, TRPHC)
    - Lawley: PON-level detail
    """
    metrics = {}

    try:
        # Read all sheets
        all_sheets = pd.read_excel(file_path, sheet_name=None)

        # Extract from Area Overview
        if 'Area Overview' in all_sheets:
            df = all_sheets['Area Overview']

            if df.shape[1] >= 6:
                # Column layout:
                # 0: Area Name, 1: Metrics, 2: 30-day Avg, 3: 21-day Avg, 4: Latest, 5: Previous
                latest_col_idx = 4
                prev_col_idx = 5

                # Today's metrics
                homes_today = int(df.iloc[0, latest_col_idx]) if df.shape[0] > 0 else 0
                revenue_today = float(df.iloc[1, latest_col_idx]) if df.shape[0] > 1 else 0.0
                true_revenue_today = float(df.iloc[2, latest_col_idx]) if df.shape[0] > 2 else 0.0
                trphc_today = float(df.iloc[3, latest_col_idx]) if df.shape[0] > 3 else 0.0
                active_bundles_today = int(df.iloc[4, latest_col_idx]) if df.shape[0] > 4 else 0

                # Yesterday for comparison
                homes_yesterday = int(df.iloc[0, prev_col_idx]) if df.shape[0] > 0 else 0
                revenue_yesterday = float(df.iloc[1, prev_col_idx]) if df.shape[0] > 1 else 0.0

                metrics['homes_connected'] = homes_today
                metrics['homes_change'] = homes_today - homes_yesterday
                metrics['revenue'] = round(revenue_today, 2)
                metrics['revenue_change'] = round(revenue_today - revenue_yesterday, 2)
                metrics['true_revenue'] = round(true_revenue_today, 2)
                metrics['trphc'] = round(trphc_today, 2)
                metrics['active_bundles'] = active_bundles_today
                metrics['ab_ratio'] = round(active_bundles_today / homes_today * 100, 1) if homes_today > 0 else 0

                # Get date from column header
                metrics['report_date'] = str(df.columns[latest_col_idx])

        # Extract PON-level summary
        if 'Lawley' in all_sheets:
            df = all_sheets['Lawley']
            metrics['total_pons'] = df.shape[0]
            if 'PON Age' in df.columns:
                metrics['avg_pon_age'] = round(df['PON Age'].mean(), 1)
            if '# of Homes' in df.columns:
                metrics['avg_homes_per_pon'] = round(df['# of Homes'].mean(), 1)

        metrics['sheets_processed'] = len(all_sheets)

    except Exception as e:
        metrics['extraction_error'] = str(e)

    return metrics


async def _generate_lawley_report(
    metrics: dict,
    file_name: str,
    email_subject: Optional[str],
    email_received: Optional[str]
) -> Path:
    """Generate markdown daily report from metrics."""

    today = datetime.now().strftime("%Y-%m-%d")
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    report_dir = project_root / "data" / "lawley" / "daily_reports"
    report_dir.mkdir(parents=True, exist_ok=True)
    report_path = report_dir / f"lawley_daily_report_{today}.md"

    # Build report
    report = f"""# LAWLEY DAILY PERFORMANCE REPORT

**Date:** {today}
**Generated:** {timestamp}
**Source:** {file_name}
**Email Subject:** {email_subject or 'N/A'}
**Email Received:** {email_received or 'N/A'}

---

## EXECUTIVE SUMMARY

### Key Metrics (as of {metrics.get('report_date', today)})

**Network Scale:**
- **Homes Connected:** {metrics.get('homes_connected', 0):,} ({metrics.get('homes_change', 0):+,} vs yesterday)
- **Active Bundles:** {metrics.get('active_bundles', 0):,}
- **Active Bundle Ratio:** {metrics.get('ab_ratio', 0):.1f}%

**Revenue Performance:**
- **Daily Revenue:** R {metrics.get('revenue', 0):,.2f} ({metrics.get('revenue_change', 0):+,.2f} vs yesterday)
- **True Revenue:** R {metrics.get('true_revenue', 0):,.2f}
- **TRPHC:** R {metrics.get('trphc', 0):.2f}

**Infrastructure:**
- **Total PONs:** {metrics.get('total_pons', 0)}
- **Avg PON Age:** {metrics.get('avg_pon_age', 0):.1f} days
- **Avg Homes per PON:** {metrics.get('avg_homes_per_pon', 0):.1f}

---

## INSIGHTS

"""

    # Add insights based on metrics
    homes = metrics.get('homes_connected', 0)
    bundles = metrics.get('active_bundles', 0)
    gap = homes - bundles

    if gap > 0:
        lost_revenue = gap * metrics.get('trphc', 0)
        report += f"""### Active Bundle Gap

**{gap:,} homes** connected without active bundles ({gap/homes*100:.1f}%)
**Potential lost revenue:** R {lost_revenue:,.2f}/day

"""

    homes_change = metrics.get('homes_change', 0)
    if homes_change > 0:
        report += f"""### Network Growth

**+{homes_change:,} new homes** connected today
**Projected monthly growth:** +{homes_change * 30:,} homes

"""

    report += f"""---

*Generated by BOSS Lawley Daily Processor*
*n8n Workflow: BOSS - Lawley FibreTime Daily Report*
"""

    # Write report
    report_path.write_text(report, encoding='utf-8')

    return report_path


@router.get("/reports")
async def list_reports():
    """List all generated Lawley reports."""
    report_dir = project_root / "data" / "lawley" / "daily_reports"

    if not report_dir.exists():
        return {"reports": []}

    reports = []
    for f in sorted(report_dir.glob("*.md"), reverse=True):
        reports.append({
            "filename": f.name,
            "date": f.stem.replace("lawley_daily_report_", ""),
            "size_bytes": f.stat().st_size,
            "modified": datetime.fromtimestamp(f.stat().st_mtime).isoformat()
        })

    return {"reports": reports[:30]}  # Last 30 reports


@router.get("/reports/{date}")
async def get_report(date: str):
    """Get a specific Lawley report by date (YYYY-MM-DD format)."""
    report_dir = project_root / "data" / "lawley" / "daily_reports"
    report_path = report_dir / f"lawley_daily_report_{date}.md"

    if not report_path.exists():
        raise HTTPException(status_code=404, detail=f"Report not found for {date}")

    return {
        "date": date,
        "content": report_path.read_text(encoding='utf-8'),
        "filename": report_path.name
    }
