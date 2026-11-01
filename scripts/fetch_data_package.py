#!/usr/bin/env python3
"""Download GitHub Release data package, extract, and merge expression shards."""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import tarfile
import tempfile
from pathlib import Path
from typing import List, Optional
from urllib.request import urlretrieve

SCRIPTS_DIR = Path(__file__).resolve().parent
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

DEFAULT_REPO = "guigolab/rnaget-beacon-demo"
DEFAULT_TAG = "data-latest"
DEFAULT_ASSET = "data-package.tar.zst"
# Refuse absurd single members (tar bomb guard).
_MAX_MEMBER_BYTES = 8 * 1024 * 1024 * 1024  # 8 GiB


def build_arg_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        description="Fetch data-package release, extract, merge expression Parquet"
    )
    p.add_argument(
        "--out",
        type=Path,
        default=None,
        help="Extract directory (default: $DATA_PACKAGE_PATH or data/package)",
    )
    p.add_argument("--repo", default=DEFAULT_REPO, help="GitHub owner/repo")
    p.add_argument("--tag", default=DEFAULT_TAG, help="Release tag")
    p.add_argument("--asset", default=DEFAULT_ASSET, help="Release asset filename")
    p.add_argument(
        "--skip-download",
        action="store_true",
        help="Skip download; merge an already-extracted --out package",
    )
    p.add_argument(
        "--keep-shards",
        action="store_true",
        help="Keep expression/part-*.parquet after merge",
    )
    p.add_argument(
        "--force",
        action="store_true",
        help="Replace a non-empty --out directory (required if --out already exists)",
    )
    return p


def _default_out() -> Path:
    env = os.environ.get("DATA_PACKAGE_PATH", "").strip()
    if env:
        return Path(env)
    return Path("data/package")


def _download_with_gh(repo: str, tag: str, asset: str, dest: Path) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    cmd = [
        "gh",
        "release",
        "download",
        tag,
        "--repo",
        repo,
        "--pattern",
        asset,
        "--dir",
        str(dest.parent),
        "--clobber",
    ]
    print("Running:", " ".join(cmd))
    subprocess.run(cmd, check=True)
    downloaded = dest.parent / asset
    if downloaded.resolve() != dest.resolve():
        if dest.exists():
            dest.unlink()
        downloaded.rename(dest)


def _download_with_https(repo: str, tag: str, asset: str, dest: Path) -> None:
    url = f"https://github.com/{repo}/releases/download/{tag}/{asset}"
    print(f"Downloading {url}")
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(dest.suffix + ".partial")
    try:
        urlretrieve(url, tmp)
        tmp.replace(dest)
    except Exception:
        if tmp.exists():
            tmp.unlink(missing_ok=True)
        raise


def download_asset(repo: str, tag: str, asset: str, dest: Path) -> None:
    if shutil.which("gh"):
        try:
            _download_with_gh(repo, tag, asset, dest)
            return
        except (subprocess.CalledProcessError, FileNotFoundError) as exc:
            print(f"gh download failed ({exc}); falling back to HTTPS…")
    _download_with_https(repo, tag, asset, dest)


def _is_within_directory(directory: Path, target: Path) -> bool:
    try:
        target.resolve().relative_to(directory.resolve())
        return True
    except ValueError:
        return False


def _safe_extract_tar(tf: tarfile.TarFile, dest: Path) -> None:
    """Extract members under dest only (no path traversal / abs paths)."""
    dest = dest.resolve()
    dest.mkdir(parents=True, exist_ok=True)
    for member in tf.getmembers():
        name = member.name
        if not name or name.startswith("/") or name.startswith("\\"):
            raise SystemExit(f"Refusing absolute tar path: {name!r}")
        # Normalize and reject .. segments
        parts = Path(name).parts
        if any(p == ".." for p in parts):
            raise SystemExit(f"Refusing tar path with '..': {name!r}")
        target = (dest / name).resolve()
        if not _is_within_directory(dest, target):
            raise SystemExit(f"Refusing path traversal tar member: {name!r}")
        if member.isreg() and member.size > _MAX_MEMBER_BYTES:
            raise SystemExit(
                f"Refusing oversized tar member {name!r} ({member.size} bytes)"
            )
    # Python 3.12+ supports filter=; older versions rely on pre-checks above.
    try:
        tf.extractall(dest, filter="data")  # type: ignore[call-arg]
    except TypeError:
        tf.extractall(dest)


def _open_tar(archive: Path) -> tuple:
    """Return (TarFile, optional temp path to delete).

    ``.tar.zst`` is decompressed with the ``zstd`` CLI because the stdlib
    tarfile module does not read zstd. ``.tar.xz`` stays supported.
    """
    name = archive.name
    if name.endswith(".tar.zst") or name.endswith(".tzst"):
        if not shutil.which("zstd"):
            raise SystemExit("zstd is required to extract .tar.zst packages")
        tmp = archive.with_name(archive.name + ".tmp")
        if tmp.exists():
            tmp.unlink()
        with tmp.open("wb") as fh:
            subprocess.run(
                ["zstd", "-d", "-c", str(archive)],
                stdout=fh,
                check=True,
            )
        return tarfile.open(tmp, "r:"), tmp
    if name.endswith(".tar.xz") or name.endswith(".txz"):
        return tarfile.open(archive, "r:xz"), None
    return tarfile.open(archive, "r:*"), None


def extract_tarball(archive: Path, out_dir: Path, *, force: bool = False) -> Path:
    """Extract archive into out_dir via staging swap. Returns package root."""
    out_dir = out_dir.resolve()
    if out_dir.exists() and any(out_dir.iterdir()):
        if not force:
            raise SystemExit(
                f"{out_dir} is not empty; pass --force to replace it, "
                "or choose a different --out"
            )
    parent = out_dir.parent
    parent.mkdir(parents=True, exist_ok=True)
    staging = Path(
        tempfile.mkdtemp(prefix=f".{out_dir.name}.staging-", dir=str(parent))
    )
    pkg_staging = staging / "package"
    tar_tmp: Optional[Path] = None
    try:
        tf, tar_tmp = _open_tar(archive)
        try:
            extract_root = staging / "_extract"
            extract_root.mkdir()
            _safe_extract_tar(tf, extract_root)
            candidates = list(extract_root.glob("**/manifest.json"))
            if not candidates:
                raise SystemExit(f"No manifest.json found inside {archive}")
            candidates.sort(key=lambda p: len(p.parts))
            pkg_src = candidates[0].parent
            pkg_staging.mkdir()
            for item in pkg_src.iterdir():
                dest = pkg_staging / item.name
                if item.is_dir():
                    shutil.copytree(item, dest)
                else:
                    shutil.copy2(item, dest)
            if not (pkg_staging / "manifest.json").is_file():
                raise SystemExit(
                    f"Extract failed: missing {pkg_staging / 'manifest.json'}"
                )
        finally:
            tf.close()

        # Atomic-ish swap: move old aside, rename staging package into place.
        backup: Optional[Path] = None
        if out_dir.exists():
            backup = parent / f".{out_dir.name}.bak-{os.getpid()}"
            if backup.exists():
                shutil.rmtree(backup)
            out_dir.rename(backup)
        pkg_staging.rename(out_dir)
        if backup is not None:
            shutil.rmtree(backup, ignore_errors=True)
    finally:
        if tar_tmp is not None:
            tar_tmp.unlink(missing_ok=True)
        shutil.rmtree(staging, ignore_errors=True)

    if not (out_dir / "manifest.json").is_file():
        raise SystemExit(f"Extract failed: missing {out_dir / 'manifest.json'}")
    return out_dir


def _parquet_num_rows(path: Path) -> int:
    import pyarrow.parquet as pq

    meta = pq.ParquetFile(path).metadata
    return int(meta.num_rows) if meta is not None else 0


def _print_summary(package: Path) -> None:
    manifest = json.loads((package / "manifest.json").read_text(encoding="utf-8"))
    print("\nPackage summary")
    print(f"  path: {package}")
    print(f"  profiles: {manifest.get('profiles')}")
    genes = package / "genes.parquet"
    lookup = package / "gene_lookup.parquet"
    if genes.is_file():
        print(f"  genes: {_parquet_num_rows(genes)}")
    if lookup.is_file():
        print(f"  gene_lookup: {_parquet_num_rows(lookup)}")
    for entry in manifest.get("matrices") or []:
        mid = entry.get("matrix_id")
        rows = entry.get("expressionRows") or (entry.get("shards") or {}).get("rows")
        print(f"  matrix {mid}: expressionRows={rows}")


def main(argv: Optional[List[str]] = None) -> int:
    from merge_expression_parquet import merge_package

    args = build_arg_parser().parse_args(argv)
    out = (args.out or _default_out()).resolve()

    if not args.skip_download:
        cache_dir = out.parent / ".download-cache"
        cache_dir.mkdir(parents=True, exist_ok=True)
        archive = cache_dir / args.asset
        download_asset(args.repo, args.tag, args.asset, archive)
        if not archive.is_file():
            raise SystemExit(f"Download failed: missing {archive}")
        print(f"Extracting to {out}")
        extract_tarball(archive, out, force=bool(args.force))
    else:
        if not (out / "manifest.json").is_file():
            raise SystemExit(
                f"--skip-download set but {out}/manifest.json missing"
            )

    print("Merging expression shards…")
    merge_package(out, keep_shards=args.keep_shards)
    print("Building expression stats…")
    from build_expression_stats import build_package as build_stats

    build_stats(out)
    _print_summary(out)
    print(f"\nSet DATA_PACKAGE_PATH={out} for the API.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
