"""
Memory Graph Module for BOSS

Provides knowledge graph functionality for entities and relationships.
"""

from .memory_graph_service import MemoryGraphService, get_memory_graph_service

__all__ = [
    "MemoryGraphService",
    "get_memory_graph_service"
]
