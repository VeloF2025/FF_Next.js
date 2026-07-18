"""
Document Analyzer - Integrates Claude Sub-Agent for Enhanced Analysis

Purpose: Wrapper that uses Task tool to launch Claude sub-agent for document analysis
Features: Async sub-agent execution, result parsing, error handling

Generated: 2025-11-15
Authority: Phase 5 - Week 2 RAG Engine Enhancement (PAI Integration)
"""

import logging
import json
from typing import Dict, Any, Optional
from pathlib import Path

logger = logging.getLogger(__name__)


def analyze_document_with_claude(
    document_path: str,
    document_text: str,
    document_type: Optional[str] = None,
    task_tool_available: bool = False
) -> Dict[str, Any]:
    """
    Analyze document using Claude Code sub-agent via Task tool.

    This function is designed to be called from the main Claude Code instance
    where the Task tool is available.

    Args:
        document_path: Path to document
        document_text: Full document text
        document_type: Optional type hint (contract, financial, technical, email)
        task_tool_available: Whether Task tool is available in current context

    Returns:
        Enhanced analysis dict or error dict

    Example:
        >>> # Called from main Claude Code instance:
        >>> analysis = analyze_document_with_claude(
        ...     document_path="contracts/velocity_2024.pdf",
        ...     document_text=pdf_text,
        ...     document_type="contract",
        ...     task_tool_available=True
        ... )
        >>>
        >>> # Extract entities for memory graph:
        >>> entities = analysis["analysis"]["entities"]
        >>>
        >>> # Generate enhanced embeddings:
        >>> context = analysis["embeddings_context"]["use_for_embeddings"]
    """
    if not task_tool_available:
        logger.warning("Task tool not available, cannot use Claude sub-agent")
        return {
            "success": False,
            "error": "Task tool not available in current context",
            "message": "This function must be called from Claude Code with Task tool access"
        }

    # Truncate if too long (Claude context limit)
    max_chars = 400000  # ~100K tokens
    if len(document_text) > max_chars:
        logger.warning(f"Document too long ({len(document_text)} chars), truncating to {max_chars}")
        document_text = document_text[:max_chars]

    type_hint = f" (type: {document_type})" if document_type else ""

    # Create prompt for sub-agent
    prompt = f"""Perform deep analysis of this document{type_hint} using the enhanced-document-analysis workflow.

**Document Path:** {document_path}

**Document Text:**
```
{document_text}
```

**Your Task:**
You are a specialized document-analyzer sub-agent. Execute the workflow defined in:
`.claude/skills/knowledge/workflows/enhanced-document-analysis.md`

Extract and return a JSON object with:

1. **Classification**:
   - type (contract, invoice, report, email, specification, etc.)
   - urgency (critical, high, medium, low)
   - sensitivity (confidential, internal, public)
   - action_required (boolean)

2. **Entities**:
   - people: [{{"name": "...", "role": "...", "company": "..."}}]
   - companies: [...]
   - dates: [{{"type": "deadline|milestone", "date": "YYYY-MM-DD", "description": "..."}}]
   - amounts: [{{"value": number, "currency": "...", "type": "budget|payment|..."}}]
   - locations: [...]
   - projects: [...]

3. **Relationships**:
   - [{{"from": "entity1", "to": "entity2", "type": "manages|works_with|depends_on", "context": "..."}}]

4. **Key Information**:
   - executive_summary (2-3 sentences)
   - key_points (list of critical information)
   - action_items: [{{"task": "...", "owner": "...", "deadline": "...", "priority": "..."}}]
   - risks: [{{"description": "...", "severity": "...", "mitigation": "..."}}]

5. **Metadata**:
   - key_topics: ["topic1", "topic2", ...]
   - sentiment: "positive|neutral|negative"
   - complexity: "low|medium|high"
   - related_documents: [...]

6. **Semantic Chunks**:
   - For each logical section, create: {{"chunk_index": N, "text": "...", "semantic_summary": "...", "importance": 0.0-1.0, "topics": [...], "entities_mentioned": [...]}}

7. **Embeddings Context**:
   - use_for_embeddings: "Enhanced semantic understanding for embedding: ..."
   - search_keywords: ["keyword1", "keyword2", ...]
   - semantic_tags: ["tag1", "tag2", ...]

Return ONLY valid JSON in this format:
{{
  "success": true,
  "document_path": "{document_path}",
  "analysis": {{
    "classification": {{}},
    "executive_summary": "...",
    "key_points": [],
    "entities": {{}},
    "relationships": [],
    "action_items": [],
    "risks": [],
    "metadata": {{}}
  }},
  "semantic_chunks": [],
  "embeddings_context": {{}}
}}

**Quality Standards:**
- Extract information PRECISELY as stated (don't infer)
- Identify ALL entities, dates, amounts, relationships
- Make action items SPECIFIC and assignable
- Explain WHY something is important, not just WHAT

If analysis fails, return:
{{
  "success": false,
  "error": "reason",
  "partial_analysis": {{}}
}}
"""

    logger.info(f"Prepared Claude sub-agent prompt for: {document_path}")
    logger.info(f"Document length: {len(document_text)} chars")

    # NOTE: The actual Task tool invocation happens in the calling context
    # This function just prepares the prompt and returns it
    # The parent Claude Code instance will use Task tool to execute this

    return {
        "status": "prompt_ready",
        "prompt": prompt,
        "document_path": document_path,
        "workflow": ".claude/skills/knowledge/workflows/enhanced-document-analysis.md",
        "instruction": "Use Task tool with subagent_type='general-purpose' to execute this analysis"
    }


def parse_claude_analysis(
    raw_response: str,
    document_path: str
) -> Dict[str, Any]:
    """
    Parse Claude sub-agent response into structured analysis.

    Args:
        raw_response: Raw text response from Claude sub-agent
        document_path: Document path for error reporting

    Returns:
        Parsed analysis dict or error dict
    """
    try:
        # Try to extract JSON from response (may have markdown code blocks)
        if "```json" in raw_response:
            # Extract JSON from markdown code block
            start = raw_response.find("```json") + 7
            end = raw_response.find("```", start)
            json_str = raw_response[start:end].strip()
        elif "```" in raw_response:
            # Try generic code block
            start = raw_response.find("```") + 3
            end = raw_response.find("```", start)
            json_str = raw_response[start:end].strip()
        else:
            # Assume entire response is JSON
            json_str = raw_response.strip()

        # Parse JSON
        analysis = json.loads(json_str)

        # Validate structure
        if not isinstance(analysis, dict):
            raise ValueError("Analysis must be a JSON object")

        if not analysis.get("success"):
            logger.warning(f"Analysis failed: {analysis.get('error')}")
            return analysis

        # Validate required fields
        required_fields = ["analysis", "semantic_chunks", "embeddings_context"]
        for field in required_fields:
            if field not in analysis:
                logger.warning(f"Missing field in analysis: {field}")
                analysis[field] = {}

        logger.info(f"Successfully parsed Claude analysis for: {document_path}")
        return analysis

    except json.JSONDecodeError as e:
        logger.error(f"Failed to parse JSON response: {e}")
        return {
            "success": False,
            "error": f"JSON parse error: {e}",
            "raw_response": raw_response[:1000]  # First 1000 chars for debugging
        }
    except Exception as e:
        logger.error(f"Failed to parse Claude response: {e}")
        return {
            "success": False,
            "error": f"Parse error: {e}",
            "raw_response": raw_response[:1000]
        }


# Example usage documentation
USAGE_EXAMPLE = """
# Example: Using Claude-Enhanced Document Analysis

## From Python (with Task tool available):

```python
from lib.rag.document_analyzer import analyze_document_with_claude, parse_claude_analysis

# Step 1: Prepare analysis prompt
prompt_data = analyze_document_with_claude(
    document_path="contracts/velocity_fibre_2024.pdf",
    document_text=pdf_text,
    document_type="contract",
    task_tool_available=True
)

# Step 2: Execute using Task tool (in Claude Code context)
# NOTE: This is pseudocode - actual Task tool invocation happens in Claude Code
# result = task_tool.invoke(
#     description="Analyze contract document",
#     prompt=prompt_data["prompt"],
#     subagent_type="general-purpose"
# )

# Step 3: Parse response
analysis = parse_claude_analysis(
    raw_response=result,
    document_path="contracts/velocity_fibre_2024.pdf"
)

# Step 4: Use analysis
if analysis["success"]:
    entities = analysis["analysis"]["entities"]
    relationships = analysis["analysis"]["relationships"]
    action_items = analysis["analysis"]["action_items"]

    print(f"Found {len(entities['people'])} people")
    print(f"Found {len(relationships)} relationships")
    print(f"Found {len(action_items)} action items")
```

## From CLI:

```bash
# Analyze critical document with Claude enhancement
boss knowledge analyze-enhanced contracts/velocity_2024.pdf --type contract

# Results saved to:
# - Memory graph: entities and relationships indexed
# - Qdrant: enhanced embeddings with semantic context
# - PostgreSQL: action items, risks, metadata stored
```

## Cost Estimation:

- Small document (1-5 pages): ~$0.01-0.02
- Medium document (10-50 pages): ~$0.05-0.10
- Large document (100+ pages): ~$0.20-0.50

Use strategically for high-value documents only!
"""
