# Velo ops configs (tracked copies)

These files run on the Velocity server but live in **no** repo on that host. They
are tracked here so a server rebuild, an accidental overwrite, or an undocumented
edit can be recovered and diffed.

They are **copies, not the live files** — editing them here does not deploy
anything. See "Deploying a change" below.

| File here | Lives on velo at | Purpose |
|---|---|---|
| `fibreflow-health-check-v2.sh` | `/home/velo/scripts/fibreflow-health-check-v2.sh` | Health monitor, `*/15` in velo's crontab. Probes services and restarts what is down. |
| `dr-photo-api.docker-compose.yml` | `/srv/services/dr-photo-api/docker-compose.yml` | Compose for the BOSS `dr-photo-api` container (port 8003). |

## Secrets

Neither file contains credentials — that is what makes them trackable. Both read
their secrets from a gitignored env file on the server, mode `600`, owner `velo`:

| Env file (on velo, never committed) | Consumed by | Keys |
|---|---|---|
| `/home/velo/scripts/.fibreflow-health.env` | health-check script | `FIBREFLOW_DB_PASSWORD`, `VELO_SUDO_PASSWORD` |
| `/srv/services/dr-photo-api/.env` | compose `${VAR}` substitution | `DATABASE_URL`, `ONEMAP_EMAIL`, `ONEMAP_PASSWORD`, `GEMINI_API_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` |

Actual values: see `.claude/credentials.local.md` (gitignored) or the server env
files. **Never** put a real value in this directory.

The health-check script degrades rather than dying if its env file is missing:
DB logging and sudo-based recovery become no-ops. That is deliberate — a monitor
that aborts on a missing secret is worse than one that keeps probing.

## Deploying a change

There is no automated sync. To change either file:

1. Edit here, open a PR, get it merged.
2. Copy to the server:
   ```bash
   sudo cp scripts/ops/velo/fibreflow-health-check-v2.sh /home/velo/scripts/
   sudo chown velo:velo /home/velo/scripts/fibreflow-health-check-v2.sh
   sudo chmod 755 /home/velo/scripts/fibreflow-health-check-v2.sh
   bash -n /home/velo/scripts/fibreflow-health-check-v2.sh   # syntax gate
   ```
3. For compose, `docker compose config` first, then `docker compose up -d`.
   Note this **recreates** the container — compose tracks the file's config
   hash, so even a no-op edit triggers a recreate. Data is bind-mounted from
   `/srv/data/boss/`, so it survives.

## Drift check

```bash
diff /home/velo/scripts/fibreflow-health-check-v2.sh \
     scripts/ops/velo/fibreflow-health-check-v2.sh
diff /srv/services/dr-photo-api/docker-compose.yml \
     scripts/ops/velo/dr-photo-api.docker-compose.yml
```

Any difference means someone edited the server copy directly. Reconcile before
making further changes.

## Known issue

`fibreflow-health-check-v2.sh` authenticates sudo by piping a password
(`echo "$VELO_SUDO_PASSWORD" | sudo -S ...`). Moving it to an env file removed it
from version control, but the password still exists in plaintext on disk and in
the process environment. The better fix is a `/etc/sudoers.d/` `NOPASSWD` rule
scoped to the exact `systemctl` commands the script needs, which would let the
password be deleted entirely. Not done — changing sudoers carries lockout risk
and deserves its own change.
