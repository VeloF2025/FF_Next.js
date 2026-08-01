"""
The per-row ingest — walking a GPKG's rows and upserting each photo reference.

The last stage of extract_project, and the one that does the actual work: for every
row, for every photo column, resolve the file to a storage key, drop it if it is
already ingested or not yet uploaded, and insert it.

Split out of extract-gpkg-photos.py, which this brings under the 300-line limit.

Two near-identical loops live here — one over numbered civil/optical step columns, one
over extra photo columns that carry no step. They differ in what they write for
checklist_step/step_label/feature_type/work_type, and the extra-column loop carries a
`col not in row.keys()` guard the step loop does not (structurally dead today: both
column lists derive from the same table.columns). Deliberately NOT merged in this
change: this is a move, provable byte-identical against the golden capture, and folding
them together is a behaviour-risk refactor that deserves its own diff and its own
review.

IMPORTANT for tests: minio_resolve_photo_version is imported here BY NAME, and the
call resolves in THIS module's namespace. qfield_patchkit patches by object identity
across every loaded scripts/ module, so that keeps working without registration — but
read its docstring before adding a new patched dependency here, because attribute
patching cannot see a renamed capture-by-value and the backstop is a per-name
stub_calls assertion, not the machinery.
"""
import uuid

from qfield_photo_storage import minio_resolve_photo_version
from qfield_step_detection import is_photo_value


def ingest_rows(cur, qf_id, table, combined_dcim, existing_keys, existing_filenames,
                existing_photo_keys, dry_run):
    """Upsert every photo referenced by the GPKG's rows.

    Returns (photos_found, photos_upserted, photos_skipped_missing). The caller records
    photos_skipped_missing as pending_count so the next run re-scans an unchanged GPKG
    whose binaries had not finished uploading.

    existing_keys / existing_filenames are MUTATED as rows are ingested — that is what
    stops the same photo being inserted twice within a single run, since there is no
    UNIQUE constraint on photo_key.
    """
    rows = table.rows
    label_col, step_cols, extra_cols = table.label_col, table.step_cols, table.extra_cols
    photos_found = 0
    photos_upserted = 0
    photos_skipped_missing = 0

    def _resolve_key(dcim_path):
        """Return (storage_key, resolved_qf_id, upload_status) for a DCIM-relative path.

        Looks up the combined index across all linked QField projects (primary
        first) so photos uploaded to an "audit" QField project linked to the
        same FibreFlow project are resolved correctly. `resolved_qf_id` is the
        QField project where the blob actually lives — used as the row's
        `project_id` in qfield_photo_validations so future syncs find it.
        """
        filename = dcim_path.replace("DCIM/", "").lstrip("/")
        if combined_dcim:
            entry = combined_dcim.get(filename)
            if entry:
                resolved_qf_id, versioned = entry
                return versioned, resolved_qf_id, "available"
            # File referenced in GPKG but absent from every linked MinIO bucket
            return f"projects/{qf_id}/files/{dcim_path}", qf_id, "pending_upload"
        # Batch listing failed — fall back to individual resolution against primary
        versioned = minio_resolve_photo_version(qf_id, dcim_path)
        if versioned:
            return versioned, qf_id, "available"
        return f"projects/{qf_id}/files/{dcim_path}", qf_id, "pending_upload"

    for row in rows:
        feature_id = row[label_col] if label_col in row.keys() else None
        if not feature_id:
            continue
        feature_id = str(feature_id).strip()
        if not feature_id:
            continue

        # Collect photos from step columns
        for col, (step, step_label, discipline) in step_cols.items():
            val = row[col]
            if not is_photo_value(val):
                continue

            dcim_path = str(val).strip()
            photos_found += 1

            full_key, resolved_qf_id, upload_status = _resolve_key(dcim_path)

            if upload_status == "pending_upload":
                print(f"    SKIP (not in MinIO): {dcim_path}")
                photos_skipped_missing += 1
                continue

            # Skip if already in DB (either validations or photos table)
            base_fn = dcim_path.replace("DCIM/", "").lstrip("/")
            if full_key in existing_keys:
                continue
            # Filename-based dedup: catches versioned vs unversioned key mismatches
            if base_fn in existing_filenames:
                continue
            # Check by filename match in existing construction_qa_photos
            if any(base_fn in k for k in existing_photo_keys):
                continue

            if dry_run:
                photos_upserted += 1
                continue

            # Upsert into qfield_photo_validations — use resolved_qf_id so
            # the row points at the QField project where the blob actually
            # lives. Without this, photos hosted in an audit project would
            # be recorded as if owned by the primary project.
            cur.execute("""
                INSERT INTO qfield_photo_validations
                (id, photo_key, feature_id, feature_type, work_type, project_id,
                 checklist_step, step_label, created_at)
                VALUES (%s, %s, %s, %s, %s, %s::uuid, %s, %s, NOW())
                ON CONFLICT (id) DO NOTHING
            """, (
                str(uuid.uuid4()), full_key, feature_id,
                "joint" if discipline == "optical" else "pole",
                "dome_joint" if discipline == "optical" else "pole_installation",
                resolved_qf_id,
                step, step_label,
            ))
            existing_keys.add(full_key)
            existing_filenames.add(base_fn)
            photos_upserted += 1

        # Extra photo columns (no step)
        for col in extra_cols:
            if col not in row.keys():
                continue
            val = row[col]
            if not is_photo_value(val):
                continue

            dcim_path = str(val).strip()
            photos_found += 1

            full_key, resolved_qf_id, upload_status = _resolve_key(dcim_path)

            if upload_status == "pending_upload":
                print(f"    SKIP (not in MinIO): {dcim_path}")
                photos_skipped_missing += 1
                continue

            base_fn = dcim_path.replace("DCIM/", "").lstrip("/")
            if full_key in existing_keys:
                continue
            if base_fn in existing_filenames:
                continue
            if any(base_fn in k for k in existing_photo_keys):
                continue

            if dry_run:
                photos_upserted += 1
                continue

            cur.execute("""
                INSERT INTO qfield_photo_validations
                (id, photo_key, feature_id, feature_type, work_type, project_id,
                 checklist_step, step_label, created_at)
                VALUES (%s, %s, %s, %s, %s, %s::uuid, %s, %s, NOW())
                ON CONFLICT (id) DO NOTHING
            """, (
                str(uuid.uuid4()), full_key, feature_id,
                "pole", "pole_installation", resolved_qf_id,
                None, None,
            ))
            existing_keys.add(full_key)
            existing_filenames.add(base_fn)
            photos_upserted += 1

    if photos_skipped_missing:
        print(f"  Skipped {photos_skipped_missing} photos not yet uploaded to MinIO")

    return photos_found, photos_upserted, photos_skipped_missing
