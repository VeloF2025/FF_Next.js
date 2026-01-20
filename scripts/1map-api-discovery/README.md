# 1Map Mobile API Discovery

This directory contains tools for discovering the 1Map mobile app's update API using mitmproxy.

## Background

The 1Map web application is **read-only** for editing fields like ONT and UPS serials.
Editing is only available in the **mobile app**. We want to discover the API the mobile
app uses to update records, so we can potentially automate fixing swapped serials.

## Prerequisites

1. **mitmproxy** installed on your development machine
2. **Phone** connected to same WiFi as your computer
3. **1Map mobile app** installed on your phone

## Setup Steps

### 1. Install mitmproxy

```bash
# macOS
brew install mitmproxy

# Linux (Ubuntu/Debian)
sudo apt install mitmproxy

# pip (any platform)
pip install mitmproxy
```

### 2. Start mitmproxy

```bash
# Start on port 8080 (default)
mitmproxy --listen-port 8080

# Or with web interface on port 8081
mitmweb --listen-port 8080 --web-port 8081
```

Your computer's IP (find with `hostname -I` on Linux or `ifconfig` on macOS):
- Example: 192.168.1.100

### 3. Configure Phone Proxy

**Android:**
1. Settings → WiFi → Long press your network → Modify network
2. Advanced options → Proxy → Manual
3. Proxy hostname: YOUR_COMPUTER_IP (e.g., 192.168.1.100)
4. Proxy port: 8080
5. Save

**iOS:**
1. Settings → WiFi → tap (i) next to your network
2. HTTP Proxy → Configure Proxy → Manual
3. Server: YOUR_COMPUTER_IP
4. Port: 8080
5. Save

### 4. Install mitmproxy Certificate

On your phone browser, go to: `http://mitm.it`

This page will show certificates for your device. Download and install:
- **Android**: Download the Android certificate, then install via Settings → Security → Install certificate
- **iOS**: Download profile, then go to Settings → Profile Downloaded → Install

**Important for Android 7+**: You may need to add the certificate to system trust store.

### 5. Capture 1Map API Calls

1. Open 1Map mobile app
2. Navigate to a DR with swapped serials (e.g., DR1738319)
3. Edit the ONT serial field
4. Save the change
5. Watch mitmproxy for the API call

### 6. What to Look For

In mitmproxy, look for:
- Requests to `www.1map.co.za` or `1map.co.za`
- POST, PUT, or PATCH methods
- Endpoints containing `/api/`, `/update/`, `/feature/`, `/data/`
- JSON payloads with property names like `ph_ont`, `br_ser`, `prop_id`

Example expected formats:
```
PUT /api/v1/data/5121/439108
POST /api/v1/layers/5121/features/439108/update
PATCH /api/v1/feature/5121
```

### 7. Document Findings

When you find the update API, note:
1. **Endpoint URL** (path and query params)
2. **HTTP method** (POST/PUT/PATCH)
3. **Headers** (especially authentication headers)
4. **Request body** format
5. **Response** format

Save the raw request to `captured-update-request.json` in this directory.

## Files in This Directory

- `README.md` - This file
- `probe.mjs` - API probing script (read endpoints)
- `captured-update-request.json` - (You create this) Captured mobile update request
- `analyze-capture.mjs` - (Future) Script to replay captured requests

## Security Notes

- Only use mitmproxy on networks you own/control
- Remove proxy settings from your phone after testing
- Don't capture credentials for services you don't own
- This is for legitimate reverse engineering of an API you're authorized to use
