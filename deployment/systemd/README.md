# systemd units for FibreFlow

Versioned copies of the systemd units and drop-ins that run FibreFlow on the
Velocity host, so the deploy config is reinstallable and drift is catchable.
Captured verbatim from the live host on 2026-07-17 (#2187).

## Files

| Repo path | Installs to | Purpose |
|-----------|-------------|---------|
| `fibreflow-production.service` | `/etc/systemd/system/` | Prod app (port 3000). Wires the prestart guard via `ExecStartPre=+/usr/local/bin/fibreflow-prestart …`. |
| `fibreflow-dev.service` | `/etc/systemd/system/` | Dev app (port 3005). Same guard wiring. |
| `fibreflow-production.service.d/environment.conf` | drop-in | `EnvironmentFile=/home/velo/fibreflow-production/.env` (the `.env` itself is **not** versioned — secrets live only on the host). |
| `fibreflow-production.service.d/port-cleanup.conf` | drop-in | Frees port 3000 before start (`lsof … | kill`). |
| `fibreflow-production.service.d/50-memorymax.conf` | drop-in | `MemoryMax=16G` — see the file's own comment; the live host sets this via `systemctl set-property`, which a base-unit reinstall would otherwise drop to 4G. |

The `ExecStartPre` guard script itself (`/usr/local/bin/fibreflow-prestart`) is a
separate concern — it auto-syncs from `scripts/fibreflow-prestart.sh` on every
deploy (#2183/#2186). This directory versions the **wiring** that invokes it.

## Why these are versioned (#2187)

The tracked `fibreflow-production.service` had drifted from live — most importantly
it was missing the `ExecStartPre` guard line, and had `MemoryMax=2G` vs the live
4G base — and there was no tracked dev unit at all. A reinstall from the old repo
copy would have silently dropped the guard entirely. These files are the live
config, faithfully captured.

## Reconcile / check for drift

The live host is the source of truth until these are installed. Before trusting or
editing, diff each against live (run on the Velocity host):

```bash
for u in fibreflow-production fibreflow-dev; do
  sudo diff /etc/systemd/system/$u.service deployment/systemd/$u.service && echo "$u: in sync"
done
sudo diff -r /etc/systemd/system/fibreflow-production.service.d \
             deployment/systemd/fibreflow-production.service.d
```

## Install (host rebuild / disaster recovery)

⚠️ Installing a unit that differs from the running one and running `daemon-reload`
changes how the service will next start. Diff first (above), install deliberately,
and restart **outside business hours** for production.

```bash
sudo install -m 644 deployment/systemd/fibreflow-production.service /etc/systemd/system/
sudo install -m 644 deployment/systemd/fibreflow-dev.service        /etc/systemd/system/
sudo mkdir -p /etc/systemd/system/fibreflow-production.service.d
sudo install -m 644 deployment/systemd/fibreflow-production.service.d/*.conf \
                    /etc/systemd/system/fibreflow-production.service.d/
sudo systemctl daemon-reload
# then, on the next planned restart, the guard + limits above take effect
```

The `.env` referenced by `environment.conf` must exist on the host — it is
intentionally not in the repo.
