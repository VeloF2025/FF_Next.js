# Payslip storage hardening (2026-04-28)

Payslip PDFs are stored on VF Storage at `/storage/staff/payslips/<hashed>.pdf`.
The nginx `/storage/` proxy at the edge previously served these without auth,
so anyone who knew or guessed a URL could download a payslip outside the
authenticated `/api/my/payslips/[id]/download` flow.

## Change applied on Velocity (`/etc/nginx/sites-enabled/vf-fibreflow`)

Each `server { … }` block (dev, prod, retired-staging) now has a regex
location ahead of the `/storage/` prefix block that returns 403 for any
public hit on payslip files:

```nginx
location ~ ^/storage/staff/payslips/ { return 403; }

location /storage/ {
    proxy_pass http://localhost:8091/;
    # …other proxy directives…
    expires 30d;
    add_header Cache-Control "public, immutable";
}
```

In nginx, regex locations (`location ~`) take precedence over prefix
locations without `^~`, so the deny wins. The Next.js download endpoint
fetches VF Storage directly on `http://100.96.203.105:8091` (see
`src/modules/payslips/storage.ts → resolvePayslipFetchUrl`), so the app
continues to serve payslips through the authenticated path.

Backup of the unmodified config: `/root/vf-fibreflow.bak.2026-04-28` on
the Velocity server.

## Cloudflare cache

Existing cached `/storage/staff/payslips/*` responses were purged via
the Cloudflare API after the nginx reload. New URLs will not be cached
publicly because nginx returns 403 before the response can be cached.

## How to verify

```bash
# External (must be 403):
curl -sI -o /dev/null -w "%{http_code}\n" \
  "https://dev.fibreflow.app/storage/staff/payslips/anything.pdf"

# In-app (still 200 because it goes via /api/my/payslips/<id>/download
# with an authenticated session cookie):
# Browse /my/payslips and tap "PDF".
```

## Re-applying after a server rebuild

A snapshot of the live config (with the deny rule applied) is tracked in
`docs/VPS/vf-fibreflow.nginx.conf`. After any nginx rebuild or a fresh
server provisioning:

```bash
sudo cp docs/VPS/vf-fibreflow.nginx.conf /etc/nginx/sites-enabled/vf-fibreflow
sudo nginx -t && sudo systemctl reload nginx
```

A future PR should wire the deploy pipeline to render and reload this
config from the template automatically — until then, this is a manual
step on every nginx-affecting maintenance.
