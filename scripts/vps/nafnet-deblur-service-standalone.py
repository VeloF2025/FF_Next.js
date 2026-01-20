#!/usr/bin/env python3
"""
NAFNet Deblur Service (Standalone)

A FastAPI service that runs NAFNet for image deblurring.
This version includes the NAFNet architecture directly, no basicsr dependency.

Usage:
    pip install torch torchvision fastapi uvicorn pillow
    python nafnet-deblur-service-standalone.py

Port: 8101
Endpoint: POST /deblur
"""

import base64
import io
import logging
import os
import time
from typing import Optional

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F
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


# =============================================================================
# NAFNet Architecture (Embedded)
# =============================================================================

class LayerNormFunction(torch.autograd.Function):
    """Custom LayerNorm for 2D feature maps"""

    @staticmethod
    def forward(ctx, x, weight, bias, eps):
        ctx.eps = eps
        N, C, H, W = x.size()
        mu = x.mean(1, keepdim=True)
        var = (x - mu).pow(2).mean(1, keepdim=True)
        y = (x - mu) / (var + eps).sqrt()
        ctx.save_for_backward(y, var, weight)
        y = weight.view(1, C, 1, 1) * y + bias.view(1, C, 1, 1)
        return y

    @staticmethod
    def backward(ctx, grad_output):
        eps = ctx.eps
        N, C, H, W = grad_output.size()
        y, var, weight = ctx.saved_tensors
        g = grad_output * weight.view(1, C, 1, 1)
        mean_g = g.mean(dim=1, keepdim=True)
        mean_gy = (g * y).mean(dim=1, keepdim=True)
        gx = 1. / torch.sqrt(var + eps) * (g - y * mean_gy - mean_g)
        return gx, (grad_output * y).sum(dim=3).sum(dim=2).sum(dim=0), \
               grad_output.sum(dim=3).sum(dim=2).sum(dim=0), None


class LayerNorm2d(nn.Module):
    """LayerNorm for 2D feature maps"""

    def __init__(self, channels, eps=1e-6):
        super().__init__()
        self.weight = nn.Parameter(torch.ones(channels))
        self.bias = nn.Parameter(torch.zeros(channels))
        self.eps = eps

    def forward(self, x):
        return LayerNormFunction.apply(x, self.weight, self.bias, self.eps)


class SimpleGate(nn.Module):
    """Simple gating mechanism - splits channels and multiplies"""

    def forward(self, x):
        x1, x2 = x.chunk(2, dim=1)
        return x1 * x2


class NAFBlock(nn.Module):
    """NAFNet Block - main building block"""

    def __init__(self, c, DW_Expand=2, FFN_Expand=2, drop_out_rate=0.):
        super().__init__()
        dw_channel = c * DW_Expand

        self.conv1 = nn.Conv2d(c, dw_channel, 1, 1, 0)
        self.conv2 = nn.Conv2d(dw_channel, dw_channel, 3, 1, 1, groups=dw_channel)
        self.conv3 = nn.Conv2d(dw_channel // 2, c, 1, 1, 0)

        # Simplified Channel Attention
        self.sca = nn.Sequential(
            nn.AdaptiveAvgPool2d(1),
            nn.Conv2d(dw_channel // 2, dw_channel // 2, 1, 1, 0),
        )

        self.sg = SimpleGate()

        ffn_channel = FFN_Expand * c
        self.conv4 = nn.Conv2d(c, ffn_channel, 1, 1, 0)
        self.conv5 = nn.Conv2d(ffn_channel // 2, c, 1, 1, 0)

        self.norm1 = LayerNorm2d(c)
        self.norm2 = LayerNorm2d(c)

        self.dropout1 = nn.Dropout(drop_out_rate) if drop_out_rate > 0. else nn.Identity()
        self.dropout2 = nn.Dropout(drop_out_rate) if drop_out_rate > 0. else nn.Identity()

        self.beta = nn.Parameter(torch.zeros((1, c, 1, 1)), requires_grad=True)
        self.gamma = nn.Parameter(torch.zeros((1, c, 1, 1)), requires_grad=True)

    def forward(self, inp):
        x = inp
        x = self.norm1(x)
        x = self.conv1(x)
        x = self.conv2(x)
        x = self.sg(x)
        x = x * self.sca(x)
        x = self.conv3(x)
        x = self.dropout1(x)
        y = inp + x * self.beta

        x = self.conv4(self.norm2(y))
        x = self.sg(x)
        x = self.conv5(x)
        x = self.dropout2(x)

        return y + x * self.gamma


class NAFNet(nn.Module):
    """NAFNet - Nonlinear Activation Free Network for Image Restoration"""

    def __init__(self, img_channel=3, width=64, middle_blk_num=12,
                 enc_blk_nums=[2, 2, 4, 8], dec_blk_nums=[2, 2, 2, 2]):
        super().__init__()

        self.intro = nn.Conv2d(img_channel, width, 3, 1, 1)
        self.ending = nn.Conv2d(width, img_channel, 3, 1, 1)

        self.encoders = nn.ModuleList()
        self.decoders = nn.ModuleList()
        self.middle_blks = nn.ModuleList()
        self.ups = nn.ModuleList()
        self.downs = nn.ModuleList()

        chan = width
        for num in enc_blk_nums:
            self.encoders.append(nn.Sequential(*[NAFBlock(chan) for _ in range(num)]))
            self.downs.append(nn.Conv2d(chan, 2 * chan, 2, 2))
            chan = chan * 2

        self.middle_blks = nn.Sequential(*[NAFBlock(chan) for _ in range(middle_blk_num)])

        for num in dec_blk_nums:
            self.ups.append(nn.Sequential(
                nn.Conv2d(chan, chan * 2, 1),
                nn.PixelShuffle(2)
            ))
            chan = chan // 2
            self.decoders.append(nn.Sequential(*[NAFBlock(chan) for _ in range(num)]))

        self.padder_size = 2 ** len(enc_blk_nums)

    def forward(self, inp):
        B, C, H, W = inp.shape
        inp = self.check_image_size(inp)

        x = self.intro(inp)

        encs = []
        for encoder, down in zip(self.encoders, self.downs):
            x = encoder(x)
            encs.append(x)
            x = down(x)

        x = self.middle_blks(x)

        for decoder, up, enc_skip in zip(self.decoders, self.ups, encs[::-1]):
            x = up(x)
            x = x + enc_skip
            x = decoder(x)

        x = self.ending(x)
        x = x + inp

        return x[:, :, :H, :W]

    def check_image_size(self, x):
        _, _, h, w = x.size()
        mod_pad_h = (self.padder_size - h % self.padder_size) % self.padder_size
        mod_pad_w = (self.padder_size - w % self.padder_size) % self.padder_size
        x = F.pad(x, (0, mod_pad_w, 0, mod_pad_h))
        return x


# =============================================================================
# FastAPI Application
# =============================================================================

# Global model reference
model = None
device = None

app = FastAPI(
    title="NAFNet Deblur Service",
    description="Image deblurring using NAFNet model (standalone)",
    version="1.1.0"
)

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
        # Setup device
        # Note: RTX 5090 (sm_120) not yet supported by PyTorch, using CPU
        # TODO: Update PyTorch when sm_120 support is available
        force_cpu = os.environ.get('NAFNET_FORCE_CPU', 'true').lower() == 'true'

        if force_cpu or not torch.cuda.is_available():
            device = torch.device('cpu')
            logger.info("Using CPU device (NAFNet deblurring)")
        else:
            device = torch.device('cuda')
            logger.info(f"Using device: {device} (GPU: {torch.cuda.get_device_name(0)})")

        # Create model
        logger.info(f"Loading NAFNet model from {MODEL_PATH}")

        model = NAFNet(
            img_channel=3,
            width=64,
            middle_blk_num=12,
            enc_blk_nums=[2, 2, 4, 8],
            dec_blk_nums=[2, 2, 2, 2]
        )

        # Load weights
        if os.path.exists(MODEL_PATH):
            checkpoint = torch.load(MODEL_PATH, map_location=device, weights_only=False)
            if 'params' in checkpoint:
                model.load_state_dict(checkpoint['params'])
            elif 'state_dict' in checkpoint:
                model.load_state_dict(checkpoint['state_dict'])
            else:
                model.load_state_dict(checkpoint)
            logger.info("Model weights loaded successfully")
        else:
            logger.warning(f"Model file not found at {MODEL_PATH}, using random weights")

        model = model.to(device)
        model.eval()

        logger.info("NAFNet model loaded successfully")
        return True

    except Exception as e:
        logger.error(f"Failed to load model: {e}")
        import traceback
        traceback.print_exc()
        return False


def preprocess_image(image: Image.Image) -> torch.Tensor:
    """Convert PIL image to tensor for NAFNet"""
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
        import traceback
        traceback.print_exc()
        return DeblurResponse(
            success=False,
            error=str(e),
            processing_time_ms=int((time.time() - start_time) * 1000)
        )


@app.on_event("startup")
async def startup_event():
    """Load model on startup"""
    logger.info("Starting NAFNet Deblur Service (Standalone)")
    if not load_nafnet_model():
        logger.error("Failed to load model, service may not work correctly")


if __name__ == "__main__":
    import uvicorn

    logger.info(f"Starting NAFNet Deblur Service on port {PORT}")
    uvicorn.run(app, host="0.0.0.0", port=PORT)
