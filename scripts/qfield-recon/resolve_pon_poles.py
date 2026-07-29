#!/usr/bin/env python3
"""Resolve pole->PON for a QFieldCloud project from its design GeoPackages.

Reads the project's verified PON polygons and pole points from MinIO via
``mc cat``, spatially joins poles within PON polygons, and emits:
  {"available": true, "designPons": [..], "poleToPon": {"MOA.P.X": {"pon": N, "zone": "Z"}}}
Read-only. Never writes to MinIO or the DB. On any missing layer -> available:false.
"""
import json, subprocess, sys, tempfile, os, warnings
warnings.filterwarnings("ignore")

BUCKET = os.environ.get("MINIO_BUCKET", "qfieldcloud-prod")

# Mohadin remains the default because this resolver originally backed its
# reconciliation report. Mahikeng's verified design uses matching pole labels
# in MahikengPoles and PON polygons in PON Progress V2.
DEFAULT_LAYOUT = {
    "pons_file": "MOAPons.gpkg",
    "poles_file": "MOAPoles.gpkg",
    "pon_col": "dp",
    "pole_label_col": "label",
    "zone_col": "zone",
}
PROJECT_LAYOUTS = {
    "e801cd43-7efe-4f7a-bed5-ee0410f3dfd6": {
        "pons_file": "PON Progress V2.gpkg",
        "poles_file": "MahikengPoles.gpkg",
        "pon_col": "Pond",
        "pole_label_col": "Name",
        "zone_col": None,
    },
}


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

def _to_int(v) -> int | None:
    try:
        return int(float(v))
    except (TypeError, ValueError):
        return None

def main() -> int:
    project_id = sys.argv[sys.argv.index("--project-id") + 1]
    layout = PROJECT_LAYOUTS.get(project_id, DEFAULT_LAYOUT)
    import geopandas as gpd
    import pandas as pd
    with tempfile.TemporaryDirectory() as tmp:
        out = {"available": False, "designPons": [], "poleToPon": {}}
        pons_v = latest_version(project_id, layout["pons_file"])
        poles_v = latest_version(project_id, layout["poles_file"])
        if not pons_v or not poles_v:
            print(json.dumps(out)); return 0
        pons_p, poles_p = f"{tmp}/pons.gpkg", f"{tmp}/poles.gpkg"
        base = f"projects/{project_id}/files"
        if not mc_cat(f"{base}/{layout['pons_file']}/{pons_v}", pons_p): print(json.dumps(out)); return 0
        if not mc_cat(f"{base}/{layout['poles_file']}/{poles_v}", poles_p): print(json.dumps(out)); return 0
        pons = gpd.read_file(pons_p)
        poles = gpd.read_file(poles_p).to_crs(pons.crs)
        design_pons = sorted({
            n for n in (_to_int(v) for v in pons[layout["pon_col"]] if pd.notna(v)) if n is not None
        })
        joined = gpd.sjoin(
            poles,
            pons[[layout["pon_col"], "geometry"]],
            predicate="within",
            how="inner",
        )
        pole_to_pon = {}
        for _, row in joined.iterrows():
            label = row.get(layout["pole_label_col"])
            dp = row.get(layout["pon_col"])
            if pd.isna(label) or pd.isna(dp):
                continue
            pon = _to_int(dp)
            if pon is None:
                continue
            zone_col = layout["zone_col"]
            zone = row.get(zone_col) if zone_col else None
            pole_to_pon[str(label)] = {"pon": pon, "zone": None if pd.isna(zone) else str(zone)}
        print(json.dumps({"available": True, "designPons": design_pons, "poleToPon": pole_to_pon}))
    return 0

if __name__ == "__main__":
    sys.exit(main())
