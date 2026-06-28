# FNO Atlas GIS Productisation Plan

## Reality check
The current FNO Atlas release is a UI/reference layer. It is not yet a genuine coverage intelligence product because the marker points are not authoritative coverage polygons and project matching is not computed from source-backed geospatial data.

## Target outcome
Build a source-backed database of South African FNO/backhaul coverage, ingest genuine map/API/PDF/partner data, and overlay FibreFlow project/drop coordinates to answer:

- Which FNOs already cover or pass near this project?
- Which backhaul operators make the project viable?
- Which FNOs are suited to dense residential, SME/business, rural, township and low-LSM rollouts?
- What is the evidence source and confidence behind each recommendation?

## Architecture

1. **Source registry**
   - Official FNO map/API sources
   - Partner/aggregator coverage APIs
   - Public PDF/KML/GeoJSON sources
   - Manual uploaded datasets where scraping is not lawful or reliable

2. **Ingestion jobs**
   - Playwright/Crawlee for JS coverage portals
   - Static fetch for public GeoJSON/KML/PDF sources
   - Commercial API connectors where required
   - Every run records source snapshot, count imported, failures and timestamp

3. **GIS storage**
   - PostGIS `geometry(MultiPolygon, 4326)` for coverage polygons
   - Geometry validity checks and GIST indexes
   - Raw source properties preserved as JSONB
   - Retired/changed polygons retained historically

4. **Project overlays**
   - Use `public.projects.latitude/longitude` where present
   - Use `public.drops` / `onemap.drops` density for projects without project-level coordinates
   - Compute inside coverage, nearby coverage and backhaul-nearby evidence
   - Store fit score and evidence JSON, not hand-authored claims

## Existing FibreFlow data found

- PostGIS is already enabled.
- Existing geometry tables: `public.pon_boundaries`, `public.zone_boundaries`.
- `public.projects`: 13 rows, only 1 currently has project-level coordinates.
- `public.drops`: 180,265 rows, 144,558 have latitude/longitude.
- `onemap.drops`: 64,030 rows, 14,534 have latitude/longitude.

This means project overlays should be drop-density based first, not only project-centroid based.

## Source triage from first pass

| Source | Initial finding | Next action |
|---|---|---|
| Frogfoot official coverage | Public page available; likely JS map with status layers | Playwright network capture and polygon/API extraction spike |
| Vumatel official site | Public site available; coverage likely address/map flow | Playwright network capture; may need address probes |
| Openserve | Public coverage page exists | Playwright capture and address-probe strategy |
| Atomic coverage aggregator | Page contains GeoJSON/polygon/coordinates strings | High-value first extraction candidate |
| 28East Coverage API | Public API documentation discovered | Commercial/API evaluation for address-level feasibility |
| Telcotech Coverage API | Public API product page discovered | Commercial/API evaluation |
| Fibertime | Public site uses map/coverage-related assets | Capture official data; likely needs portal/API probe |
| Net Nine Nine | Public site has polygon/map indicators | Capture official data; low-LSM priority |

## Phasing

### Phase 1: Database foundation
- Add `fno_atlas_operators`
- Add `fno_atlas_sources`
- Add `fno_atlas_ingestion_runs`
- Add `fno_atlas_coverage_areas`
- Add `fno_atlas_project_overlays`

### Phase 2: First genuine polygon ingestion
- Start with a source where polygon data is publicly discoverable, likely Atomic or Frogfoot.
- Run dry-run extraction first.
- Persist only validated polygons with source URL and raw properties.

### Phase 3: Project/drop overlay engine
- Generate project candidate points from `projects` and drop clusters.
- Compute `inside_coverage` and `near_coverage` via PostGIS.
- Add FNO fit scoring and source confidence.

### Phase 4: UI replacement
- Replace static marker map with database-backed polygon layers.
- Keep the current brand-colour legend, but drive it from `fno_atlas_operators`.
- Show source confidence, last ingestion run and overlay evidence.

### Phase 5: Operations
- Scheduled ingestion with source throttling and change detection.
- Alerts when a source schema changes or polygons disappear.
- Manual upload path for non-scrapable / licensed datasets.

## Non-negotiables
- Do not claim coverage unless it comes from a stored source-backed record.
- Do not scrape behind login, CAPTCHA or contractual walls without approval/licence.
- Keep source URL, timestamp and raw evidence for every polygon.
- Treat commercial API terms as procurement/legal review before production use.
