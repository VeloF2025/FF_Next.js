# Security Hardening Deployment Guide

Date: 2026-03-11
Author: Gene (VP Ops)
Status: Ready for Review

## Overview

This document outlines security hardening measures applied to the FibreFlow production infrastructure to improve system resilience and reduce attack surface.

## Components

### 1. Systemd Service Hardening

**File:** `deployment/systemd/fibreflow-production.service`

**Purpose:** Restrict capabilities and isolation of the FibreFlow production service running on Node.js

**Key Hardening Directives:**
- `NoNewPrivileges=yes` — Prevent privilege escalation via SUID/SGID
- `PrivateTmp=yes` — Isolate /tmp filesystem
- `PrivateDevices=yes` — Prevent device access except those explicitly allowed
- `RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6` — Limit network protocols
- `ProtectKernelTunables=yes` — Prevent kernel parameter modification
- `ProtectKernelModules=yes` — Prevent kernel module loading
- `ProtectControlGroups=yes` — Prevent cgroup modification
- `LockPersonality=yes` — Prevent personality(2) syscall
- `CapabilityBoundingSet` — Whitelist only CAP_NET_BIND_SERVICE, CAP_SETUID, CAP_SETGID
- `MemoryMax=2G` — Limit memory to 2GB (prevent OOM attacks)
- `CPUQuota=80%` — Limit CPU to 80% (prevent CPU exhaustion)

**Installation:**
```bash
sudo cp deployment/systemd/fibreflow-production.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl restart fibreflow-production
```

**Verification:**
```bash
sudo systemctl cat fibreflow-production | grep -A 5 "SECURITY"
sudo systemctl status fibreflow-production
```

### 2. SSH Server Hardening

**File:** `deployment/ssh/sshd-hardening.conf`

**Purpose:** Secure SSH access, disable weak authentication methods, enforce key-based auth

**Key Hardening Directives:**
- `PasswordAuthentication=no` — Require key-based authentication
- `X11Forwarding=no` — Disable X11 (reduces attack surface)
- `AllowTcpForwarding=no` — Disable port forwarding
- `AllowAgentForwarding=no` — Prevent agent forwarding
- `PermitRootLogin=no` — Prevent direct root login
- `Ciphers` — Use only modern ciphers (ChaCha20, AES-GCM)
- `KexAlgorithms` — Use Curve25519 and modern Diffie-Hellman
- `HostKeyAlgorithms` — Use ECDSA and Ed25519 only

**Installation:**
```bash
# Option 1: Merge with existing sshd_config (recommended)
sudo cat deployment/ssh/sshd-hardening.conf >> /etc/ssh/sshd_config
sudo sshd -t  # Test configuration
sudo systemctl reload ssh

# Option 2: Create separate file
sudo cp deployment/ssh/sshd-hardening.conf /etc/ssh/sshd_config.d/99-hardening.conf
sudo sshd -t  # Test configuration
sudo systemctl reload ssh
```

**Verification:**
```bash
grep "PasswordAuthentication\|X11Forwarding" /etc/ssh/sshd_config
ssh -v user@host  # Verify connection still works
```

### 3. fail2ban SSH Protection

**File:** `deployment/ssh/fail2ban-ssh.conf`

**Purpose:** Defend against brute-force SSH attacks

**Configuration:**
- Ban time: 7200 seconds (2 hours)
- Find time: 600 seconds (10 minutes)
- Max retries: 2 failed attempts
- Action: Ban IP address via UFW

**Installation:**
```bash
sudo cp deployment/ssh/fail2ban-ssh.conf /etc/fail2ban/jail.d/ssh-hardening.conf
sudo systemctl restart fail2ban

# Verify
sudo fail2ban-client status sshd
```

**Monitoring:**
```bash
# View banned IPs
sudo fail2ban-client set sshd unbanip <IP>

# Watch log
sudo tail -f /var/log/fail2ban.log
```

## Deployment Checklist

- [ ] Review systemd service hardening directives
- [ ] Review SSH configuration changes
- [ ] Test SSH access before and after changes
- [ ] Deploy systemd service to all production servers
- [ ] Deploy SSH hardening to all servers
- [ ] Configure fail2ban
- [ ] Monitor logs for 24 hours
- [ ] Verify service health (HTTP 200, memory, CPU)

## Rollback Procedure

If issues arise after deployment:

**Systemd:**
```bash
sudo systemctl stop fibreflow-production
sudo cp /etc/systemd/system/fibreflow-production.service.bak /etc/systemd/system/fibreflow-production.service
sudo systemctl daemon-reload
sudo systemctl restart fibreflow-production
```

**SSH:**
```bash
sudo cp /etc/ssh/sshd_config.bak /etc/ssh/sshd_config
sudo sshd -t
sudo systemctl reload ssh
```

## Post-Deployment Monitoring

Monitor for 48 hours:
- Service uptime and response times
- SSH connection success/failure rates
- fail2ban ban/unban activities
- Resource usage (CPU, memory)
- Application error logs

## References

- Linux Kernel Security: https://www.kernel.org/doc/html/latest/admin-guide/LSM/index.html
- systemd Security: https://www.freedesktop.org/software/systemd/man/latest/systemd.exec.html
- OpenSSH Security: https://man.openbsd.org/sshd_config
- fail2ban: https://www.fail2ban.org/wiki/index.php/Main_Page

---

**Status:** Ready for Hein review and merge.
**Next Step:** Create GitHub PR and assign to Hein.
