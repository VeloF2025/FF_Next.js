# Changelog - Deployment & Security

All notable changes to deployment configurations and security hardening will be documented in this file.

Format: `## [Commit Hash] - YYYY-MM-DD - Author - Type`

---

## [7f8ac21] - 2026-03-11 - Jarvis - Security

**security: Add hardening configs for systemd service and SSH**

Comprehensive security hardening for production deployment with systemd service restrictions and SSH server configuration.

**Changes:**

### systemd Service Hardening (`fibreflow-production.service`)
- **Capability restrictions:** NoNewPrivileges, CAP whitelist
- **Isolation:** PrivateTmp, PrivateDevices, RestrictNamespaces
- **Kernel protection:** ProtectKernelTunables, ProtectKernelModules, ProtectKernelLogs, ProtectControlGroups
- **Resource limits:** MemoryMax=2G, CPUQuota=80%
- 15+ security directives added

### SSH Server Hardening (`sshd-hardening.conf`)
- **Authentication:** PasswordAuthentication=no (key-based auth only)
- **Disabled features:** X11Forwarding=no, AllowTcpForwarding=no (disable port forwarding)
- **Modern cryptography:** Updated ciphers, KexAlgorithms, MACs
- Secure SSH server configuration

### Fail2Ban Protection (`fail2ban-ssh.conf`)
- **SSH brute-force protection:** Ban time: 2 hours, Max retries: 2
- Automated IP blocking for repeated failed attempts

### Documentation
- **SECURITY-HARDENING.md:** Complete deployment guide and checklist (159 lines)
- Step-by-step hardening procedures
- Verification commands and troubleshooting

**Deployment Verification:**
- Deployed successfully on 2026-03-11 02:39 SAST
- Service responds HTTP 200
- Memory usage nominal
- Uptime stable

**Files Changed:** 4 files, 313 insertions
- `deployment/SECURITY-HARDENING.md` (159 lines, NEW)
- `deployment/ssh/fail2ban-ssh.conf` (30 lines, NEW)
- `deployment/ssh/sshd-hardening.conf` (62 lines, NEW)
- `deployment/systemd/fibreflow-production.service` (62 lines, NEW)

**Closes:** Security hardening tasks 1 & 3

---

*Last Updated: 2026-03-11*
