"""
BOSS Integrations Module

External service integrations for BOSS:
- SharePoint Excel connector
- 1Map GIS API connector (DR photo verification)
"""

from .sharepoint_connector import SharePointExcelConnector
from .onemap_client import OneMapClient, OneMapAuthError, OneMapAPIError

__all__ = [
    'SharePointExcelConnector',
    'OneMapClient',
    'OneMapAuthError',
    'OneMapAPIError'
]
