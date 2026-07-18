"""
Reconciliation Data Validator

Purpose: Validate that Nokia_Exp has activations for the report date before
         running reconciliation. Prevents reports with stale or missing data.

Created: 2025-12-04
"""

import logging
from datetime import date, datetime
from typing import Optional, Dict, Any

import pandas as pd

from lib.reconciliation.models import get_project_config
from lib.integrations.sharepoint_connector import SharePointExcelConnector

logger = logging.getLogger(__name__)


async def validate_data_ready(
    project: str,
    report_date: date,
    sharepoint_connector: Optional[SharePointExcelConnector] = None
) -> Dict[str, Any]:
    """
    Verify Nokia_Exp has activations for report_date.

    This validation prevents reconciliation from running with stale data.
    It checks that the Nokia_Exp sheet in SharePoint contains at least one
    activation record matching the report date.

    Args:
        project: Project name (lawley, mohadin, mamelodi)
        report_date: Date to check for activations
        sharepoint_connector: Optional existing connector (will create if None)

    Returns:
        Dictionary with validation result:
        {
            "valid": bool,
            "activation_count": int,
            "message": str,
            "report_date": date,
            "project": str
        }

    Example:
        >>> result = await validate_data_ready("lawley", date(2025, 12, 3))
        >>> if result["valid"]:
        ...     print(f"Ready: {result['activation_count']} activations found")
        ... else:
        ...     print(f"Not ready: {result['message']}")
    """
    logger.info(f"Validating data readiness for {project} on {report_date}")

    # Get project configuration
    project_config = get_project_config(project)
    if not project_config:
        return {
            "valid": False,
            "activation_count": 0,
            "message": f"Unknown project: {project}",
            "report_date": report_date,
            "project": project
        }

    # Load Nokia_Exp from SharePoint
    should_disconnect = False
    if sharepoint_connector is None:
        sharepoint_connector = SharePointExcelConnector()
        await sharepoint_connector.connect()
        should_disconnect = True

    try:
        # Download Nokia_Exp sheet
        all_sheets = await sharepoint_connector.read_all_sheets_from_sharepoint(
            project_config.sharepoint_url
        )

        if project_config.nokia_exp_sheet not in all_sheets:
            return {
                "valid": False,
                "activation_count": 0,
                "message": f"Sheet '{project_config.nokia_exp_sheet}' not found in tracker",
                "report_date": report_date,
                "project": project
            }

        nokia_df = all_sheets[project_config.nokia_exp_sheet]

        # Find Timestamp column
        timestamp_col = None
        for col_name in ["Timestamp", "Date", "Activation_Date", "timestamp", "date"]:
            if col_name in nokia_df.columns:
                timestamp_col = col_name
                break

        if not timestamp_col:
            return {
                "valid": False,
                "activation_count": 0,
                "message": f"No timestamp column found in Nokia_Exp (columns: {list(nokia_df.columns)})",
                "report_date": report_date,
                "project": project
            }

        # Count activations for report_date
        activations_for_date = []
        for _, row in nokia_df.iterrows():
            timestamp_val = row.get(timestamp_col)
            if pd.notna(timestamp_val):
                try:
                    if isinstance(timestamp_val, datetime):
                        act_date = timestamp_val.date()
                    elif isinstance(timestamp_val, date):
                        act_date = timestamp_val
                    else:
                        # Try parsing as string
                        act_date = pd.to_datetime(timestamp_val).date()

                    if act_date == report_date:
                        activations_for_date.append(row)
                except Exception:
                    # Skip rows with unparseable dates
                    continue

        activation_count = len(activations_for_date)

        if activation_count == 0:
            logger.warning(f"No activations found for {project} on {report_date}")
            return {
                "valid": False,
                "activation_count": 0,
                "message": f"No activations found for {report_date} in Nokia_Exp",
                "report_date": report_date,
                "project": project
            }

        logger.info(f"Found {activation_count} activations for {project} on {report_date}")
        return {
            "valid": True,
            "activation_count": activation_count,
            "message": f"Found {activation_count} activations for {report_date}",
            "report_date": report_date,
            "project": project
        }

    finally:
        if should_disconnect:
            await sharepoint_connector.disconnect()


async def validate_data_ready_quick(
    project: str,
    report_date: date,
    min_activation_count: int = 1
) -> bool:
    """
    Quick validation check (returns bool only).

    Args:
        project: Project name
        report_date: Date to check
        min_activation_count: Minimum activations required (default: 1)

    Returns:
        True if data is ready, False otherwise
    """
    result = await validate_data_ready(project, report_date)
    return result["valid"] and result["activation_count"] >= min_activation_count
