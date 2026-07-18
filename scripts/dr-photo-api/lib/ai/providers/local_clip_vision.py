"""
Local CLIP Vision Provider - Offline Vision Analysis

Implements VisionProvider interface using local CLIP model for zero-cost analysis.
Free offline fallback option when API providers unavailable or budget exhausted.

Phase 4.5 Implementation - Local CLIP Vision Integration
"""

import logging
import time
from pathlib import Path
from typing import Dict, Any, List, Optional
from datetime import datetime

try:
    import torch
    from PIL import Image
    from transformers import CLIPProcessor, CLIPModel
    DEPENDENCIES_AVAILABLE = True
except ImportError:
    DEPENDENCIES_AVAILABLE = False

from lib.ai.vision_provider import (
    VisionProvider,
    VisionResult,
    ProviderConfig,
    ProviderStatus,
    ProviderError
)

logger = logging.getLogger(__name__)


class LocalCLIPVisionProvider(VisionProvider):
    """
    Local CLIP Vision provider implementation.

    Uses OpenAI's CLIP model running locally for photo evaluation.

    Cost: $0.00 (FREE - runs locally)
    Latency: ~1-2 seconds (CPU), ~0.3-0.5 seconds (GPU)
    Accuracy: Medium (good for basic quality checks, not detailed analysis)

    Trade-offs:
    - FREE: No API costs
    - FAST: No network latency
    - OFFLINE: Works without internet
    - LIMITED: Cannot extract serial numbers, barcodes, or detailed text
    - BASIC: Good for "yes/no" quality checks, not complex analysis
    """

    def __init__(self, config: ProviderConfig):
        """
        Initialize Local CLIP Vision provider.

        Args:
            config: Provider configuration
        """
        super().__init__(config)

        self.model_name = config.model or "openai/clip-vit-large-patch14"
        self.device = "cuda" if torch.cuda.is_available() else "cpu"
        self.model = None
        self.processor = None

        # Check dependencies
        if not DEPENDENCIES_AVAILABLE:
            logger.error(
                "Local CLIP provider requires: torch, transformers, Pillow. "
                "Install with: pip install torch transformers Pillow"
            )
            self.status = ProviderStatus.DISABLED
            return

        # Load model lazily (on first use)
        self._model_loaded = False

        logger.info(f"Local CLIP provider ready: {self.model_name} on {self.device}")

    def _load_model(self):
        """Load CLIP model and processor (lazy loading)."""
        if self._model_loaded:
            return

        try:
            logger.info(f"Loading CLIP model: {self.model_name}...")

            self.processor = CLIPProcessor.from_pretrained(self.model_name)
            self.model = CLIPModel.from_pretrained(self.model_name)
            self.model.to(self.device)
            self.model.eval()  # Evaluation mode

            self._model_loaded = True
            self.status = ProviderStatus.AVAILABLE

            logger.info(f"CLIP model loaded successfully on {self.device}")

        except Exception as e:
            logger.error(f"Failed to load CLIP model: {e}")
            self.status = ProviderStatus.ERROR
            raise ProviderError(
                f"Model loading failed: {str(e)}",
                provider=self.config.name,
                original_error=e
            )

    async def evaluate_photo(
        self,
        image_path: Path,
        prompt: str,
        step_config: Dict[str, Any]
    ) -> VisionResult:
        """
        Evaluate a photo using local CLIP model.

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
                "Local CLIP provider disabled - dependencies not installed",
                provider=self.config.name
            )

        # Load model on first use
        if not self._model_loaded:
            self._load_model()

        start_time = time.time()

        try:
            # Load image
            image = Image.open(image_path).convert("RGB")

            # Build evaluation queries
            queries = self._build_evaluation_queries(prompt, step_config)

            # Run CLIP evaluation
            with torch.no_grad():
                # Process image and text
                inputs = self.processor(
                    text=queries["texts"],
                    images=image,
                    return_tensors="pt",
                    padding=True
                )
                inputs = {k: v.to(self.device) for k, v in inputs.items()}

                # Get CLIP outputs
                outputs = self.model(**inputs)
                logits_per_image = outputs.logits_per_image
                probs = logits_per_image.softmax(dim=1)

            # Parse results
            evaluation = self._parse_clip_results(
                probs=probs,
                queries=queries,
                step_config=step_config
            )

            # Calculate latency (no API cost)
            latency_ms = int((time.time() - start_time) * 1000)
            cost = 0.0  # FREE

            # Track metrics
            self._track_call(cost, latency_ms, success=True)

            # Build VisionResult
            vision_result = VisionResult(
                success=True,
                confidence=evaluation.get("confidence", 0.5),
                evaluation=evaluation.get("summary", ""),
                is_acceptable=evaluation.get("is_acceptable", False),
                quality_score=evaluation.get("quality_score", 0.0),
                issues=evaluation.get("issues", []),
                matches_step=evaluation.get("matches_step", False),
                step_confidence=evaluation.get("step_confidence", 0.0),
                extracted_data={},  # CLIP cannot extract text data
                provider=self.config.name,
                model=self.model_name,
                cost=cost,
                latency_ms=latency_ms,
                timestamp=datetime.now(),
                raw_response={"probabilities": probs.cpu().tolist()}
            )

            logger.info(
                f"Local CLIP evaluation complete: {image_path.name} - "
                f"acceptable={vision_result.is_acceptable}, "
                f"confidence={vision_result.confidence:.2f}, "
                f"latency={latency_ms}ms"
            )

            return vision_result

        except Exception as e:
            # Evaluation error
            latency_ms = int((time.time() - start_time) * 1000)
            self._track_call(0.0, latency_ms, success=False)

            error_msg = f"Local CLIP evaluation failed: {str(e)}"
            logger.error(error_msg, exc_info=True)

            raise ProviderError(error_msg, provider=self.config.name, original_error=e)

    async def health_check(self) -> ProviderStatus:
        """
        Check Local CLIP provider health and availability.

        Returns:
            ProviderStatus indicating current availability
        """
        if not DEPENDENCIES_AVAILABLE:
            self.status = ProviderStatus.DISABLED
            return self.status

        try:
            # Try to load model if not loaded
            if not self._model_loaded:
                self._load_model()

            self.status = ProviderStatus.AVAILABLE
            logger.debug("Local CLIP health check: OK")

        except Exception as e:
            self.status = ProviderStatus.ERROR
            logger.error(f"Local CLIP health check: ERROR - {e}")

        return self.status

    def _build_evaluation_queries(
        self,
        base_prompt: str,
        step_config: Dict[str, Any]
    ) -> Dict[str, Any]:
        """
        Build CLIP text queries for zero-shot classification.

        CLIP works by comparing image to text descriptions.
        We create multiple text queries and measure similarity.

        Args:
            base_prompt: Base evaluation prompt
            step_config: Step configuration

        Returns:
            Dictionary with query texts and metadata
        """
        step_number = step_config.get("step_number")
        keywords = step_config.get("keywords", [])
        expected_content = step_config.get("expected_content", "")

        # Core quality queries
        quality_queries = [
            "a clear, well-lit, in-focus photo",
            "a blurry, dark, or low-quality photo",
            "a photo with good framing and composition",
            "a photo with poor framing or composition"
        ]

        # Content-specific queries
        content_queries = []

        if expected_content:
            content_queries.extend([
                f"a photo showing {expected_content}",
                f"a photo not showing {expected_content}"
            ])

        if keywords:
            for keyword in keywords[:3]:  # Limit to 3 keywords
                content_queries.extend([
                    f"a photo with visible {keyword}",
                    f"a photo without {keyword}"
                ])

        # Fiber optic installation specific queries
        fiber_queries = [
            "a professional fiber optic installation",
            "an unprofessional or incomplete installation",
            "equipment installed according to standards",
            "equipment installed incorrectly or unsafely"
        ]

        # Combine all queries
        all_queries = quality_queries + content_queries + fiber_queries

        return {
            "texts": all_queries,
            "quality_indices": list(range(len(quality_queries))),
            "content_indices": list(range(
                len(quality_queries),
                len(quality_queries) + len(content_queries)
            )),
            "fiber_indices": list(range(
                len(quality_queries) + len(content_queries),
                len(all_queries)
            ))
        }

    def _parse_clip_results(
        self,
        probs: torch.Tensor,
        queries: Dict[str, Any],
        step_config: Dict[str, Any]
    ) -> Dict[str, Any]:
        """
        Parse CLIP probability results into evaluation.

        Args:
            probs: Probability tensor from CLIP
            queries: Query metadata
            step_config: Step configuration

        Returns:
            Dictionary with parsed evaluation data
        """
        probs_list = probs[0].cpu().tolist()

        # Analyze quality scores
        quality_indices = queries["quality_indices"]
        quality_positive = sum(probs_list[i] for i in quality_indices[::2])  # Even indices = positive
        quality_negative = sum(probs_list[i] for i in quality_indices[1::2])  # Odd indices = negative

        # Analyze content scores
        content_indices = queries["content_indices"]
        if content_indices:
            content_positive = sum(probs_list[i] for i in content_indices[::2])
            content_negative = sum(probs_list[i] for i in content_indices[1::2])
        else:
            content_positive = 0.5
            content_negative = 0.5

        # Analyze fiber installation scores
        fiber_indices = queries["fiber_indices"]
        fiber_positive = sum(probs_list[i] for i in fiber_indices[::2])
        fiber_negative = sum(probs_list[i] for i in fiber_indices[1::2])

        # Calculate overall scores
        quality_score = quality_positive / (quality_positive + quality_negative)
        content_score = content_positive / (content_positive + content_negative) if content_indices else 0.5
        fiber_score = fiber_positive / (fiber_positive + fiber_negative)

        # Overall acceptability
        overall_score = (quality_score * 0.4 + content_score * 0.4 + fiber_score * 0.2)

        # Determine if acceptable
        is_acceptable = overall_score > 0.65  # Threshold for acceptance

        # Calculate confidence (based on probability spread)
        max_prob = max(probs_list)
        confidence = min(max_prob * 1.5, 1.0)  # Scale confidence

        # Identify issues
        issues = []

        if quality_score < 0.6:
            issues.append("Photo quality may be insufficient (blur, lighting, or focus issues)")

        if content_score < 0.6 and content_indices:
            issues.append("Expected content may not be clearly visible")

        if fiber_score < 0.6:
            issues.append("Installation may not meet professional standards")

        # Step matching
        matches_step = is_acceptable and content_score > 0.6
        step_confidence = confidence if matches_step else 0.4

        # Build summary
        summary = self._build_summary(
            overall_score=overall_score,
            quality_score=quality_score,
            content_score=content_score,
            fiber_score=fiber_score,
            is_acceptable=is_acceptable
        )

        return {
            "is_acceptable": is_acceptable,
            "confidence": confidence,
            "quality_score": overall_score,
            "matches_step": matches_step,
            "step_confidence": step_confidence,
            "issues": issues,
            "summary": summary
        }

    def _build_summary(
        self,
        overall_score: float,
        quality_score: float,
        content_score: float,
        fiber_score: float,
        is_acceptable: bool
    ) -> str:
        """
        Build evaluation summary from scores.

        Args:
            overall_score: Overall quality score
            quality_score: Photo quality score
            content_score: Content match score
            fiber_score: Installation quality score
            is_acceptable: Whether photo is acceptable

        Returns:
            Summary text
        """
        status = "ACCEPTABLE" if is_acceptable else "NEEDS REVIEW"

        summary = f"""
Local CLIP Analysis: {status}

Overall Score: {overall_score:.2f}/1.0

Detailed Scores:
- Photo Quality: {quality_score:.2f}/1.0
- Content Match: {content_score:.2f}/1.0
- Installation Quality: {fiber_score:.2f}/1.0

Note: This is a basic automated analysis. For detailed verification (serial numbers,
text extraction, complex compliance checks), please use AI-powered providers
(Gemini, GPT-4V, or Claude).

CLIP Limitations:
- Cannot read text, serial numbers, or barcodes
- Cannot perform detailed technical analysis
- Best for basic "pass/fail" quality screening
"""

        return summary.strip()

    async def batch_evaluate(
        self,
        images: List[Path],
        prompts: List[str],
        step_configs: List[Dict[str, Any]]
    ) -> List[VisionResult]:
        """
        Evaluate multiple photos in batch.

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

        # Process sequentially (CLIP doesn't benefit much from batching)
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
