# vlm-bench

Process-tuned VLM benchmark engine. See spec:
`docs/superpowers/specs/2026-05-25-vlm-benchmark-design.md`.

## Run
    npx tsx scripts/vlm-bench/cli.ts coverage
    npx tsx scripts/vlm-bench/cli.ts run --pack serials --mode golden

## Add a pack
Implement `VlmTestPack` (see `packs/serials.ts`), register it in `cli.ts` PACKS,
and add a golden manifest under `datasets/golden/<pack>/cases.json`.

## Notes
- Runs on velo (where the VLM lives) via tsx.
- DB writes use `@/lib/db-pool` (pg.Pool), never neon().
- Output uses process.stdout (logger is silent under tsx).
