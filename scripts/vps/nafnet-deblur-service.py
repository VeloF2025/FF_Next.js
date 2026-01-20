#!/usr/bin/env python3
"""
NAFNet Deblur Service

A FastAPI service that runs NAFNet for image deblurring.
Deploy on VPS with GPU support.

Usage:
    pip install torch torchvision fastapi uvicorn pillow basicsr
    python nafnet-deblur-service.py

Or with systemd:
    [Unit]
    Description=NAFNet Deblur Service
    After=network.target

    [Service]
    Type=simple
    User=velo
    WorkingDirectory=/home/velo/scripts/nafnet
    ExecStart=/home/velo/scripts/nafnet/venv/bin/python nafnet-deblur-service.py
    Restart=always
    RestartSec=10

    [Install]
    WantedBy=multi-user.target

Port: 8101
Endpoint: POST /deblur
"""

import base64
import io
import logging
import os
import sys
import time
from typing import Optional

import torch
from PIL import Image
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# Setup logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger('nafnet-deblur')

# Configuration
PORT = int(os.environ.get('NAFNET_PORT', 8101))
MODEL_PATH = os.environ.get('NAFNET_MODEL_PATH', '/home/velo/models/NAFNet-width64.pth')
MAX_IMAGE_SIZE = 1280  # Max dimension

# Global model reference
model = None
device = None

app = FastAPI(
    title="NAFNet Deblur Service",
    description="Image deblurring using NAFNet model",
    version="1.0.0"
)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class DeblurRequest(BaseModel):
    """Request body for deblur endpoint"""
    image: str  # Base64 encoded image


class DeblurResponse(BaseModel):
    """Response body for deblur endpoint"""
    success: bool
    image: Optional[str] = None  # Base64 encoded deblurred image
    processing_time_ms: int = 0
    error: Optional[str] = None


def load_nafnet_model():
    """Load NAFNet model"""
    global model, device

    try:
        # Try to import NAFNet from basicsr
        from basicsr.archs.nafnet_arch import NAFNet

        # Setup device
        device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
        logger.info(f"Using device: {device}")

        if not torch.cuda.is_available():
            logger.warning("CUDA not available, using CPU (will be slow)")

        # Load model
        logger.info(f"Loading NAFNet model from {MODEL_PATH}")

        # NAFNet configuration for deblurring
        model = NAFNet(
            img_channel=3,
            width=64,
            middle_blk_num=12,
            enc_blk_nums=[2, 2, 4, 8],
            dec_blk_nums=[2, 2, 2, 2]
        )

        # Load weights
        if os.path.exists(MODEL_PATH):
            checkpoint = torch.load(MODEL_PATH, map_location=device)
            if 'params' in checkpoint:
                model.load_state_dict(checkpoint['params'])
            else:
                model.load_state_dict(checkpoint)
            logger.info("Model weights loaded successfully")
        else:
            logger.warning(f"Model file not found at {MODEL_PATH}, using random weights")

        model = model.to(device)
        model.eval()

        logger.info("NAFNet model loaded successfully")
        return True

    except ImportError as e:
        logger.error(f"Failed to import NAFNet: {e}")
        logger.error("Please install: pip install basicsr")
        return False
    except Exception as e:
        logger.error(f"Failed to load model: {e}")
        return False


def preprocess_image(image: Image.Image) -> torch.Tensor:
    """Convert PIL image to tensor for NAFNet"""
    import numpy as np

    # Resize if too large
    w, h = image.size
    if max(w, h) > MAX_IMAGE_SIZE:
        ratio = MAX_IMAGE_SIZE / max(w, h)
        new_w, new_h = int(w * ratio), int(h * ratio)
        image = image.resize((new_w, new_h), Image.Resampling.LANCZOS)

    # Convert to RGB
    if image.mode != 'RGB':
        image = image.convert('RGB')

    # Convert to numpy and normalize
    img_np = np.array(image).astype(np.float32) / 255.0

    # HWC to CHW
    img_np = np.transpose(img_np, (2, 0, 1))

    # Add batch dimension
    tensor = torch.from_numpy(img_np).unsqueeze(0)

    return tensor.to(device)


def postprocess_image(tensor: torch.Tensor) -> Image.Image:
    """Convert NAFNet output tensor to PIL image"""
    import numpy as np

    # Remove batch dimension and move to CPU
    output = tensor.squeeze(0).cpu().detach().numpy()

    # CHW to HWC
    output = np.transpose(output, (1, 2, 0))

    # Clip and scale
    output = np.clip(output * 255, 0, 255).astype(np.uint8)

    return Image.fromarray(output)


@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {
        "status": "healthy",
        "model_loaded": model is not None,
        "device": str(device) if device else "not initialized",
        "cuda_available": torch.cuda.is_available()
    }


@app.post("/deblur", response_model=DeblurResponse)
async def deblur(request: DeblurRequest):
    """Deblur an image using NAFNet"""
    start_time = time.time()

    if model is None:
        raise HTTPException(status_code=503, detail="Model not loaded")

    try:
        # Decode base64 image
        try:
            image_data = base64.b64decode(request.image)
            image = Image.open(io.BytesIO(image_data))
        except Exception as e:
            return DeblurResponse(
                success=False,
                error=f"Invalid image data: {str(e)}",
                processing_time_ms=int((time.time() - start_time) * 1000)
            )

        logger.info(f"Processing image: {image.size}")

        # Preprocess
        input_tensor = preprocess_image(image)

        # Run inference
        with torch.no_grad():
            output_tensor = model(input_tensor)

        # Postprocess
        output_image = postprocess_image(output_tensor)

        # Encode to base64
        buffer = io.BytesIO()
        output_image.save(buffer, format='JPEG', quality=90)
        output_base64 = base64.b64encode(buffer.getvalue()).decode('utf-8')

        processing_time_ms = int((time.time() - start_time) * 1000)
        logger.info(f"Deblurred in {processing_time_ms}ms")

        return DeblurResponse(
            success=True,
            image=output_base64,
            processing_time_ms=processing_time_ms
        )

    except Exception as e:
        logger.error(f"Deblur failed: {e}")
        return DeblurResponse(
            success=False,
            error=str(e),
            processing_time_ms=int((time.time() - start_time) * 1000)
        )


@app.on_event("startup")
async def startup_event():
    """Load model on startup"""
    logger.info("Starting NAFNet Deblur Service")
    if not load_nafnet_model():
        logger.error("Failed to load model, service may not work correctly")


if __name__ == "__main__":
    import uvicorn

    logger.info(f"Starting NAFNet Deblur Service on port {PORT}")
    uvicorn.run(app, host="0.0.0.0", port=PORT)
