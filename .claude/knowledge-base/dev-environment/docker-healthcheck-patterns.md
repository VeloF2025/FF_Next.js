# Docker Health Check Patterns

## Problem: curl Not Available in Python Containers

### Symptom
```
OCI runtime exec failed: exec failed: unable to start container process: exec: "curl": executable file not found in $PATH
```

### Cause
Slim Python images (e.g., `python:3.11-slim`) don't include curl or wget by default.

### Solution
Use Python's built-in `urllib.request`:

```yaml
healthcheck:
  test: ["CMD", "python", "-c", "import urllib.request; urllib.request.urlopen('http://localhost:8000/health')"]
  interval: 30s
  timeout: 10s
  retries: 3
  start_period: 30s
```

### Alternative: Install curl in Dockerfile
If you need curl for other purposes:
```dockerfile
RUN apt-get update && apt-get install -y curl && rm -rf /var/lib/apt/lists/*
```

---

## Problem: wget localhost Fails with IPv6

### Symptom
```
Connecting to localhost ([::1]:80)
wget: can't connect to remote host: Connection refused
```

### Cause
Alpine's wget resolves `localhost` to IPv6 `[::1]` first, but the service may only listen on IPv4.

### Solution
Use explicit IPv4 address:

```yaml
healthcheck:
  test: ["CMD", "wget", "--no-verbose", "--tries=1", "--spider", "http://127.0.0.1/"]
  interval: 30s
  timeout: 3s
  retries: 3
  start_period: 10s
```

---

## Best Practices by Base Image

### Python Containers (python:*-slim)
```yaml
healthcheck:
  test: ["CMD", "python", "-c", "import urllib.request; urllib.request.urlopen('http://localhost:PORT/health')"]
```

### Node.js Containers (node:*-alpine)
```yaml
healthcheck:
  test: ["CMD", "node", "-e", "require('http').get('http://localhost:PORT/health', (r) => process.exit(r.statusCode === 200 ? 0 : 1))"]
```

### Nginx/Alpine Containers
```yaml
healthcheck:
  test: ["CMD", "wget", "--no-verbose", "--tries=1", "--spider", "http://127.0.0.1/"]
```

### Go Containers (scratch/distroless)
Build health check into the binary:
```yaml
healthcheck:
  test: ["CMD", "/app/healthcheck"]  # Custom binary
```

Or use the main binary with a flag:
```yaml
healthcheck:
  test: ["CMD", "/app/myapp", "--health"]
```

---

## Velocity Server Fixes (2026-02-05)

Fixed containers:
| Container | File | Issue | Fix |
|-----------|------|-------|-----|
| `drop-number-api` | `/srv/services/drop-number-api/docker-compose.yml` | curl missing | Python urllib |
| `boss-cost-api` | `/srv/stacks/core/boss-cost-api/docker-compose.yml` | curl missing | Python urllib |
| `boss-cost-dashboard` | `/srv/stacks/apps/cost-dashboard/docker-compose.yml` | IPv6 localhost | 127.0.0.1 |

### Apply Changes
After editing docker-compose.yml:
```bash
cd /path/to/compose/dir
docker-compose up -d --force-recreate
```
