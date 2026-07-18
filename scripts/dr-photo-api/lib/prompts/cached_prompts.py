"""
Cache-Optimized Prompts for BOSS.

These prompts are structured to maximize Anthropic API prompt caching:
- Static content at the START (system instructions, role definition)
- Dynamic content at the END (user query, context)
- No timestamps or variable content in prefix

This structure enables 10x cost reduction on cached portions.

Research Sources:
- Anthropic Context Engineering Guide (2025)
- Manus AI Context Engineering Lessons
- LangChain Context Engineering Best Practices
"""

from typing import Dict, Any, Optional, List


# =============================================================================
# STABLE SYSTEM PROMPTS (NEVER CHANGE - Maximizes cache hits)
# =============================================================================

BOSS_SYSTEM_PROMPT = """You are BOSS (Business Operating System Solution), an intelligent AI assistant.

## Your Role
You are the CEO's digital assistant, managing communications, documents, and knowledge.
You operate with professionalism, accuracy, and cost-awareness.

## Core Capabilities
1. **Communication**: Draft emails, manage WhatsApp, handle approvals
2. **Knowledge**: Query documents via RAG, access memory graph for relationships
3. **Documents**: Process PDFs/images with OCR, organize files
4. **Intelligence**: Financial analysis, market research, reporting

## Quality Standards
- **NLNH Protocol**: No lies, no hallucinations - say "I don't know" when uncertain
- **DGTS Enforcement**: Don't game the system - real implementations only
- **Cost Awareness**: Use free tools first, optimize token usage

## Response Format
Always structure responses clearly:
- Start with the action/answer
- Provide relevant context
- End with next steps if applicable

## Professional Tone
- Concise but complete
- Professional yet approachable
- Factual with citations when available"""


EMAIL_DRAFT_SYSTEM_PROMPT = """You are drafting professional emails on behalf of the user.

## Email Writing Standards
1. **Opening**: Appropriate greeting based on relationship
2. **Body**: Clear, concise, 2-4 paragraphs maximum
3. **Closing**: Professional sign-off, clear next steps
4. **Format**: HTML formatting (<p>, <br>) for email clients

## Tone Guidelines
- **Professional**: Business communications, formal language
- **Casual**: Internal team, friendly but appropriate
- **Formal**: Legal, financial, executive communications

## Critical Rules
- Do NOT include Subject: line (added automatically)
- Do NOT include From: or To: fields (added automatically)
- Start directly with the greeting
- Reference context naturally (don't explicitly list it)
- Match the sender's tone when replying

## Quality Checks
- Check for clarity and completeness
- Ensure action items are specific
- Verify tone matches relationship"""


KNOWLEDGE_QUERY_SYSTEM_PROMPT = """You are answering questions using the BOSS knowledge base.

## Query Processing
1. **Understand**: Parse the user's question for intent and entities
2. **Retrieve**: Use provided context from RAG/memory graph
3. **Answer**: Synthesize a clear, accurate response
4. **Cite**: Reference sources when available

## Response Format
- Lead with the direct answer
- Support with relevant details from context
- Note any limitations or missing information
- Suggest follow-up queries if helpful

## Context Usage Rules
- Prioritize information from provided context
- If context is insufficient, say so clearly
- Never fabricate information not in context
- Cite document sources when quoting

## Quality Standards
- Accuracy over completeness
- Concise over verbose
- Honest about uncertainty"""


# =============================================================================
# MESSAGE BUILDERS (Cache-friendly structure)
# =============================================================================

def build_messages(
    system_prompt: str,
    user_query: str,
    context: Optional[Dict[str, Any]] = None
) -> List[Dict[str, str]]:
    """
    Build messages with cache-optimized structure.

    Structure:
    1. System prompt (CACHED - 10x cheaper)
    2. User message with dynamic content (Variable)

    Args:
        system_prompt: Static system prompt (should not change)
        user_query: User's query/request
        context: Optional context to include

    Returns:
        List of message dicts for API call
    """
    messages = [
        {"role": "system", "content": system_prompt}  # CACHED
    ]

    # Build user message with context
    user_content = _format_user_content(user_query, context)
    messages.append({"role": "user", "content": user_content})

    return messages


def build_email_draft_messages(
    original_email: Dict[str, Any],
    context: Optional[Dict[str, Any]] = None,
    tone: str = "professional",
    user_name: str = "Hein van Vuuren"
) -> List[Dict[str, str]]:
    """
    Build messages for email draft generation.

    Args:
        original_email: Dict with sender, subject, body, received_at
        context: Optional context (sender_info, relevant_docs, etc.)
        tone: Desired tone
        user_name: User's name for signing

    Returns:
        List of message dicts
    """
    # System prompt is STABLE (cached)
    messages = [
        {"role": "system", "content": EMAIL_DRAFT_SYSTEM_PROMPT}
    ]

    # Build dynamic user content
    user_content = f"""Draft a reply email as {user_name}.

**Original Email:**
From: {original_email.get('sender_name', 'Unknown')} <{original_email.get('sender', 'unknown@email.com')}>
Subject: {original_email.get('subject', 'No Subject')}
Date: {original_email.get('received_at', 'Unknown')}

{_truncate_text(original_email.get('body', ''), 1000)}
"""

    # Add context if provided (priority ordered)
    if context:
        user_content += _format_email_context(context)

    # Add instructions
    user_content += f"""

**Instructions:**
- Tone: {tone}
- Sign as: {user_name}
- Format: HTML

Generate the email body:"""

    messages.append({"role": "user", "content": user_content})

    return messages


def build_knowledge_query_messages(
    question: str,
    context: Optional[Dict[str, Any]] = None,
    include_sources: bool = True
) -> List[Dict[str, str]]:
    """
    Build messages for knowledge base queries.

    Args:
        question: User's question
        context: Retrieved context from RAG
        include_sources: Whether to ask for source citations

    Returns:
        List of message dicts
    """
    # System prompt is STABLE (cached)
    messages = [
        {"role": "system", "content": KNOWLEDGE_QUERY_SYSTEM_PROMPT}
    ]

    # Build user content
    user_content = f"**Question:** {question}\n\n"

    if context:
        user_content += "**Retrieved Context:**\n"

        # Add documents
        if "results" in context:
            for i, doc in enumerate(context["results"][:5], 1):
                title = doc.get("title", f"Document {i}")
                text = _truncate_text(doc.get("text", ""), 500)
                score = doc.get("score", 0)
                source = doc.get("source", "Unknown")

                user_content += f"""
[{i}] {title} (relevance: {score:.2f})
Source: {source}
{text}
---
"""

    if include_sources:
        user_content += "\n**Note:** Please cite sources when referencing specific information."

    messages.append({"role": "user", "content": user_content})

    return messages


# =============================================================================
# HELPER FUNCTIONS
# =============================================================================

def _format_user_content(
    query: str,
    context: Optional[Dict[str, Any]] = None
) -> str:
    """Format user content with optional context."""
    content = query

    if context:
        content += "\n\n**Context:**\n"
        for key, value in context.items():
            if value:
                formatted_value = _truncate_text(str(value), 500)
                content += f"- {key}: {formatted_value}\n"

    return content


def _format_email_context(context: Dict[str, Any]) -> str:
    """Format email context in priority order."""
    sections = []

    # Sender info (highest priority)
    if "sender_info" in context and context["sender_info"]:
        sender = context["sender_info"]
        sections.append(f"""
**Sender Context:**
- Name: {sender.get('name', 'Unknown')}
- Role: {sender.get('role', 'Unknown')}
- Company: {sender.get('company', 'Unknown')}
- Relationship: {sender.get('relationship', 'Unknown')}""")

    # Project info
    if "project_info" in context and context["project_info"]:
        project = context["project_info"]
        sections.append(f"""
**Related Project:**
- Name: {project.get('name', 'Unknown')}
- Status: {project.get('status', 'Unknown')}
- Info: {_truncate_text(project.get('description', ''), 200)}""")

    # Relevant documents
    if "relevant_docs" in context and context["relevant_docs"]:
        docs = context["relevant_docs"][:3]  # Max 3 docs
        doc_text = "\n**Relevant Documents:**\n"
        for doc in docs:
            doc_text += f"- {doc.get('title', 'Document')}: {_truncate_text(doc.get('summary', ''), 150)}\n"
        sections.append(doc_text)

    # Email history
    if "email_history" in context and context["email_history"]:
        history = context["email_history"][-3:]  # Last 3
        history_text = "\n**Previous Conversation:**\n"
        for msg in history:
            history_text += f"- {msg.get('date', '')}: {_truncate_text(msg.get('preview', ''), 100)}\n"
        sections.append(history_text)

    return "\n".join(sections)


def _truncate_text(text: str, max_chars: int) -> str:
    """Truncate text to max characters with ellipsis."""
    if not text:
        return ""
    if len(text) <= max_chars:
        return text
    return text[:max_chars] + "..."


# =============================================================================
# PROMPT CACHING UTILITIES
# =============================================================================

def estimate_cache_savings(
    system_tokens: int,
    user_tokens: int,
    cache_hit_rate: float = 0.6
) -> Dict[str, float]:
    """
    Estimate cost savings from prompt caching.

    Args:
        system_tokens: Tokens in system prompt (cacheable)
        user_tokens: Tokens in user message (variable)
        cache_hit_rate: Expected cache hit rate (default 60%)

    Returns:
        Dict with cost estimates
    """
    # Claude pricing per million tokens
    CACHED_INPUT_COST = 0.30  # $0.30/MTok
    UNCACHED_INPUT_COST = 3.00  # $3.00/MTok

    total_tokens = system_tokens + user_tokens

    # Without caching
    cost_without_cache = (total_tokens / 1_000_000) * UNCACHED_INPUT_COST

    # With caching
    cached_portion = system_tokens * cache_hit_rate
    uncached_portion = system_tokens * (1 - cache_hit_rate) + user_tokens

    cost_with_cache = (
        (cached_portion / 1_000_000) * CACHED_INPUT_COST +
        (uncached_portion / 1_000_000) * UNCACHED_INPUT_COST
    )

    savings = cost_without_cache - cost_with_cache
    savings_pct = (savings / cost_without_cache) * 100 if cost_without_cache > 0 else 0

    return {
        "total_tokens": total_tokens,
        "system_tokens": system_tokens,
        "user_tokens": user_tokens,
        "cache_hit_rate": cache_hit_rate,
        "cost_without_cache": round(cost_without_cache, 6),
        "cost_with_cache": round(cost_with_cache, 6),
        "savings": round(savings, 6),
        "savings_pct": round(savings_pct, 1)
    }
