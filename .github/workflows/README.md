# GitHub Actions Disabled

CI/CD has moved to local tooling (2026-04-03):

- **Local CI:** `npm run ci` / `npm run ci:quick` (`scripts/ci-local.sh`)
- **Pre-PR:** `/pr` command runs lint gates automatically
- **Pre-deploy:** `deploy-local.sh` runs lint gates before build
- **Pre-commit:** Git hook runs lint + type-check + ZT checks

Previous workflows archived in `.github/workflows-disabled/`.
