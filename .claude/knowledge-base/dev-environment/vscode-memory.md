# VS Code Memory Management for Large Projects

## Problem
VS Code crashes with V8 OOM errors when working with FibreFlow (43K+ TypeScript files).

## Symptoms
- VS Code closes unexpectedly during deployments
- Crash dumps show: `OOM error in V8: MarkCompactCollector`
- Heap at ~3.3GB when crash occurs

## Root Cause
1. Extension host process has separate memory limits from main process
2. `argv.json` settings don't apply to extension host
3. TypeScript server processes all .d.ts files in node_modules

## Solution

### 1. Extension Host Memory (Critical)
The extension host needs `NODE_OPTIONS` environment variable:

**For terminal launches (~/.bashrc):**
```bash
export NODE_OPTIONS="--max-old-space-size=16384"
```

**For GUI launches (~/.local/share/applications/code.desktop):**
```ini
Exec=env NODE_OPTIONS="--max-old-space-size=16384" /usr/share/code/code %F
```

### 2. Main Process Memory (~/.config/Code/argv.json)
```json
{
  "js-flags": "--max-old-space-size=16384"
}
```

### 3. Extension Isolation (~/.config/Code/User/settings.json)
```json
{
  "extensions.experimental.affinity": {
    "vscode.git": 1,
    "vscode.github": 1,
    "anthropic.claude-code": 2
  }
}
```

### 4. Efficient File Watching
```json
{
  "typescript.tsserver.watchOptions": {
    "watchFile": "useFsEventsOnParentDirectory",
    "watchDirectory": "useFsEvents",
    "fallbackPolling": "dynamicPriority"
  },
  "files.watcherExclude": {
    "**/node_modules/**": true,
    "**/.next/**": true,
    "**/.git/objects/**": true
  }
}
```

## Quick Fix
If VS Code crashes, restart with:
```bash
NODE_OPTIONS="--max-old-space-size=16384" code .
```

## Verification
Check current memory limit:
```bash
echo $NODE_OPTIONS
# Should show: --max-old-space-size=16384
```

Check crash reports:
```bash
ls -lt ~/.config/Code/Crashpad/completed/ | head -5
strings ~/.config/Code/Crashpad/completed/LATEST.dmp | grep -E "OOM|Scavenge"
```

## Prevention During Deploys
- Deployments trigger heavy git/file operations
- Consider closing VS Code before multi-server deploys
- Or use `Developer: Reload Window` before deploying
