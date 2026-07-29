#!/bin/bash
# Build dr-photo-api from an exact reviewed Git commit, never the working tree.

set -euo pipefail

export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
unset TAR_OPTIONS
unset GIT_DIR GIT_WORK_TREE GIT_OBJECT_DIRECTORY
unset GIT_ALTERNATE_OBJECT_DIRECTORIES GIT_REPLACE_REF_BASE
unset GIT_ATTR_SOURCE
unset GIT_CONFIG_COUNT GIT_CONFIG_PARAMETERS GIT_CONFIG_GLOBAL
unset GIT_CONFIG_SYSTEM GIT_CONFIG_NOSYSTEM
for git_config_var in ${!GIT_CONFIG_KEY_@} ${!GIT_CONFIG_VALUE_@}; do
  unset "$git_config_var"
done
export GIT_NO_REPLACE_OBJECTS=1
export GIT_CONFIG_GLOBAL=/dev/null
export GIT_CONFIG_NOSYSTEM=1
export GIT_ATTR_NOSYSTEM=1

reviewed_sha="${REVIEWED_SHA:?export the approved full Git SHA}"
build_record_dir="${BUILD_RECORD_DIR:?export a new persistent build-record directory}"
record_parent=$(dirname -- "$build_record_dir")

[[ "$reviewed_sha" =~ ^[0-9a-f]{40}$ ]] || {
  echo "ERROR: REVIEWED_SHA must be a full lowercase Git SHA" >&2
  exit 1
}
[[ ! -e "$build_record_dir" && ! -L "$build_record_dir" ]] || {
  echo "ERROR: build-record directory already exists" >&2
  exit 1
}
[[ -d "$record_parent" ]] || {
  echo "ERROR: BUILD_RECORD_DIR parent directory does not exist" >&2
  exit 1
}
[[ ! -L "${BASH_SOURCE[0]}" ]] || {
  echo "ERROR: reviewed image builder must not be a symlink" >&2
  exit 1
}

source_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
repo_root=$(git -C "$source_dir/../.." rev-parse --show-toplevel)
git -C "$repo_root" cat-file -e "${reviewed_sha}^{commit}"

expected_builder_blob=$(git -C "$repo_root" rev-parse \
  "${reviewed_sha}:scripts/dr-photo-api/build-reviewed-image.sh")
actual_builder_blob=$(git -C "$repo_root" hash-object "${BASH_SOURCE[0]}")
[[ "$actual_builder_blob" == "$expected_builder_blob" ]] || {
  echo "ERROR: running builder is not the reviewed commit's builder" >&2
  exit 1
}

build_root=$(mktemp -d)
record_stage=$(mktemp -d "$record_parent/.dr-photo-build-record.XXXXXX")
cleanup() {
  rm -rf -- "$build_root"
  if [[ -n "$record_stage" ]]; then
    rm -rf -- "$record_stage"
  fi
}
trap cleanup EXIT
mkdir "$build_root/test" "$build_root/context"

extract_reviewed_source() {
  local destination="$1"
  git -C "$repo_root" -c core.attributesFile=/dev/null \
    archive --format=tar "$reviewed_sha" scripts/dr-photo-api |
    tar --no-same-owner --no-same-permissions \
      -x -C "$destination" --strip-components=2
}

verify_archive_manifest() {
  local source_root="$1" expected_manifest actual_manifest
  local metadata path mode type object relative_path actual_mode actual_object
  local symlink_target
  expected_manifest=$(mktemp "$build_root/expected.XXXXXX")
  actual_manifest=$(mktemp "$build_root/actual.XXXXXX")

  while IFS=$'\t' read -r metadata path; do
    read -r mode type object <<< "$metadata"
    [[ "$type" == "blob" ]] || {
      echo "ERROR: unexpected non-blob archive entry: $path" >&2
      exit 1
    }
    relative_path=${path#scripts/dr-photo-api/}
    printf '%s %s %s\n' "$mode" "$object" "$relative_path"
  done < <(git -C "$repo_root" ls-tree -r "$reviewed_sha" -- scripts/dr-photo-api) |
    LC_ALL=C sort > "$expected_manifest"

  while IFS= read -r -d '' path; do
    relative_path=${path#"$source_root/"}
    if [[ -L "$path" ]]; then
      actual_mode=120000
      symlink_target=$(readlink -- "$path")
      actual_object=$(printf '%s' "$symlink_target" |
        git -C "$repo_root" hash-object --stdin)
    else
      actual_mode=100644
      [[ -x "$path" ]] && actual_mode=100755
      actual_object=$(git -C "$repo_root" hash-object "$path")
    fi
    printf '%s %s %s\n' "$actual_mode" "$actual_object" "$relative_path"
  done < <(find "$source_root" \( -type f -o -type l \) -print0) |
    LC_ALL=C sort > "$actual_manifest"

  cmp -s "$expected_manifest" "$actual_manifest" || {
    echo "ERROR: extracted archive does not exactly match the reviewed tree" >&2
    exit 1
  }
}

extract_reviewed_source "$build_root/test"
verify_archive_manifest "$build_root/test"
python3 "$build_root/test/tests/test_safe_paths.py"
python3 "$build_root/test/tests/test_onemap_parent_resolver.py"
python3 -m compileall -q \
  "$build_root/test/agents" "$build_root/test/api" "$build_root/test/lib"

# Tests generate bytecode, so build from a second pristine extraction.
extract_reviewed_source "$build_root/context"
verify_archive_manifest "$build_root/context"

image_tag="boss-vps-dr-photo-api:${reviewed_sha}"
docker build --pull \
  --iidfile "$build_root/image.iid" \
  -t "$image_tag" \
  "$build_root/context"

expected_image_id=$(sed -n '1p' "$build_root/image.iid")
actual_image_id=$(docker image inspect "$image_tag" --format '{{.Id}}')
[[ "$actual_image_id" == "$expected_image_id" ]] || {
  echo "ERROR: built tag does not match Docker's image-ID record" >&2
  exit 1
}

forbidden_artifact=$(docker run --rm "$expected_image_id" sh -c \
  'find /app/agents /app/api /app/lib \( -type d -name __pycache__ -o -type f \( -name "*.pyc" -o -name ".env*" -o -name "*.bak" \) \) -print -quit')
if [[ -n "$forbidden_artifact" ]]; then
  echo "ERROR: forbidden ignored/local artifact entered the image" >&2
  exit 1
fi

install -m 600 "$build_root/image.iid" "$record_stage/image.iid"
install -m 600 "$build_root/context/compose.example.yml" "$record_stage/compose.yml"
printf '%s\n' "$reviewed_sha" > "$record_stage/source.sha"

mv -Tn -- "$record_stage" "$build_record_dir"
[[ ! -d "$record_stage" ]] || {
  echo "ERROR: build-record directory appeared during publication" >&2
  exit 1
}
record_stage=""
echo "source=${reviewed_sha} image=${expected_image_id} record=${build_record_dir}"
