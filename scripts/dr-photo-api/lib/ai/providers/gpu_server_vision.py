"""
GPU Server Vision Provider - Self-Hosted VLM Integration

Implements VisionProvider interface for self-hosted vision language models.
Supports vLLM, Ollama, and custom OpenAI-compatible endpoints.

Phase 4.8 Implementation - VPS Self-Hosted Vision Models
"""

import logging
import time
import base64
from pathlib import Path
from typing import Dict, Any, List, Optional
from datetime import datetime

try:
    import httpx
    HTTPX_AVAILABLE = True
except ImportError:
    HTTPX_AVAILABLE = False

from lib.ai.vision_provider import (
    VisionProvider,
    VisionResult,
    ProviderConfig,
    ProviderStatus,
    ProviderError
)

logger = logging.getLogger(__name__)


class GPUServerVisionProvider(VisionProvider):
    """
    GPU Server Vision provider implementation.

    Supports self-hosted vision language models via OpenAI-compatible APIs.

    Cost: $0.00 (FREE - self-hosted on VPS)
    Latency: ~1-3 seconds (GPU), ~8-15 seconds (CPU)
    Accuracy: 0.75-0.85 (model-dependent)

    Supported Models:
    - SmolVLM-Instruct (2B) - Recommended for VPS (4-8GB VRAM)
    - LLaVA-NeXT (7B/13B) - Better accuracy, needs 16GB+ VRAM
    - Gemma 3 Vision (4B) - Balanced option (8GB VRAM)
    - Custom models via OpenAI-compatible endpoint

    Supported Backends:
    - Ollama (easiest deployment)
    - vLLM (best performance)
    - Custom OpenAI-compatible servers
    """

    def __init__(self, config: ProviderConfig):
        """
        Initialize GPU Server Vision provider.

        Args:
            config: Provider configuration
        """
        super().__init__(config)

        if not HTTPX_AVAILABLE:
            logger.error(
                "GPU server provider requires: httpx. "
                "Install with: pip install httpx"
            )
            self.status = ProviderStatus.DISABLED
            return

        # Endpoint configuration
        self.endpoint = config.endpoint or "http://localhost:8000"
        self.model_name = config.model or "SmolVLM-Instruct"

        # API format detection (Ollama vs OpenAI-compatible)
        self.api_format = self._detect_api_format()

        logger.info(
            f"GPU Server provider ready: {self.model_name} "
            f"at {self.endpoint} ({self.api_format} format)"
        )

    def _detect_api_format(self) -> str:
        """
        Detect API format (Ollama or OpenAI-compatible).

        Returns:
            "ollama" or "openai"
        """
        if "ollama" in self.endpoint.lower():
            return "ollama"
        elif self.model_name.lower().startswith("ollama/"):
            return "ollama"
        else:
            return "openai"  # Default to OpenAI-compatible

    async def evaluate_photo(
        self,
        image_path: Path,
        prompt: str,
        step_config: Dict[str, Any]
    ) -> VisionResult:
        """
        Evaluate a photo using self-hosted vision model.

        Args:
            image_path: Path to image file
            prompt: Evaluation prompt/instructions
            step_config: Configuration for verification step

        Returns:
            VisionResult with evaluation details

        Raises:
            ProviderError: If model loading or evaluation fails
        """
        if self.status == ProviderStatus.DISABLED:
            raise ProviderError(
                "GPU server provider disabled - httpx not installed",
                provider=self.config.name
            )

        start_time = time.time()

        try:
            # Read and encode image
            with open(image_path, "rb") as f:
                image_data = base64.b64encode(f.read()).decode("utf-8")

            # Build enhanced prompt
            enhanced_prompt = self._build_prompt(prompt, step_config)

            # Call appropriate API format
            if self.api_format == "ollama":
                response_text = await self._call_ollama_api(
                    image_data,
                    enhanced_prompt
                )
            else:
                response_text = await self._call_openai_api(
                    image_data,
                    enhanced_prompt
                )

            # Parse response
            evaluation = self._parse_response(
                response_text,
                step_config
            )

            # Calculate latency (no API cost - FREE!)
            latency_ms = int((time.time() - start_time) * 1000)
            cost = 0.0  # FREE (self-hosted)

            # Track metrics
            self._track_call(cost, latency_ms, success=True)

            # Build VisionResult
            vision_result = VisionResult(
                success=True,
                confidence=evaluation.get("confidence", 0.75),
                evaluation=evaluation.get("summary", ""),
                is_acceptable=evaluation.get("is_acceptable", False),
                quality_score=evaluation.get("quality_score", 0.0),
                issues=evaluation.get("issues", []),
                matches_step=evaluation.get("matches_step", False),
                step_confidence=evaluation.get("step_confidence", 0.0),
                extracted_data=evaluation.get("extracted_data", {}),
                provider=self.config.name,
                model=self.model_name,
                cost=cost,
                latency_ms=latency_ms,
                timestamp=datetime.now(),
                raw_response={"text": response_text}
            )

            logger.info(
                f"GPU server evaluation complete: {image_path.name} - "
                f"acceptable={vision_result.is_acceptable}, "
                f"confidence={vision_result.confidence:.2f}, "
                f"latency={latency_ms}ms (FREE)"
            )

            return vision_result

        except Exception as e:
            # Evaluation error
            latency_ms = int((time.time() - start_time) * 1000)
            self._track_call(0.0, latency_ms, success=False)

            error_msg = f"GPU server evaluation failed: {str(e)}"
            logger.error(error_msg, exc_info=True)

            raise ProviderError(error_msg, provider=self.config.name, original_error=e)

    async def _call_ollama_api(
        self,
        image_data: str,
        prompt: str
    ) -> str:
        """
        Call Ollama API endpoint.

        Args:
            image_data: Base64-encoded image
            prompt: Text prompt

        Returns:
            Response text from model
        """
        url = f"{self.endpoint}/api/generate"

        payload = {
            "model": self.model_name,
            "prompt": prompt,
            "images": [image_data],
            "stream": False,
            "options": {
                "temperature": 0.2,
                "num_predict": 2048
            }
        }

        async with httpx.AsyncClient(timeout=60.0) as client:
            response = await client.post(url, json=payload)
            response.raise_for_status()

            result = response.json()
            return result.get("response", "")

    async def _call_openai_api(
        self,
        image_data: str,
        prompt: str
    ) -> str:
        """
        Call OpenAI-compatible API endpoint (vLLM, etc.).

        Args:
            image_data: Base64-encoded image
            prompt: Text prompt

        Returns:
            Response text from model
        """
        url = f"{self.endpoint}/v1/chat/completions"

        payload = {
            "model": self.model_name,
            "messages": [
                {
                    "role": "system",
                    "content": "You are an expert quality assurance inspector for fiber optic installations."
                },
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "image_url",
                            "image_url": {
                                "url": f"data:image/jpeg;base64,{image_data}"
                            }
                        },
                        {
                            "type": "text",
                            "text": prompt
                        }
                    ]
                }
            ],
            "temperature": 0.2,
            "max_tokens": 2048
        }

        async with httpx.AsyncClient(timeout=60.0) as client:
            response = await client.post(url, json=payload)
            response.raise_for_status()

            result = response.json()
            return result["choices"][0]["message"]["content"]

    async def health_check(self) -> ProviderStatus:
        """
        Check GPU server health and availability.

        Returns:
            ProviderStatus indicating current availability
        """
        if not HTTPX_AVAILABLE:
            self.status = ProviderStatus.DISABLED
            return self.status

        try:
            # Try to ping endpoint
            if self.api_format == "ollama":
                url = f"{self.endpoint}/api/tags"
            else:
                url = f"{self.endpoint}/v1/models"

            async with httpx.AsyncClient(timeout=10.0) as client:
                response = await client.get(url)
                response.raise_for_status()

            self.status = ProviderStatus.AVAILABLE
            logger.debug(f"GPU server health check: OK ({self.endpoint})")

        except httpx.TimeoutException:
            self.status = ProviderStatus.UNAVAILABLE
            logger.warning(f"GPU server health check: TIMEOUT ({self.endpoint})")

        except httpx.HTTPStatusError as e:
            if e.response.status_code == 429:
                self.status = ProviderStatus.RATE_LIMITED
            else:
                self.status = ProviderStatus.ERROR
            logger.error(f"GPU server health check: ERROR - {e}")

        except Exception as e:
            self.status = ProviderStatus.ERROR
            logger.error(f"GPU server health check: ERROR - {e}")

        return self.status

    def _build_prompt(
        self,
        base_prompt: str,
        step_config: Dict[str, Any]
    ) -> str:
        """
        Build enhanced prompt for GPU server model.

        Args:
            base_prompt: Base evaluation instructions
            step_config: Step configuration

        Returns:
            Enhanced prompt string
        """
        step_number = step_config.get("step_number", 0)
        keywords = step_config.get("keywords", [])
        expected_content = step_config.get("expected_content", "")

        # Build structured prompt
        enhanced_prompt = f"""
{base_prompt}

**Verification Step**: {step_number}
**Expected Content**: {expected_content}
**Keywords to Check**: {', '.join(keywords) if keywords else 'None'}

**Response Format (JSON)**:
```json
{{
    "is_acceptable": true/false,
    "confidence": 0.0-1.0,
    "quality_score": 0.0-1.0,
    "issues": ["list", "of", "issues"],
    "matches_step": true/false,
    "summary": "Brief evaluation summary",
    "extracted_data": {{
        "serial_numbers": [],
        "barcodes": [],
        "measurements": []
    }}
}}
```

Provide your evaluation in the JSON format above.
"""

        return enhanced_prompt.strip()

    def _parse_response(
        self,
        response_text: str,
        step_config: Dict[str, Any]
    ) -> Dict[str, Any]:
        """
        Parse GPU server model response.

        Args:
            response_text: Raw response from model
            step_config: Step configuration

        Returns:
            Dictionary with parsed evaluation data
        """
        import json
        import re

        # Try to extract JSON from response
        try:
            # Look for JSON block
            json_match = re.search(r'```json\s*(\{.*?\})\s*```', response_text, re.DOTALL)
            if json_match:
                parsed = json.loads(json_match.group(1))
            else:
                # Try to parse entire response as JSON
                parsed = json.loads(response_text)

            # Validate required fields
            return {
                "is_acceptable": parsed.get("is_acceptable", False),
                "confidence": float(parsed.get("confidence", 0.7)),
                "quality_score": float(parsed.get("quality_score", 0.0)),
                "issues": parsed.get("issues", []),
                "matches_step": parsed.get("matches_step", False),
                "step_confidence": float(parsed.get("confidence", 0.7)),
                "summary": parsed.get("summary", response_text[:200]),
                "extracted_data": parsed.get("extracted_data", {})
            }

        except (json.JSONDecodeError, ValueError) as e:
            logger.warning(f"Failed to parse JSON response: {e}. Using fallback parsing.")

            # Fallback: Basic text analysis
            response_lower = response_text.lower()

            is_acceptable = any(word in response_lower for word in [
                "acceptable", "good", "pass", "correct", "compliant"
            ])

            issues = []
            if "blur" in response_lower or "focus" in response_lower:
                issues.append("Photo may be blurry or out of focus")
            if "dark" in response_lower or "lighting" in response_lower:
                issues.append("Lighting may be insufficient")
            if "missing" in response_lower:
                issues.append("Expected content may be missing")

            return {
                "is_acceptable": is_acceptable,
                "confidence": 0.6,  # Lower confidence for fallback parsing
                "quality_score": 0.7 if is_acceptable else 0.4,
                "issues": issues,
                "matches_step": is_acceptable,
                "step_confidence": 0.6,
                "summary": response_text[:300],
                "extracted_data": {}
            }

    async def batch_evaluate(
        self,
        images: List[Path],
        prompts: List[str],
        step_configs: List[Dict[str, Any]]
    ) -> List[VisionResult]:
        """
        Evaluate multiple photos in batch.

        GPU server may not support true batching, so we process sequentially.

        Args:
            images: List of image paths
            prompts: List of prompts (one per image)
            step_configs: List of step configurations

        Returns:
            List of VisionResult objects

        Raises:
            ProviderError: If batch processing fails
        """
        if len(images) != len(prompts) or len(images) != len(step_configs):
            raise ProviderError(
                "Mismatched lengths: images, prompts, and step_configs must have same length",
                provider=self.config.name
            )

        # Process sequentially (most self-hosted servers don't support true batching)
        results = []
        for image_path, prompt, step_config in zip(images, prompts, step_configs):
            try:
                result = await self.evaluate_photo(image_path, prompt, step_config)
                results.append(result)
            except Exception as e:
                logger.error(f"Batch evaluation failed for {image_path.name}: {e}")
                # Create error result
                error_result = VisionResult(
                    success=False,
                    confidence=0.0,
                    evaluation=f"Error: {str(e)}",
                    is_acceptable=False,
                    quality_score=0.0,
                    issues=[f"Provider error: {str(e)}"],
                    matches_step=False,
                    step_confidence=0.0,
                    extracted_data={},
                    provider=self.config.name,
                    model=self.model_name,
                    cost=0.0,
                    latency_ms=0,
                    timestamp=datetime.now(),
                    raw_response={"error": str(e)}
                )
                results.append(error_result)

        return results
