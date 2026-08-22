# WhatsApp Bridge (Go)

The unified WhatsApp bridge that receives DR submissions from monitored groups
and sends acknowledgements back. Runs on the VPS (`72.61.197.178`) as
`whatsapp-bridge.service`, listening on `:8083`.

Until 2026-08-22 this source lived only at `/home/velo/whatsapp-bridge/` on
Velocity, untracked, with ad-hoc `.bak` copies as its only history. This
directory is that source, imported verbatim except for the change noted below.

## The one deviation from the imported source

`NEON_DB_URL` previously defaulted to a connection string containing the live
`fibreflow_user` password. It now reads `DATABASE_URL` with no fallback, and
`main()` exits 1 when it is unset. The deployed systemd unit already sets it.

## Build and deploy

The binary is built on Velocity and relayed to the VPS through a workstation —
Velocity has no SSH key to the VPS.

```bash
# On Velocity, from a checkout of this directory:
go build -o whatsapp-bridge-new .

# From a workstation:
scp velo@100.96.203.105:<path>/whatsapp-bridge-new /tmp/bridge-new
scp /tmp/bridge-new root@72.61.197.178:/opt/whatsapp-bridge/whatsapp-bridge.new

# On the VPS:
cd /opt/whatsapp-bridge
cp whatsapp-bridge whatsapp-bridge.bak-$(date +%Y%m%d-%H%M%S)
mv whatsapp-bridge.new whatsapp-bridge && chmod +x whatsapp-bridge
systemctl restart whatsapp-bridge.service   # once - never loop
```

Operational runbook, including the pairing and number-swap procedure, lives in
the `wa-bridge-ops` skill.

## Port exposure

`:8083` is firewalled to Velocity's egress IP and the tailnet (2026-08-22).
No endpoint authenticates its caller yet; see the follow-up work adding a
shared-secret check to every mutating endpoint.
