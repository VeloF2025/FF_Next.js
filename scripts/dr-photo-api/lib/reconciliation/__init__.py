"""
Reconciliation Module for BOSS

Provides daily reconciliation between WhatsApp Monitor submissions
and OES (Nokia) activations to identify gaps for follow-up.

Features:
- Data comparison between WhatsApp Monitor and OES activations
- Excel report generation with multi-sheet analysis
- PDF report generation with charts and AI commentary
- Historical trend analysis
- Email notifications with attachments
"""

from lib.reconciliation.models import (
    WASubmission,
    OESActivation,
    ReconciliationReport,
    ReconciliationSummary,
    ProjectConfig,
    VELOCITY_PROJECTS,
    get_project_config,
    list_projects
)
from lib.reconciliation.reconciler import ReconciliationEngine
from lib.reconciliation.excel_generator import ReconciliationExcelGenerator
from lib.reconciliation.pdf_generator import ReconciliationPDFGenerator

__all__ = [
    # Models
    "WASubmission",
    "OESActivation",
    "ReconciliationReport",
    "ReconciliationSummary",
    "ProjectConfig",
    "VELOCITY_PROJECTS",
    "get_project_config",
    "list_projects",
    # Engines
    "ReconciliationEngine",
    # Generators
    "ReconciliationExcelGenerator",
    "ReconciliationPDFGenerator"
]
