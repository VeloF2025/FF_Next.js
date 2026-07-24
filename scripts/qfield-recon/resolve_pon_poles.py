#!/usr/bin/env python3
"""Resolve pole->PON for a QFieldCloud project from its design GeoPackages.

Reads MOAPons (PON polygons, field 'dp') and MOAPoles (pole points, 'label')
from MinIO via `mc cat`, spatially joins poles within PON polygons, and emits:
  {"available": true, "designPons": [..], "poleToPon": {"MOA.P.X": {"pon": N, "zone": "Z"}}}
Read-only. Never writes to MinIO or the DB. On any missing layer -> available:false.
"""
import json, subprocess, sys, tempfile, os, warnings
warnings.filterwarnings("ignore")

BUCKET = os.environ.get("MINIO_BUCKET", "qfieldcloud-prod")

def mc_cat(object_path: str, dest: str) -> bool:
    r = subprocess.run(
        ["docker", "exec", "qfieldcloud-minio-1", "mc", "cat", f"local/{BUCKET}/{object_path}"],
        capture_output=True)
    if r.returncode != 0 or not r.stdout:
        return False
    with open(dest, "wb") as f:
        f.write(r.stdout)
    return True

def latest_version(project_id: str, filename: str) -> str | None:
    # List versions under the file prefix; pick the lexically-last (timestamped) key.
    prefix = f"local/{BUCKET}/projects/{project_id}/files/{filename}/"
    r = subprocess.run(["docker", "exec", "qfieldcloud-minio-1", "mc", "ls", "--recursive", prefix],
                       capture_output=True, text=True)
    versions = [ln.strip().split()[-1] for ln in r.stdout.splitlines() if ln.strip()]
    return sorted(versions)[-1] if versions else None

def main() -> int:
    project_id = sys.argv[sys.argv.index("--project-id") + 1]
    import geopandas as gpd
    with tempfile.TemporaryDirectory() as tmp:
        out = {"available": False, "designPons": [], "poleToPon": {}}
        pons_v = latest_version(project_id, "MOAPons.gpkg")
        poles_v = latest_version(project_id, "MOAPoles.gpkg")
        if not pons_v or not poles_v:
            print(json.dumps(out)); return 0
        pons_p, poles_p = f"{tmp}/pons.gpkg", f"{tmp}/poles.gpkg"
        base = f"projects/{project_id}/files"
        if not mc_cat(f"{base}/MOAPons.gpkg/{pons_v}", pons_p): print(json.dumps(out)); return 0
        if not mc_cat(f"{base}/MOAPoles.gpkg/{poles_v}", poles_p): print(json.dumps(out)); return 0
        pons = gpd.read_file(pons_p)
        poles = gpd.read_file(poles_p).to_crs(pons.crs)
        design_pons = sorted({int(v) for v in pons["dp"].dropna() if str(v).strip().isdigit()})
        joined = gpd.sjoin(poles, pons[["dp", "geometry"]], predicate="within", how="inner")
        pole_to_pon = {}
        for _, row in joined.iterrows():
            label = row.get("label")
            dp = row.get("dp")
            if not label or dp is None or not str(dp).strip().isdigit():
                continue
            zone = row.get("zone")
            pole_to_pon[str(label)] = {"pon": int(dp), "zone": None if zone is None else str(zone)}
        print(json.dumps({"available": True, "designPons": design_pons, "poleToPon": pole_to_pon}))
    return 0

if __name__ == "__main__":
    sys.exit(main())
