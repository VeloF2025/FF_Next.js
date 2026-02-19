# Zander SSH Setup — Velocity Server Access via VS Code

This document is for Zander's Claude Code instance. It explains how to connect from
Zander's laptop (using VS Code + Claude Code in the integrated terminal) to the
Velocity server and work with FibreFlow.

---

## The Workflow

```
Zander's Laptop
  └── VS Code
        └── Integrated Terminal
              └── ssh zander@100.96.203.105   ← you are here
                    └── /home/velo/fibreflow-*/
                          └── claude           ← Claude Code running on the server
```

---

## Step 1: Tailscale VPN (Required First)

The Velocity server IP `100.96.203.105` is on the Tailscale private network.
Zander's laptop must be connected to Tailscale before SSH will work.

```bash
# Install Tailscale (macOS)
brew install tailscale

# Install Tailscale (Linux/Ubuntu)
curl -fsSL https://tailscale.com/install.sh | sh

# Connect (do this once; it persists across reboots)
sudo tailscale up
# Follow the auth link — log in with the VelocityFibre account

# Verify the connection
tailscale status
# Should show 100.96.203.105 as reachable
```

---

## Step 2: SSH Key Setup (Do Once — Skips Password Prompts Forever)

```bash
# 1. Generate a key if Zander doesn't have one
ssh-keygen -t ed25519 -C "zander-laptop"
# Press Enter through all prompts to accept defaults

# 2. Copy the public key to Velocity
ssh-copy-id zander@100.96.203.105
# Password when prompted: zander2026

# 3. Verify it works without a password
ssh zander@100.96.203.105
# Should connect immediately — no password prompt
```

---

## Step 3: SSH Config Shortcut

Add this to `~/.ssh/config` on Zander's laptop (create the file if it doesn't exist):

```
Host velocity
    HostName 100.96.203.105
    User zander
    IdentityFile ~/.ssh/id_ed25519
    ServerAliveInterval 60
    ServerAliveCountMax 3
```

After this, connecting is just:

```bash
ssh velocity
```

---

## Step 4: Connect from VS Code Integrated Terminal

1. Open VS Code on Zander's laptop
2. Open the integrated terminal: `` Ctrl+` `` (backtick) or **View → Terminal**
3. In the terminal, SSH into Velocity:

```bash
ssh velocity
# or if you skipped Step 3:
ssh zander@100.96.203.105
```

You are now inside Velocity's shell, inside VS Code's terminal.

---

## Step 5: Navigate to FibreFlow and Launch Claude Code

Once SSHed in, navigate to the relevant FibreFlow directory and start Claude Code:

```bash
# Go to the dev environment (recommended for development work)
cd /home/velo/fibreflow-dev

# Or staging
cd /home/velo/fibreflow-staging

# Or production (be careful here)
cd /home/velo/fibreflow-production

# Launch Claude Code
claude
```

Claude Code will start in the terminal, with full access to the FibreFlow codebase
on the server. It can read files, run builds, restart services, and deploy.

---

## FibreFlow Environments on Velocity

| Environment | Directory | URL | Port |
|-------------|-----------|-----|------|
| Production | `/home/velo/fibreflow-production/` | app.fibreflow.app | 3000 |
| Staging | `/home/velo/fibreflow-staging/` | vf.fibreflow.app | 3006 |
| Dev | `/home/velo/fibreflow-dev/` | dev.fibreflow.app | 3005 |

---

## Useful Server Commands

```bash
# Check service status
sudo systemctl status fibreflow-dev.service
sudo systemctl status fibreflow.service          # staging
sudo systemctl status fibreflow-production.service

# Restart a service (sudo password is zander2026)
sudo systemctl restart fibreflow-dev.service

# Tail live logs
sudo journalctl -u fibreflow-dev.service -f

# See what's on a port
sudo lsof -i :3005
```

---

## Deploy Commands (Run from Velocity or via SSH from Laptop)

```bash
# Deploy Dev
cd /home/velo/fibreflow-dev && git pull && npm run build && \
  echo 'velo2026' | sudo -S systemctl restart fibreflow-dev.service

# Deploy Staging
cd /home/velo/fibreflow-staging && git pull && npm run build && \
  echo 'velo2026' | sudo -S systemctl restart fibreflow.service

# Deploy Production
cd /home/velo/fibreflow-production && git pull && npm run build && \
  echo 'velo2026' | sudo -S systemctl restart fibreflow-production.service
```

---

## VS Code Remote SSH Extension (Optional — Better Experience)

Instead of SSHing manually in the terminal, VS Code can mount the remote filesystem
directly so you browse and edit server files as if they were local.

1. Install the **Remote - SSH** extension in VS Code (Extension ID: `ms-vscode-remote.remote-ssh`)
2. Press `F1` → type **Remote-SSH: Connect to Host** → select `velocity`
3. VS Code will open a new window connected to Velocity
4. Open the folder `/home/velo/fibreflow-dev` (or staging/production)
5. Open the integrated terminal — it's already inside Velocity, no manual SSH needed
6. Run `claude` in that terminal

This gives Zander full file browsing, syntax highlighting, and Claude Code all in one window.

---

## Troubleshooting

| Problem | Likely Cause | Fix |
|---------|-------------|-----|
| `No route to host` | Tailscale not running | `sudo tailscale up` |
| `Permission denied` | Wrong credentials or key not copied | Re-run `ssh-copy-id zander@100.96.203.105` |
| `Host key verification failed` | Server fingerprint changed | `ssh-keygen -R 100.96.203.105` then reconnect |
| `claude: command not found` | Claude Code not installed on server | Ask Hein to install it: `npm install -g @anthropic-ai/claude-code` |
| SSH drops after idle | No keepalive configured | Add `ServerAliveInterval 60` to `~/.ssh/config` (done in Step 3) |

---

## GitHub Repository Access

Zander has been added as a **write** collaborator on the FibreFlow repository.

| Item | Value |
|------|-------|
| GitHub username | `Zander1798` |
| Repository | `VelocityFibre/FF_Next.js` |
| Permission | `write` (push to branches, create PRs) |

**Accept the invitation:**
- Check the email sent to `zandervv0610@icloud.com`, or
- Accept directly at: `https://github.com/VelocityFibre/FF_Next.js/invitations`

Once accepted, clone the repo on Velocity:

```bash
# On Velocity, after SSH-ing in
git clone git@github.com:VelocityFibre/FF_Next.js.git
```

Or pull latest changes in an existing checkout:

```bash
cd /home/velo/fibreflow-dev
git pull
```

---

## Server Credentials Summary

| Item | Value |
|------|-------|
| IP | `100.96.203.105` |
| SSH user | `zander` |
| SSH password | `zander2026` |
| Sudo password | `zander2026` |
| Service sudo password | `velo2026` (used in deploy scripts) |
| GitHub username | `Zander1798` |
| GitHub repo | `VelocityFibre/FF_Next.js` |

> **Do not commit these credentials to any repository.**
> Production serves live users — always test on dev/staging first.
