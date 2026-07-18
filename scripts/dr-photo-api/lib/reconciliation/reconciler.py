"""
Reconciliation Engine

Core logic for comparing WhatsApp Monitor submissions against OES activations.
Loads data from FibreFlow database and SharePoint Excel (or VPS PostgreSQL).

Data Source Options:
- WhatsApp Monitor: FibreFlow Neon PostgreSQL (qa_photo_reviews table)
- OES Activations:
  - Primary: VPS PostgreSQL (oes_activations table) - if RECONCILIATION_USE_DB=true
  - Fallback: SharePoint Excel (Nokia_Exp sheet) - if DB unavailable or disabled

Updated: 2025-12-02 - Added database-backed OES loading for faster reconciliation
"""

import os
import logging
from datetime import date, datetime
from typing import List, Optional, Dict, Any, Set
import pandas as pd

from lib.reconciliation.models import (
    WASubmission,
    OESActivation,
    ReconciliationReport,
    ReconciliationSummary,
    ProjectConfig,
    get_project_config,
    VELOCITY_PROJECTS
)
from lib.external_db.connector import ExternalDBConnector
from lib.integrations.sharepoint_connector import SharePointExcelConnector

logger = logging.getLogger(__name__)


# Check if database-backed OES loading is enabled
# This allows switching between database (fast) and SharePoint (legacy) sources
USE_DATABASE_FOR_OES = os.getenv("RECONCILIATION_USE_DB", "true").lower() == "true"


class ReconciliationEngine:
    """
    Engine for reconciling WhatsApp Monitor submissions against OES activations.

    Data Sources:
    - WhatsApp Monitor: FibreFlow Neon PostgreSQL (qa_photo_reviews table)
    - OES Activations: SharePoint Excel (Nokia_Exp sheet)
    """

    def __init__(self, project_name: str):
        """
        Initialize reconciliation engine for a project.

        Args:
            project_name: Project name (lawley, mohadin, mamelodi)
        """
        self.project_name = project_name.lower()
        self.config = get_project_config(self.project_name)

        if not self.config:
            raise ValueError(
                f"Unknown project: {project_name}. "
                f"Available: {list(VELOCITY_PROJECTS.keys())}"
            )

        logger.info(f"ReconciliationEngine initialized for {self.config.display_name}")

    async def run_reconciliation(
        self,
        report_date: Optional[date] = None
    ) -> ReconciliationReport:
        """
        Run full reconciliation for the project.

        Args:
            report_date: Date for the report (default: today)

        Returns:
            ReconciliationReport with all data and gap analysis
        """
        if report_date is None:
            report_date = date.today()

        logger.info(f"Running reconciliation for {self.config.display_name} on {report_date}")

        # Initialize report
        report = ReconciliationReport(
            summary=ReconciliationSummary(
                report_date=report_date,
                project=self.project_name,
                project_display_name=self.config.display_name
            )
        )

        # Load data from both sources (filtered by date)
        wa_submissions = await self._load_wa_submissions(report_date)
        oes_activations = await self._load_oes_activations(report_date)

        report.wa_submissions = wa_submissions
        report.oes_activations = oes_activations

        # Perform reconciliation
        self._reconcile(report)

        # Calculate summary statistics
        report.calculate_summary()

        logger.info(
            f"Reconciliation complete: {report.summary.matched_count} matched, "
            f"{report.summary.wa_only_count} WA-only, "
            f"{report.summary.oes_only_count} OES-only"
        )

        return report

    async def _load_wa_submissions(self, report_date: date) -> List[WASubmission]:
        """
        Load WhatsApp Monitor submissions from FibreFlow database for a specific date.

        Queries qa_photo_reviews table for submissions matching the project name
        AND the report date (using review_date or created_at::date).
        """
        logger.info(
            f"Loading WA submissions from FibreFlow for {self.config.display_name} "
            f"on {report_date}"
        )

        submissions = []

        try:
            with ExternalDBConnector("fibreflow") as connector:
                # Query for submissions matching the project name AND date
                # Use COALESCE to prefer review_date, fall back to created_at::date
                query = """
                    SELECT
                        id,
                        drop_number,
                        created_at,
                        review_date,
                        user_name,
                        assigned_agent,
                        completed,
                        comment,
                        step_01_house_photo,
                        step_02_cable_from_pole,
                        step_03_cable_entry_outside,
                        step_04_cable_entry_inside,
                        step_05_wall_for_installation,
                        step_06_ont_back_after_install,
                        step_07_power_meter_reading,
                        step_08_ont_barcode,
                        step_09_ups_serial,
                        step_10_final_installation,
                        step_11_green_lights,
                        step_12_customer_signature
                    FROM qa_photo_reviews
                    WHERE project = %s
                      AND COALESCE(review_date, created_at::date) = %s
                    ORDER BY created_at DESC
                """

                result = connector.execute_query(
                    query, (self.config.display_name, report_date), max_rows=10000
                )

                if not result.success:
                    logger.error(f"Query failed: {result.error}")
                    return submissions

                for row in result.rows:
                    # Parse created_at to get submission date
                    created_at = row.get("created_at")
                    if isinstance(created_at, str):
                        created_at = datetime.fromisoformat(created_at.replace("Z", "+00:00"))

                    # Use review_date if available, else created_at date
                    submission_date = row.get("review_date")
                    if not submission_date and created_at:
                        submission_date = created_at.date()
                    elif not submission_date:
                        submission_date = report_date

                    # Count verification steps by checking each step column
                    verification_steps = self._count_verification_steps_from_row(row)

                    submission = WASubmission(
                        dr_number=row["drop_number"],
                        project=self.project_name,
                        submission_date=submission_date,
                        verification_steps=verification_steps,
                        contractor=row.get("assigned_agent") or row.get("user_name"),
                        status="complete" if row.get("completed") else "pending",
                        created_at=created_at,
                        qa_verified=verification_steps >= 12,
                        photo_count=verification_steps,  # Each step = 1 photo verified
                        notes=row.get("comment")
                    )
                    submissions.append(submission)

                logger.info(f"Loaded {len(submissions)} WA submissions from FibreFlow")

        except Exception as e:
            logger.error(f"Failed to load WA submissions: {e}")
            import traceback
            traceback.print_exc()

        return submissions

    def _count_verification_steps_from_row(self, row: Dict[str, Any]) -> int:
        """Count completed verification steps from step_* columns."""
        step_columns = [
            "step_01_house_photo",
            "step_02_cable_from_pole",
            "step_03_cable_entry_outside",
            "step_04_cable_entry_inside",
            "step_05_wall_for_installation",
            "step_06_ont_back_after_install",
            "step_07_power_meter_reading",
            "step_08_ont_barcode",
            "step_09_ups_serial",
            "step_10_final_installation",
            "step_11_green_lights",
            "step_12_customer_signature",
        ]
        return sum(1 for col in step_columns if row.get(col) is True)

    def _count_verification_steps(self, verification_status: Optional[str]) -> int:
        """
        Count completed verification steps from status string.

        The verification_status field contains info about which of the
        12 verification steps have been completed.
        """
        if not verification_status:
            return 0

        # Assume status contains comma-separated completed steps or a count
        # This may need adjustment based on actual data format
        try:
            # If it's a number, return it
            return int(verification_status)
        except (ValueError, TypeError):
            pass

        # If it contains step indicators, count them
        if isinstance(verification_status, str):
            # Count commas + 1 for comma-separated list
            if "," in verification_status:
                return len(verification_status.split(","))
            # Check for "complete" or similar
            if "complete" in verification_status.lower():
                return 12

        return 0

    async def _load_oes_activations(self, report_date: date) -> List[OESActivation]:
        """
        Load OES activations for a specific date.

        Strategy:
        1. If RECONCILIATION_USE_DB=true (default): Try VPS PostgreSQL first
        2. If database unavailable or returns no data: Fall back to SharePoint
        3. If RECONCILIATION_USE_DB=false: Use SharePoint directly

        This allows faster reconciliation (~10s vs ~60s) when database is synced.
        """
        # Try database first if enabled
        if USE_DATABASE_FOR_OES:
            try:
                activations = await self._load_oes_from_database(report_date)
                if activations:
                    logger.info(
                        f"Loaded {len(activations)} OES activations from database "
                        f"for {self.config.display_name} on {report_date}"
                    )
                    return activations
                else:
                    logger.warning(
                        f"No OES activations in database for {self.config.display_name} "
                        f"on {report_date}, falling back to SharePoint"
                    )
            except Exception as e:
                logger.warning(f"Database OES load failed, falling back to SharePoint: {e}")

        # Fall back to SharePoint
        return await self._load_oes_from_sharepoint(report_date)

    async def _load_oes_from_database(self, report_date: date) -> List[OESActivation]:
        """
        Load OES activations from VPS PostgreSQL database.

        Queries the oes_activations table populated by the SharePoint sync service.
        This is much faster than downloading from SharePoint (~10s vs ~60s).
        """
        logger.info(
            f"Loading OES activations from database for {self.config.display_name} "
            f"on {report_date}"
        )

        activations = []
        database_url = os.getenv("DATABASE_URL") or os.getenv("VPS_DATABASE_URL")

        if not database_url:
            logger.warning("DATABASE_URL not configured, cannot load from database")
            return activations

        try:
            import asyncpg

            conn = await asyncpg.connect(database_url)
            try:
                query = """
                    SELECT
                        dr_number,
                        project,
                        olt,
                        activation_date,
                        customer_name,
                        service_type,
                        ont_serial,
                        status
                    FROM oes_activations
                    WHERE project = $1 AND activation_date = $2
                    ORDER BY dr_number
                """

                rows = await conn.fetch(query, self.project_name, report_date)

                for row in rows:
                    activation = OESActivation(
                        dr_number=row["dr_number"],
                        project=row["project"],
                        olt=row["olt"],
                        activation_date=row["activation_date"],
                        status=row["status"] or "Active"
                    )
                    activations.append(activation)

                logger.info(f"Loaded {len(activations)} OES activations from database")

            finally:
                await conn.close()

        except ImportError:
            logger.warning("asyncpg not installed, cannot load from database")
        except Exception as e:
            logger.error(f"Failed to load OES from database: {e}")
            import traceback
            traceback.print_exc()

        return activations

    async def _load_oes_from_sharepoint(self, report_date: date) -> List[OESActivation]:
        """
        Load OES activations from SharePoint Nokia_Exp sheet for a specific date.

        Uses the SharePoint connector to download and parse the Excel file,
        filtering by the Timestamp column for the report date.

        This is the legacy/fallback method - slower but always available.
        """
        logger.info(
            f"Loading OES activations from SharePoint for {self.config.display_name} "
            f"on {report_date}"
        )

        activations = []

        try:
            connector = SharePointExcelConnector()
            await connector.connect()

            try:
                # Download all sheets
                all_sheets = await connector.read_all_sheets_from_sharepoint(
                    self.config.sharepoint_url
                )

                # Get Nokia_Exp sheet
                nokia_exp_sheet = self.config.nokia_exp_sheet
                if nokia_exp_sheet not in all_sheets:
                    logger.warning(f"Sheet '{nokia_exp_sheet}' not found in tracker")
                    logger.info(f"Available sheets: {list(all_sheets.keys())}")
                    return activations

                df = all_sheets[nokia_exp_sheet]

                # Log the columns for debugging
                logger.info(f"Nokia_Exp columns: {list(df.columns)[:10]}")
                logger.info(f"Nokia_Exp rows before filtering: {len(df)}")

                # Find the DR number column (various possible names)
                dr_col = self._find_column(df, ["Drop Number", "DR_Number", "DR", "DR Number", "DrNumber", "Drop"])
                olt_col = self._find_column(df, ["OLT Address", "OLT", "OLT_ID", "Olt"])
                status_col = self._find_column(df, ["Status", "status", "STATUS"])
                date_col = self._find_column(df, ["Timestamp", "Date", "Activation_Date", "ActivationDate", "Activated Time"])

                if not dr_col:
                    logger.warning("Could not find DR number column in Nokia_Exp")
                    logger.info(f"Available columns: {list(df.columns)}")
                    return activations

                # Filter by OLT prefix for this project
                olt_prefix = self.config.olt_prefix

                for _, row in df.iterrows():
                    olt_value = str(row.get(olt_col, "")) if olt_col else ""

                    # Skip if OLT doesn't match project prefix
                    if not olt_value.lower().startswith(olt_prefix.lower()):
                        continue

                    dr_number = str(row.get(dr_col, "")).strip()
                    if not dr_number or dr_number == "nan":
                        continue

                    # Parse activation date
                    activation_date = None
                    if date_col:
                        date_val = row.get(date_col)
                        if pd.notna(date_val):
                            try:
                                if isinstance(date_val, datetime):
                                    activation_date = date_val.date()
                                elif isinstance(date_val, date):
                                    activation_date = date_val
                                elif isinstance(date_val, str):
                                    # Try multiple date formats
                                    for fmt in ["%Y-%m-%d", "%d/%m/%Y", "%m/%d/%Y", "%Y-%m-%d %H:%M:%S"]:
                                        try:
                                            activation_date = datetime.strptime(
                                                date_val.split()[0] if " " in date_val else date_val,
                                                fmt.split()[0]
                                            ).date()
                                            break
                                        except ValueError:
                                            continue
                            except (ValueError, TypeError):
                                pass

                    # Filter by report date - skip if activation date doesn't match
                    if activation_date != report_date:
                        continue

                    activation = OESActivation(
                        dr_number=dr_number,
                        project=self.project_name,
                        olt=olt_value,
                        activation_date=activation_date,
                        status=str(row.get(status_col, "Active")) if status_col else "Active"
                    )
                    activations.append(activation)

                logger.info(f"Loaded {len(activations)} OES activations from SharePoint")

            finally:
                await connector.disconnect()

        except Exception as e:
            logger.error(f"Failed to load OES activations from SharePoint: {e}")
            import traceback
            traceback.print_exc()

        return activations

    def _find_column(self, df: pd.DataFrame, candidates: List[str]) -> Optional[str]:
        """Find a column by trying multiple candidate names."""
        for col in candidates:
            if col in df.columns:
                return col
            # Try case-insensitive match
            for actual_col in df.columns:
                if str(actual_col).lower() == col.lower():
                    return actual_col
        return None

    def _reconcile(self, report: ReconciliationReport) -> None:
        """
        Perform the actual reconciliation between WA submissions and OES activations.

        Populates:
        - matched_dr_numbers: DR numbers in both sources
        - wa_only_records: Submissions without corresponding activation
        - oes_only_records: Activations without corresponding submission
        """
        # Extract DR numbers from both sources
        wa_dr_numbers: Set[str] = {
            self._normalize_dr(sub.dr_number)
            for sub in report.wa_submissions
        }
        oes_dr_numbers: Set[str] = {
            self._normalize_dr(act.dr_number)
            for act in report.oes_activations
        }

        # Find matches and gaps
        matched = wa_dr_numbers & oes_dr_numbers
        wa_only = wa_dr_numbers - oes_dr_numbers
        oes_only = oes_dr_numbers - wa_dr_numbers

        report.matched_dr_numbers = sorted(matched)

        # Find WA-only records (drops done but not activated)
        report.wa_only_records = [
            sub for sub in report.wa_submissions
            if self._normalize_dr(sub.dr_number) in wa_only
        ]

        # Find OES-only records (activated without QA photo)
        report.oes_only_records = [
            act for act in report.oes_activations
            if self._normalize_dr(act.dr_number) in oes_only
        ]

        logger.info(
            f"Reconciliation: {len(matched)} matched, "
            f"{len(wa_only)} WA-only, {len(oes_only)} OES-only"
        )

    def _normalize_dr(self, dr_number: str) -> str:
        """
        Normalize DR number for comparison.

        Handles variations in formatting (case, whitespace, prefixes).
        """
        if not dr_number:
            return ""

        # Convert to uppercase, strip whitespace
        normalized = str(dr_number).upper().strip()

        # Remove common prefixes for comparison
        # (the actual record retains the original)

        return normalized


async def run_project_reconciliation(
    project_name: str,
    report_date: Optional[date] = None
) -> ReconciliationReport:
    """
    Convenience function to run reconciliation for a project.

    Args:
        project_name: Project name (lawley, mohadin, mamelodi)
        report_date: Date for the report (default: today)

    Returns:
        ReconciliationReport
    """
    engine = ReconciliationEngine(project_name)
    return await engine.run_reconciliation(report_date)


async def run_all_projects_reconciliation(
    report_date: Optional[date] = None
) -> Dict[str, ReconciliationReport]:
    """
    Run reconciliation for all projects.

    Args:
        report_date: Date for the report (default: today)

    Returns:
        Dict mapping project name to ReconciliationReport
    """
    results = {}

    for project_name in VELOCITY_PROJECTS.keys():
        try:
            report = await run_project_reconciliation(project_name, report_date)
            results[project_name] = report
        except Exception as e:
            logger.error(f"Failed to reconcile {project_name}: {e}")

    return results
