# VF Server ML Services - January 2026

## Overview

The VF Server (100.96.203.105) runs ML services for vision-based tasks including:
- Staff photo verification (face comparison)
- Document OCR with photo extraction
- WhatsApp QA image analysis

## VLLM Service

### Status
**Model:** Qwen/Qwen3-VL-8B-Instruct (17GB Vision-Language Model)
**Port:** 8100
**Endpoint:** http://100.96.203.105:8100

### Model Location
```
/home/velo/.cache/huggingface/hub/models--Qwen--Qwen3-VL-8B-Instruct
```

**Note:** Models are loaded from HuggingFace cache, NOT `/home/velo/ml/models/`

### Configuration
| Parameter | Value |
|-----------|-------|
| GPU Memory Utilization | 80% |
| Max Model Length | 4096 tokens |
| Host | 0.0.0.0 (all interfaces) |
| Trust Remote Code | Yes |

## SSH Access

### Recommended: SSH Key
```bash
ssh -i ~/.ssh/vf_server_key velo@100.96.203.105
```

If you don't have the key, ask Louis to share it or add your public key to `~/.ssh/authorized_keys`.

### Alternative: Password (hein user)
```bash
ssh hein@100.96.203.105
# Password: OCRDeploy2025!
```

**Note:** The velo user password "2025" may not work - use SSH key instead.

## Managing VLLM

### Check Status
```bash
# Check if process is running
ps aux | grep vllm | grep -v grep

# Check API health
curl http://100.96.203.105:8100/v1/models

# View logs
tail -f /home/velo/ml/vllm_qwen3.log
```

### Restart Service
```bash
# Kill existing process
pkill -f "vllm.entrypoints.openai.api_server"

# Start fresh
cd /home/velo/ml
nohup ./start_vllm.sh > vllm_qwen3.log 2>&1 &
```

### Start Script
Location: `/home/velo/ml/start_vllm.sh`

```bash
#!/bin/bash
cd ~/ml
source vllm_env/bin/activate
exec python3 -m vllm.entrypoints.openai.api_server \
    --model Qwen/Qwen3-VL-8B-Instruct \
    --trust-remote-code \
    --port 8100 \
    --max-model-len 4096 \
    --gpu-memory-utilization 0.80 \
    --host 0.0.0.0
```

### Manual Start (Alternative)
```bash
cd /home/velo/ml
source vllm_env/bin/activate
python3 -m vllm.entrypoints.openai.api_server \
    --model Qwen/Qwen3-VL-8B-Instruct \
    --trust-remote-code \
    --port 8100 \
    --max-model-len 4096 \
    --gpu-memory-utilization 0.80 \
    --host 0.0.0.0 &
```

## API Usage

### Environment Variable
```bash
VLLM_ENDPOINT=http://100.96.203.105:8100
```

### List Models
```bash
curl http://100.96.203.105:8100/v1/models | python3 -m json.tool
```

### Chat Completion with Image
```bash
curl -X POST http://100.96.203.105:8100/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "Qwen/Qwen3-VL-8B-Instruct",
    "messages": [{
      "role": "user",
      "content": [
        {"type": "text", "text": "What is in this image?"},
        {"type": "image_url", "image_url": {"url": "https://example.com/image.jpg"}}
      ]
    }],
    "max_tokens": 500,
    "temperature": 0.1
  }'
```

### TypeScript Example
```typescript
const VLLM_ENDPOINT = process.env.VLLM_ENDPOINT || 'http://100.96.203.105:8100';

async function analyzeImage(imageUrl: string, prompt: string) {
  const response = await fetch(`${VLLM_ENDPOINT}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'Qwen/Qwen3-VL-8B-Instruct',
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: imageUrl } }
        ]
      }],
      max_tokens: 500,
      temperature: 0.1
    }),
    signal: AbortSignal.timeout(60000) // 60s timeout for VLM inference
  });

  if (!response.ok) {
    throw new Error(`VLLM request failed: ${await response.text()}`);
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content || '';
}
```

### Python Example
```python
import requests
import base64

VLLM_ENDPOINT = "http://100.96.203.105:8100"

# Test model list
response = requests.get(f"{VLLM_ENDPOINT}/v1/models")
print(response.json())

# Analyze image from URL
def analyze_image(image_url: str, prompt: str) -> str:
    data = {
        "model": "Qwen/Qwen3-VL-8B-Instruct",
        "messages": [{
            "role": "user",
            "content": [
                {"type": "text", "text": prompt},
                {"type": "image_url", "image_url": {"url": image_url}}
            ]
        }],
        "max_tokens": 500,
        "temperature": 0.1
    }

    response = requests.post(
        f"{VLLM_ENDPOINT}/v1/chat/completions",
        json=data,
        timeout=60
    )
    response.raise_for_status()
    return response.json()["choices"][0]["message"]["content"]

# Analyze image from file (base64)
def analyze_local_image(file_path: str, prompt: str) -> str:
    with open(file_path, "rb") as f:
        image_base64 = base64.b64encode(f.read()).decode()

    data = {
        "model": "Qwen/Qwen3-VL-8B-Instruct",
        "messages": [{
            "role": "user",
            "content": [
                {"type": "text", "text": prompt},
                {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{image_base64}"}}
            ]
        }],
        "max_tokens": 500
    }

    response = requests.post(f"{VLLM_ENDPOINT}/v1/chat/completions", json=data, timeout=60)
    return response.json()["choices"][0]["message"]["content"]
```

## FibreFlow Integration

### Staff Photo Comparison
**API:** `POST /api/staff/[staffId]/compare-photos`

Compares ID document photo with uploaded profile photo to verify identity.

```typescript
// pages/api/staff/[staffId]/compare-photos.ts
const response = await fetch(`${VLLM_ENDPOINT}/v1/chat/completions`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    model: 'Qwen/Qwen3-VL-8B-Instruct',
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: faceComparisonPrompt },
        { type: 'image_url', image_url: { url: idPhotoUrl } },
        { type: 'image_url', image_url: { url: profilePhotoUrl } }
      ]
    }],
    max_tokens: 500,
    temperature: 0.1
  })
});
```

### Document OCR (Future)
Photo extraction from ID documents using vision model face detection.

### WhatsApp QA (Future)
Image analysis for drop validation in WA Monitor.

## Troubleshooting

### VLLM Not Responding
```bash
# Check if process exists
ps aux | grep vllm

# Check logs for errors
tail -100 /home/velo/ml/vllm_qwen3.log

# Restart service
pkill -f vllm
cd /home/velo/ml && nohup ./start_vllm.sh > vllm_qwen3.log 2>&1 &
```

### GPU Memory Issues
If OOM errors occur, reduce GPU utilization:
```bash
--gpu-memory-utilization 0.70  # Reduce from 0.80
```

### Model Loading Slow
First request after restart may take 30-60 seconds as model loads into GPU memory.

### Port Already in Use
```bash
# Find process using port
lsof -i :8100

# Kill it
kill -9 <PID>
```

## Backup & Recovery

### Model Cache
Models are automatically downloaded from HuggingFace on first run. If cache is corrupted:
```bash
rm -rf ~/.cache/huggingface/hub/models--Qwen--Qwen3-VL-8B-Instruct
# Model will re-download on next start
```

### ML Environment Backup
```bash
/home/velo/ml.backup/  # Contains old configs and saves
```

## Related Services

| Service | Port | Purpose |
|---------|------|---------|
| VLLM | 8100 | Vision-Language Model API |
| Storage API | 8091 | File/image storage |
| Ollama | 11434 | Alternative LLM (text-only) |
| OCR Service | 8080 | Document text extraction |

## Quick Commands Reference

```bash
# SSH to server
ssh -i ~/.ssh/vf_server_key velo@100.96.203.105

# Check VLLM status
curl http://100.96.203.105:8100/v1/models | python3 -m json.tool

# View logs (remote)
ssh -i ~/.ssh/vf_server_key velo@100.96.203.105 'tail -50 /home/velo/ml/vllm_qwen3.log'

# Restart VLLM (remote)
ssh -i ~/.ssh/vf_server_key velo@100.96.203.105 'pkill -f vllm; cd /home/velo/ml && nohup ./start_vllm.sh > vllm_qwen3.log 2>&1 &'
```
