#!/usr/bin/env bash
# Fetch + prepare the data package on a production host without installing
# Python libs into the system interpreter. Runs scripts/fetch_data_package.py
# inside a one-shot container.
#
# Usage (from repo root or anywhere):
#   ./scripts/fetch_data_package_docker.sh
#   ./scripts/fetch_data_package_docker.sh --force-stats
#   DATA_PACKAGE_OUT=/data/rnaget-demo ./scripts/fetch_data_package_docker.sh
#
# Defaults match docker-compose.yml: host path /data/rnaget-demo.
# Mounts the parent of --out (e.g. /data) so extract can rename the package
# dir on NFS; do not point --out at an NFS mount root itself.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="${DATA_PACKAGE_OUT:-/data/rnaget-demo}"
IMAGE="${FETCH_PYTHON_IMAGE:-python:3.12-slim}"

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  cat <<EOF
Usage: $(basename "$0") [fetch_data_package.py args...]

Runs fetch_data_package.py in Docker (zstd + pyarrow + duckdb).
Default: --out ${OUT} --force
Extra args are appended (e.g. --force-stats, --skip-download, --tag …).

Env:
  DATA_PACKAGE_OUT     Host output directory (default: /data/rnaget-demo)
  FETCH_PYTHON_IMAGE   Python image (default: python:3.12-slim)
  DUCKDB_TEMP_DIR      DuckDB spill dir (default: <out parent>/.duckdb_tmp_<out name>)
  DUCKDB_MEMORY_LIMIT  DuckDB memory cap (default: 512MB)
EOF
  exit 0
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "error: docker is required" >&2
  exit 1
fi

if [[ ! -f "${ROOT}/scripts/fetch_data_package.py" ]]; then
  echo "error: fetch_data_package.py not found under ${ROOT}/scripts" >&2
  exit 1
fi

# Resolve absolute out path; mount its parent so OUT itself is not a bind mount.
case "${OUT}" in
  /*) OUT_ABS="${OUT}" ;;
  *) OUT_ABS="$(cd "${ROOT}" && realpath -m "${OUT}")" ;;
esac
OUT_PARENT="$(dirname "${OUT_ABS}")"
OUT_NAME="$(basename "${OUT_ABS}")"

if [[ "${OUT_PARENT}" == "/" ]]; then
  echo "error: refuse --out at filesystem root (${OUT_ABS}); use a subdirectory" >&2
  exit 1
fi

# DuckDB defaults its spill dir to ./.tmp; the repo is mounted read-only at /work,
# so point it at a writable location next to the output (beside, not inside, OUT).
DUCKDB_TEMP_DIR="${DUCKDB_TEMP_DIR:-${OUT_PARENT}/.duckdb_tmp_${OUT_NAME}}"

mkdir -p "${OUT_ABS}" "${DUCKDB_TEMP_DIR}"

echo "Fetching data package into ${OUT_ABS} via ${IMAGE}…"
docker run --rm \
  -e PIP_ROOT_USER_ACTION=ignore \
  -e PIP_DISABLE_PIP_VERSION_CHECK=1 \
  -e DUCKDB_TEMP_DIR="${DUCKDB_TEMP_DIR}" \
  -e DUCKDB_MEMORY_LIMIT \
  -e DUCKDB_THREADS \
  -v "${ROOT}:/work:ro" \
  -v "${OUT_PARENT}:${OUT_PARENT}" \
  -w /work \
  "${IMAGE}" \
  bash -c '
    set -euo pipefail
    apt-get update -qq
    apt-get install -y -qq --no-install-recommends zstd >/dev/null
    pip install --no-cache-dir "pyarrow>=14.0,<20" "duckdb>=1.1,<2"
    python scripts/fetch_data_package.py --out "$1" --force "${@:2}"
  ' bash "${OUT_ABS}" "$@"

rm -rf "${DUCKDB_TEMP_DIR}" 2>/dev/null || true

echo
echo "Done. Package ready at ${OUT_ABS}"
echo "Compose expects:  ${OUT_ABS}  mounted at /data/package (see docker-compose.yml)"
echo "Next:  docker compose up --build -d"
