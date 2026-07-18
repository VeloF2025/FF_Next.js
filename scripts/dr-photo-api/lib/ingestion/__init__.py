# BOSS Ingestion Module
# Coordinator and worker infrastructure for Docker-based ingestion

# Lazy imports to avoid dependency issues between modules
# The coordinator requires FastAPI, but document_worker doesn't need it

def get_coordinator_app():
    """Lazily import coordinator app (requires FastAPI)"""
    from .coordinator import app
    return app

def get_document_worker():
    """Lazily import document worker module"""
    from . import document_worker
    return document_worker

__all__ = ["get_coordinator_app", "get_document_worker"]
