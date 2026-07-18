"""
Reconciliation Models

Pydantic models for WhatsApp Monitor submissions, OES activations,
and reconciliation reports.
"""

from pydantic import BaseModel, Field
from datetime import date, datetime
from typing import List, Optional, Dict, Any
from enum import Enum


class ProjectConfig(BaseModel):
    """Configuration for a project's reconciliation."""
    name: str
    display_name: str
    olt_prefix: str  # e.g., "law.olt" for Lawley
    sharepoint_url: str
    checkpoint_file: str
    nokia_exp_sheet: str = "Nokia_Exp"

    class Config:
        use_enum_values = True


class WASubmission(BaseModel):
    """WhatsApp Monitor submission record from qa_photo_reviews table."""
    dr_number: str
    project: str
    submission_date: date
    verification_steps: int = 0  # Number of verification steps completed (0-12)
    contractor: Optional[str] = None
    status: Optional[str] = None
    created_at: Optional[datetime] = None

    # Additional fields from qa_photo_reviews
    qa_verified: bool = False
    photo_count: int = 0
    notes: Optional[str] = None


class OESActivation(BaseModel):
    """OES (Nokia_Exp) activation record from SharePoint tracker."""
    dr_number: str
    project: str
    olt: str  # OLT identifier (e.g., law.olt001)
    activation_date: Optional[date] = None
    status: str = "Active"

    # Additional fields from Nokia_Exp
    customer_name: Optional[str] = None
    service_type: Optional[str] = None
    ont_serial: Optional[str] = None


class ReconciliationSummary(BaseModel):
    """Summary statistics for a reconciliation report."""
    report_date: date
    project: str
    project_display_name: str

    # Counts
    wa_submission_count: int = 0
    oes_activation_count: int = 0
    matched_count: int = 0
    wa_only_count: int = 0  # In WA but not OES (drops done, not activated)
    oes_only_count: int = 0  # In OES but not WA (activated without QA photo)

    # Percentages
    match_rate: float = 0.0  # % of WA submissions that are activated
    activation_coverage: float = 0.0  # % of OES activations with WA verification

    # Data source info
    wa_data_source: str = "FibreFlow qa_photo_reviews"
    oes_data_source: str = "SharePoint Nokia_Exp"
    generated_at: datetime = Field(default_factory=datetime.now)


class ReconciliationReport(BaseModel):
    """Complete reconciliation report with all data."""
    summary: ReconciliationSummary

    # Full data lists
    wa_submissions: List[WASubmission] = []
    oes_activations: List[OESActivation] = []

    # Gap analysis
    matched_dr_numbers: List[str] = []  # DR numbers in both WA and OES
    wa_only_records: List[WASubmission] = []  # Drops done, not activated
    oes_only_records: List[OESActivation] = []  # Activated without QA verification

    def calculate_summary(self):
        """Calculate summary statistics from the data."""
        self.summary.wa_submission_count = len(self.wa_submissions)
        self.summary.oes_activation_count = len(self.oes_activations)
        self.summary.matched_count = len(self.matched_dr_numbers)
        self.summary.wa_only_count = len(self.wa_only_records)
        self.summary.oes_only_count = len(self.oes_only_records)

        # Calculate match rate (% of WA submissions that are activated)
        if self.summary.wa_submission_count > 0:
            self.summary.match_rate = (
                self.summary.matched_count / self.summary.wa_submission_count * 100
            )

        # Calculate activation coverage (% of OES with WA verification)
        if self.summary.oes_activation_count > 0:
            self.summary.activation_coverage = (
                self.summary.matched_count / self.summary.oes_activation_count * 100
            )


# Project configurations for Velocity Fibre projects
VELOCITY_PROJECTS: Dict[str, ProjectConfig] = {
    "lawley": ProjectConfig(
        name="lawley",
        display_name="Lawley",
        olt_prefix="law.olt",
        sharepoint_url="https://blitzfibre.sharepoint.com/:x:/s/Velocity_Manco/IQCFLsIHWSd_S428g84i_rUhAfEYaQXyHkEl8RHAZc0pLek?e=cuTxoQ",
        checkpoint_file="data/checkpoint_lawley.json",
        nokia_exp_sheet="Nokia_Exp"
    ),
    "mohadin": ProjectConfig(
        name="mohadin",
        display_name="Mohadin",
        olt_prefix="moa.olt",
        sharepoint_url="https://blitzfibre.sharepoint.com/:x:/s/Velocity_Manco/IQCJu4NMOmNXRYBgf5uGJQcYAXlSaaA1wGI3byvmX4B6Dqg?e=w1Tsjq",
        checkpoint_file="data/checkpoint_mohadin.json",
        nokia_exp_sheet="Nokia_Exp"
    ),
    "mamelodi": ProjectConfig(
        name="mamelodi",
        display_name="Mamelodi",
        olt_prefix="mam.olt",
        sharepoint_url="https://blitzfibre.sharepoint.com/:x:/s/Velocity_Manco/IQB-uqnF4AX6TLnQVCvB5tdqAReqASnUVDMUWBeHWaFiAzE?e=HgBVo9",
        checkpoint_file="data/checkpoint_mamelodi.json",
        nokia_exp_sheet="Nokia_Exp"
    )
}


def get_project_config(project_name: str) -> Optional[ProjectConfig]:
    """Get project configuration by name (case-insensitive)."""
    return VELOCITY_PROJECTS.get(project_name.lower())


def list_projects() -> List[str]:
    """List all available project names."""
    return list(VELOCITY_PROJECTS.keys())
