"""
Local LLM Client for BOSS - FREE LLM Operations via LocalAI.

Provides OpenAI-compatible interface to local LLM backends:
- LocalAI (http://localhost:8080)
- Ollama (http://localhost:11434)

Cost Savings:
- LocalAI: 100% FREE (no API costs)
- Ideal for: draft generation, classification, simple analysis
- Target: 90%+ of LLM operations handled locally

Models Available (VPS):
- ibm-granite_granite-4.0-micro: Fast, small model for routine tasks

Generated: 2025-12-02
Authority: BOSS-EXEC Implementation Plan - Local LLM Integration
"""

import os
import logging
from typing import Optional, Dict, Any, List
from dataclasses import dataclass
from enum import Enum
import asyncio

import httpx

logger = logging.getLogger(__name__)


class LocalLLMProvider(Enum):
    """Supported local LLM providers."""
    LOCALAI = "localai"
    OLLAMA = "ollama"


@dataclass
class LocalModelConfig:
    """Configuration for a local model."""
    model_id: str
    provider: LocalLLMProvider
    max_tokens: int = 4096
    temperature: float = 0.7
    description: str = ""


# Available local models on VPS
LOCAL_MODELS = {
    "granite-micro": LocalModelConfig(
        model_id="ibm-granite_granite-4.0-micro",
        provider=LocalLLMProvider.LOCALAI,
        max_tokens=4096,
        temperature=0.7,
        description="IBM Granite 4.0 Micro - Fast, efficient for routine tasks"
    ),
}


class LocalLLMClient:
    """
    Client for local LLM operations via LocalAI/Ollama.

    Provides OpenAI-compatible API for seamless integration.

    Usage:
        client = LocalLLMClient()

        # Check availability
        if await client.is_available():
            response = await client.complete(
                prompt="Draft an email confirming the meeting",
                model="granite-micro"
            )

        # Chat completion (OpenAI format)
        response = await client.chat_complete(
            messages=[
                {"role": "system", "content": "You are a helpful assistant."},
                {"role": "user", "content": "Hello!"}
            ]
        )
    """

    def __init__(
        self,
        localai_url: Optional[str] = None,
        ollama_url: Optional[str] = None,
        timeout: float = 180.0,  # Increased from 60s for longer generation
        default_model: str = "granite-micro"
    ):
        """
        Initialize Local LLM client.

        Args:
            localai_url: LocalAI server URL (default: http://localhost:8080)
            ollama_url: Ollama server URL (default: http://localhost:11434)
            timeout: Request timeout in seconds
            default_model: Default model to use
        """
        self.localai_url = localai_url or os.getenv(
            "LOCALAI_URL", "http://localhost:8080"
        )
        self.ollama_url = ollama_url or os.getenv(
            "OLLAMA_URL", "http://localhost:11434"
        )
        self.timeout = timeout
        self.default_model = default_model

        self._client: Optional[httpx.AsyncClient] = None
        self._available: Optional[bool] = None
        self._available_models: List[str] = []

        logger.info(f"LocalLLMClient initialized (localai={self.localai_url})")

    @property
    def client(self) -> httpx.AsyncClient:
        """Get or create HTTP client."""
        if self._client is None or self._client.is_closed:
            self._client = httpx.AsyncClient(timeout=self.timeout)
        return self._client

    async def close(self):
        """Close HTTP client."""
        if self._client and not self._client.is_closed:
            await self._client.aclose()
            self._client = None

    async def is_available(self, force_check: bool = False) -> bool:
        """
        Check if local LLM is available.

        Args:
            force_check: Force refresh availability status

        Returns:
            True if local LLM is available
        """
        if self._available is not None and not force_check:
            return self._available

        try:
            # Try LocalAI first
            response = await self.client.get(
                f"{self.localai_url}/v1/models",
                timeout=5.0
            )
            if response.status_code == 200:
                data = response.json()
                self._available_models = [
                    m["id"] for m in data.get("data", [])
                ]
                self._available = len(self._available_models) > 0
                logger.info(
                    f"LocalAI available with {len(self._available_models)} models: "
                    f"{self._available_models}"
                )
                return self._available
        except Exception as e:
            logger.debug(f"LocalAI not available: {e}")

        try:
            # Try Ollama fallback
            response = await self.client.get(
                f"{self.ollama_url}/api/tags",
                timeout=5.0
            )
            if response.status_code == 200:
                data = response.json()
                self._available_models = [
                    m["name"] for m in data.get("models", [])
                ]
                self._available = len(self._available_models) > 0
                logger.info(
                    f"Ollama available with {len(self._available_models)} models"
                )
                return self._available
        except Exception as e:
            logger.debug(f"Ollama not available: {e}")

        self._available = False
        return False

    def get_available_models(self) -> List[str]:
        """Get list of available models."""
        return self._available_models

    def _get_model_id(self, model: str) -> str:
        """Get actual model ID from alias."""
        if model in LOCAL_MODELS:
            return LOCAL_MODELS[model].model_id
        return model

    async def complete(
        self,
        prompt: str,
        model: Optional[str] = None,
        max_tokens: int = 2048,
        temperature: float = 0.7,
        stop: Optional[List[str]] = None
    ) -> str:
        """
        Generate text completion.

        Args:
            prompt: Input prompt
            model: Model to use (default: granite-micro)
            max_tokens: Maximum tokens to generate
            temperature: Sampling temperature
            stop: Stop sequences

        Returns:
            Generated text
        """
        model = model or self.default_model
        model_id = self._get_model_id(model)

        payload = {
            "model": model_id,
            "prompt": prompt,
            "max_tokens": max_tokens,
            "temperature": temperature,
        }
        if stop:
            payload["stop"] = stop

        try:
            response = await self.client.post(
                f"{self.localai_url}/v1/completions",
                json=payload
            )
            response.raise_for_status()

            data = response.json()
            text = data["choices"][0]["text"]

            logger.info(
                f"Local completion: model={model_id}, "
                f"prompt_len={len(prompt)}, response_len={len(text)}"
            )

            return text.strip()

        except Exception as e:
            logger.error(f"Local completion failed: {e}")
            raise

    async def chat_complete(
        self,
        messages: List[Dict[str, str]],
        model: Optional[str] = None,
        max_tokens: int = 2048,
        temperature: float = 0.7,
        stop: Optional[List[str]] = None,
        use_completions_fallback: bool = True
    ) -> str:
        """
        Generate chat completion (OpenAI format).

        Args:
            messages: List of message dicts [{"role": ..., "content": ...}]
            model: Model to use
            max_tokens: Maximum tokens to generate
            temperature: Sampling temperature
            stop: Stop sequences
            use_completions_fallback: Fall back to /v1/completions if chat fails

        Returns:
            Assistant response text
        """
        model = model or self.default_model
        model_id = self._get_model_id(model)

        payload = {
            "model": model_id,
            "messages": messages,
            "max_tokens": max_tokens,
            "temperature": temperature,
        }
        if stop:
            payload["stop"] = stop

        try:
            response = await self.client.post(
                f"{self.localai_url}/v1/chat/completions",
                json=payload
            )
            response.raise_for_status()

            data = response.json()
            content = data["choices"][0]["message"]["content"]

            logger.info(
                f"Local chat completion: model={model_id}, "
                f"messages={len(messages)}, response_len={len(content)}"
            )

            return content.strip()

        except Exception as e:
            logger.warning(f"Local chat completion failed: {e}")

            # Fall back to completions endpoint by converting messages to prompt
            if use_completions_fallback:
                logger.info("Falling back to completions endpoint with message conversion")
                prompt = self._messages_to_prompt(messages)
                return await self.complete(
                    prompt=prompt,
                    model=model,
                    max_tokens=max_tokens,
                    temperature=temperature,
                    stop=stop
                )
            raise

    def _messages_to_prompt(self, messages: List[Dict[str, str]]) -> str:
        """
        Convert chat messages to a single prompt for completions endpoint.

        Args:
            messages: List of message dicts

        Returns:
            Formatted prompt string
        """
        parts = []

        for msg in messages:
            role = msg.get("role", "user")
            content = msg.get("content", "")

            if role == "system":
                parts.append(f"Instructions: {content}\n")
            elif role == "user":
                parts.append(f"User: {content}\n")
            elif role == "assistant":
                parts.append(f"Assistant: {content}\n")

        # Add prompt for assistant response
        parts.append("Assistant:")

        return "".join(parts)

    async def draft_email(
        self,
        context: str,
        tone: str = "professional",
        max_tokens: int = 1024
    ) -> str:
        """
        Generate email draft using local LLM.

        Args:
            context: Email context (recipient, subject, key points)
            tone: Desired tone (professional, friendly, formal)
            max_tokens: Maximum tokens

        Returns:
            Email draft text
        """
        system_prompt = f"""You are a professional email assistant.
Write clear, concise emails in a {tone} tone.
Include appropriate greeting and closing.
Keep emails focused and actionable."""

        user_prompt = f"""Draft an email based on this context:

{context}

Write the email now:"""

        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt}
        ]

        return await self.chat_complete(
            messages=messages,
            max_tokens=max_tokens,
            temperature=0.7
        )

    async def classify(
        self,
        text: str,
        categories: List[str],
        max_tokens: int = 50
    ) -> str:
        """
        Classify text into categories.

        Args:
            text: Text to classify
            categories: List of possible categories
            max_tokens: Maximum tokens

        Returns:
            Selected category
        """
        categories_str = ", ".join(categories)
        prompt = f"""Classify this text into ONE of these categories: {categories_str}

Text: {text}

Category (respond with only the category name):"""

        result = await self.complete(
            prompt=prompt,
            max_tokens=max_tokens,
            temperature=0.0  # Deterministic for classification
        )

        # Clean up response
        result = result.strip().strip('"').strip("'")

        # Validate against categories
        for cat in categories:
            if cat.lower() in result.lower():
                return cat

        return result

    async def summarize(
        self,
        text: str,
        max_length: int = 200,
        style: str = "concise"
    ) -> str:
        """
        Summarize text.

        Args:
            text: Text to summarize
            max_length: Approximate max length in words
            style: Summary style (concise, detailed, bullet)

        Returns:
            Summary text
        """
        style_instruction = {
            "concise": "Write a brief, focused summary.",
            "detailed": "Write a comprehensive summary covering key points.",
            "bullet": "Write a bullet-point summary of key points."
        }.get(style, "Write a summary.")

        prompt = f"""{style_instruction}
Keep it under {max_length} words.

Text to summarize:
{text}

Summary:"""

        return await self.complete(
            prompt=prompt,
            max_tokens=max_length * 2,  # Rough token estimate
            temperature=0.3
        )

    def get_stats(self) -> Dict[str, Any]:
        """Get client statistics."""
        return {
            "available": self._available,
            "localai_url": self.localai_url,
            "ollama_url": self.ollama_url,
            "available_models": self._available_models,
            "default_model": self.default_model,
        }


# =============================================================================
# SINGLETON INSTANCE
# =============================================================================

_client_instance: Optional[LocalLLMClient] = None


def get_local_llm_client() -> LocalLLMClient:
    """Get singleton LocalLLMClient instance."""
    global _client_instance

    if _client_instance is None:
        _client_instance = LocalLLMClient()

    return _client_instance


async def is_local_llm_available() -> bool:
    """Quick check if local LLM is available."""
    client = get_local_llm_client()
    return await client.is_available()
