"""
Lawley API Routes - Daily Performance Report Processing

Endpoints:
- POST /lawley/process - Process Lawley Performance Excel file
- GET /lawley/reports - List generated reports
- GET /lawley/reports/{date} - Get specific report

Authority: n8n Integration for Lawley FibreTime Daily Reports
"""

import os
import sys
import base64
import tempfile
import logging
from pathlib import Path
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, HTTPException, Request, Depends
from pydantic import BaseModel

from api.safe_paths import safe_join

# Add project root to path
project_root = Path(__file__).parent.parent.parent.parent
sys.path.insert(0, str(project_root))

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/lawley", tags=["lawley"])


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
    report_content: Optional[str] = None  # Markdown content for email
    report_html: Optional[str] = None     # HTML version for email body
    metrics: Optional[dict] = None
    error: Optional[str] = None
    processing_time_ms: int = 0


@router.post("/process", response_model=LawleyProcessResponse)
async def process_lawley_file(request: LawleyProcessRequest):
    """
    Process Lawley Performance Excel file and generate comprehensive daily report.

    This endpoint:
    1. Decodes the base64 Excel file and saves to docs folder
    2. Extracts detailed performance metrics (homes, revenue, TRPHC, trends)
    3. Generates comprehensive insights (bundle gap, growth, capacity)
    4. Returns key metrics for Telegram notification

    Called by n8n workflow at 7:30 SAST daily.

    NOTE: SharePoint tracker integration is disabled for VPS deployment
    to avoid MS Graph credential dependencies. Enable via ENABLE_SHAREPOINT=true.
    """
    import time
    start_time = time.time()

    # `file_name` is a JSON body field, so FastAPI's path-param routing never
    # constrains it -- it can contain "/" and ".." literally. Contain it before
    # any filesystem work, and above the try: the broad `except Exception`
    # below would otherwise turn the 400 into a 500.
    docs_dir = project_root / "docs"
    archive_path = safe_join(docs_dir, request.file_name)

    try:
        # Decode base64 file content
        file_content = base64.b64decode(request.file_content_base64)

        # Save to docs folder for processing
        docs_dir.mkdir(exist_ok=True)
        archive_path.write_bytes(file_content)
        logger.info(f"Saved performance file to: {archive_path}")

        # Check if SharePoint integration is enabled (default: disabled for VPS)
        enable_sharepoint = os.environ.get("ENABLE_SHAREPOINT", "false").lower() == "true"

        # Skip SharePoint tracker on VPS (no MS Graph credentials)
        sharepoint_result = {'changed': False, 'sheets_processed': 0}

        if enable_sharepoint:
            try:
                from scripts.daily_lawley_processor import LawleyDailyProcessor
                processor = LawleyDailyProcessor()
                sharepoint_result = await processor.process_sharepoint_tracker()
            except Exception as sp_err:
                logger.warning(f"SharePoint tracker skipped: {sp_err}")

        # Process the performance file directly (lightweight extraction)
        performance_result = await _extract_lawley_metrics_direct(archive_path)

        # Generate comprehensive report
        report_path = await _generate_lawley_report_direct(
            metrics=performance_result.get('metrics', {}),
            file_name=request.file_name,
            email_subject=request.email_subject,
            email_received=request.email_received,
            sharepoint_result=sharepoint_result
        )

        # Extract key metrics for Telegram notification
        metrics = {}
        if performance_result.get('found') and 'metrics' in performance_result:
            pm = performance_result['metrics']
            if 'area_overview' in pm:
                ao = pm['area_overview']
                metrics = {
                    'report_date': ao.get('date', 'N/A'),
                    'homes_connected': ao.get('homes_connected', 0),
                    'homes_change': ao.get('homes_connected', 0) - ao.get('homes_yesterday', 0),
                    'revenue': round(ao.get('revenue', 0), 2),
                    'revenue_change': round(ao.get('revenue', 0) - ao.get('revenue_yesterday', 0), 2),
                    'true_revenue': round(ao.get('true_revenue', 0), 2),
                    'trphc': round(ao.get('trphc', 0), 2),
                    'active_bundles': ao.get('active_bundles', 0),
                    'ab_ratio': round(ao.get('ab_hc_ratio', 0) * 100, 1) if ao.get('ab_hc_ratio', 0) < 1 else round(ao.get('ab_hc_ratio', 0), 1),
                    # Additional insights
                    'bundle_gap': ao.get('homes_connected', 0) - ao.get('active_bundles', 0),
                    'avg_trphc': round(ao.get('avg_trphc', 0), 2),
                    'trphc_trend': 'IMPROVING' if ao.get('trphc', 0) > ao.get('avg_trphc', 0) else 'DECLINING'
                }
            if 'pon_level' in pm:
                pon = pm['pon_level']
                metrics['total_pons'] = pon.get('total_pons', 0)
                metrics['avg_pon_age'] = pon.get('avg_pon_age', 0)
                metrics['avg_homes_per_pon'] = pon.get('avg_homes_per_pon', 0)

        # Add SharePoint status
        metrics['sharepoint_changed'] = sharepoint_result.get('changed', False)
        metrics['sharepoint_sheets'] = sharepoint_result.get('sheets_processed', 0)

        # Read report content for email
        report_content = ""
        report_html = ""
        try:
            report_file = Path(report_path)
            if report_file.exists():
                report_content = report_file.read_text(encoding='utf-8')
                # Convert markdown to HTML for email
                import markdown
                report_html = markdown.markdown(
                    report_content,
                    extensions=['tables', 'fenced_code']
                )
                # Wrap in basic HTML template
                report_html = f"""<!DOCTYPE html>
<html>
<head>
    <style>
        body {{ font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; }}
        h1 {{ color: #2c3e50; border-bottom: 2px solid #3498db; padding-bottom: 10px; }}
        h2 {{ color: #34495e; margin-top: 30px; }}
        h3 {{ color: #7f8c8d; }}
        strong {{ color: #2c3e50; }}
        hr {{ border: none; border-top: 1px solid #bdc3c7; margin: 20px 0; }}
        ul {{ line-height: 1.8; }}
        .warning {{ background-color: #fff3cd; padding: 10px; border-radius: 5px; }}
        .positive {{ background-color: #d4edda; padding: 10px; border-radius: 5px; }}
        .critical {{ background-color: #f8d7da; padding: 10px; border-radius: 5px; }}
    </style>
</head>
<body>
{report_html}
</body>
</html>"""
        except Exception as e:
            logger.warning(f"Failed to read/convert report: {e}")

        processing_time = int((time.time() - start_time) * 1000)

        logger.info(f"Lawley full processing complete: {processing_time}ms")

        return LawleyProcessResponse(
            status="success",
            report_path=str(report_path),
            report_content=report_content,
            report_html=report_html,
            metrics=metrics,
            processing_time_ms=processing_time
        )

    except Exception as e:
        logger.error(f"Lawley processing error: {e}", exc_info=True)
        processing_time = int((time.time() - start_time) * 1000)
        return LawleyProcessResponse(
            status="error",
            error=str(e),
            processing_time_ms=processing_time
        )


async def _extract_lawley_metrics_direct(file_path: Path) -> dict:
    """
    Extract key metrics from Lawley Performance Excel file directly.
    Lightweight version that doesn't depend on LawleyDailyProcessor.

    Expected sheets:
    - Area Overview: Summary metrics (homes, revenue, TRPHC)
    - Lawley: PON-level detail

    Returns dict with 'found', 'metrics', 'file_name', etc.
    """
    import pandas as pd

    result = {
        'found': False,
        'file_name': file_path.name if file_path else 'unknown',
        'sheets_processed': 0,
        'metrics': {}
    }

    try:
        # Read all sheets
        all_sheets = pd.read_excel(file_path, sheet_name=None)
        result['sheets_processed'] = len(all_sheets)
        result['found'] = True

        # Extract from Area Overview
        if 'Area Overview' in all_sheets:
            df = all_sheets['Area Overview']

            if df.shape[1] >= 6:
                latest_col = df.columns[4]
                prev_col = df.columns[5]

                # Today's metrics
                homes_today = int(df.iloc[0, 4]) if df.shape[0] > 0 else 0
                revenue_today = float(df.iloc[1, 4]) if df.shape[0] > 1 else 0.0
                true_revenue_today = float(df.iloc[2, 4]) if df.shape[0] > 2 else 0.0
                trphc_today = float(df.iloc[3, 4]) if df.shape[0] > 3 else 0.0
                active_bundles_today = int(df.iloc[4, 4]) if df.shape[0] > 4 else 0
                ab_hc_ratio_today = float(df.iloc[5, 4]) if df.shape[0] > 5 else 0.0

                # Yesterday's metrics
                homes_yesterday = int(df.iloc[0, 5]) if df.shape[0] > 0 else 0
                revenue_yesterday = float(df.iloc[1, 5]) if df.shape[0] > 1 else 0.0
                trphc_yesterday = float(df.iloc[3, 5]) if df.shape[0] > 3 else 0.0

                # 30-day average TRPHC (column 2)
                avg_trphc = float(df.iloc[3, 2]) if df.shape[0] > 3 else 0.0

                result['metrics']['area_overview'] = {
                    'date': str(latest_col),
                    'prev_date': str(prev_col),
                    'homes_connected': homes_today,
                    'homes_yesterday': homes_yesterday,
                    'revenue': revenue_today,
                    'revenue_yesterday': revenue_yesterday,
                    'true_revenue': true_revenue_today,
                    'trphc': trphc_today,
                    'trphc_yesterday': trphc_yesterday,
                    'active_bundles': active_bundles_today,
                    'ab_hc_ratio': ab_hc_ratio_today,
                    'avg_trphc': avg_trphc
                }

        # Extract PON-level summary
        if 'Lawley' in all_sheets:
            df = all_sheets['Lawley']
            result['metrics']['pon_level'] = {
                'total_pons': df.shape[0],
                'avg_pon_age': round(df['PON Age'].mean(), 1) if 'PON Age' in df.columns else 0,
                'avg_homes_per_pon': round(df['# of Homes'].mean(), 1) if '# of Homes' in df.columns else 0
            }

        logger.info(f"Extracted metrics from {file_path.name}: {result['sheets_processed']} sheets")

    except Exception as e:
        logger.error(f"Metrics extraction failed: {e}")
        result['error'] = str(e)

    return result


async def _generate_lawley_report_direct(
    metrics: dict,
    file_name: str,
    email_subject: Optional[str],
    email_received: Optional[str],
    sharepoint_result: Optional[dict] = None
) -> Path:
    """
    Generate markdown daily report directly.
    Lightweight version that doesn't depend on LawleyDailyProcessor.
    """
    today = datetime.now().strftime("%Y-%m-%d")
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    report_dir = project_root / "data" / "lawley" / "daily_reports"
    report_dir.mkdir(parents=True, exist_ok=True)
    report_path = report_dir / f"lawley_daily_report_{today}.md"

    # Get area overview metrics
    ao = metrics.get('area_overview', {})
    pon = metrics.get('pon_level', {})

    # Calculate changes
    homes_today = ao.get('homes_connected', 0)
    homes_yesterday = ao.get('homes_yesterday', 0)
    homes_change = homes_today - homes_yesterday

    revenue_today = ao.get('revenue', 0)
    revenue_yesterday = ao.get('revenue_yesterday', 0)
    revenue_change = revenue_today - revenue_yesterday

    bundles_today = ao.get('active_bundles', 0)
    trphc_today = ao.get('trphc', 0)
    avg_trphc = ao.get('avg_trphc', 0)

    # Build report
    report = f"""# LAWLEY DAILY PERFORMANCE REPORT

**Date:** {today}
**Generated:** {timestamp}
**Source:** {file_name}
**Email Subject:** {email_subject or 'N/A'}
**Email Received:** {email_received or 'N/A'}

---

## EXECUTIVE SUMMARY

### Key Metrics (as of {ao.get('date', today)})

**Network Scale:**
- **Homes Connected:** {homes_today:,} ({homes_change:+,} vs yesterday)
- **Active Bundles:** {bundles_today:,}
- **Active Bundle Ratio:** {ao.get('ab_hc_ratio', 0):.0%}

**Revenue Performance:**
- **Daily Revenue:** R {revenue_today:,.2f} ({revenue_change:+,.2f} vs yesterday)
- **True Revenue:** R {ao.get('true_revenue', 0):,.2f}
- **TRPHC:** R {trphc_today:.2f}

**Trends:**
- **Homes Growth:** {homes_change:+,} new homes connected today
- **TRPHC Trend:** {'IMPROVING' if trphc_today > avg_trphc else 'DECLINING'} (today: R {trphc_today:.2f} vs 30-day avg: R {avg_trphc:.2f})

### Network Infrastructure

**PON Deployment:**
- **Total PONs:** {pon.get('total_pons', 0)} active
- **Average PON Age:** {pon.get('avg_pon_age', 0):.1f} days
- **Homes per PON:** {pon.get('avg_homes_per_pon', 0):.1f} average

---

## INSIGHTS & RECOMMENDATIONS

"""

    # Add insights
    gap = homes_today - bundles_today
    gap_pct = (gap / homes_today * 100) if homes_today > 0 else 0

    if gap_pct > 30:
        lost_revenue = gap * trphc_today
        report += f"""### CRITICAL: Active Bundle Gap

**Issue:** {gap:,} homes ({gap_pct:.1f}%) connected but no active bundle
**Impact:** ~R {lost_revenue:,.2f}/day lost revenue opportunity
**Recommendation:** Urgent CRM audit and customer activation campaign

"""

    if trphc_today > avg_trphc:
        report += f"""### POSITIVE: Revenue Quality Improving

**Trend:** TRPHC increased from R {avg_trphc:.2f} (30-day avg) to R {trphc_today:.2f}
**Recommendation:** Continue current pricing and upsell strategies

"""

    if homes_change > 0:
        report += f"""### POSITIVE: Network Growth

**Trend:** +{homes_change:,} homes connected today vs yesterday
**Projection:** At this rate, +{homes_change * 30:,} homes in next 30 days

"""

    # Add SharePoint status if provided
    sp_changed = sharepoint_result.get('changed', False) if sharepoint_result else False
    report += f"""
---

## DATA SOURCES

**Performance File:**
- File: `{file_name}`
- Sheets processed: {len(metrics)} sections

**SharePoint Tracker:**
- Changed: {'Yes' if sp_changed else 'No (disabled for VPS)'}

---

*Generated by BOSS Lawley Daily Processor*
*n8n Workflow: BOSS - Lawley FibreTime Daily Report*
"""

    # Write report
    report_path.write_text(report, encoding='utf-8')
    logger.info(f"Generated report: {report_path}")

    return report_path


async def _extract_lawley_metrics(file_path: Path) -> dict:
    """
    Extract key metrics from Lawley Performance Excel file.

    Expected sheets:
    - Area Overview: Summary metrics (homes, revenue, TRPHC)
    - Lawley: PON-level detail
    """
    import pandas as pd

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

    if gap > 0 and homes > 0:
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
    logger.info(f"Generated report: {report_path}")

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
    report_path = safe_join(report_dir, f"lawley_daily_report_{date}.md")

    if not report_path.exists():
        raise HTTPException(status_code=404, detail=f"Report not found for {date}")

    return {
        "date": date,
        "content": report_path.read_text(encoding='utf-8'),
        "filename": report_path.name
    }
