#!/usr/bin/env python3
"""Stream matrix annotation GTF/GFFs and write package-level gene catalogs."""

from __future__ import annotations

import argparse
import gzip
import io
import json
import re
import sys
import traceback
from collections import defaultdict
from pathlib import Path
from typing import Any, Dict, Iterable, Iterator, List, Optional, Set, Tuple

SCRIPTS_DIR = Path(__file__).resolve().parent
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

from parsers.base import CACHE_DIR, download_file  # noqa: E402

SO_GENE = ("SO:0000704", "gene")


def _is_gene_like_feature_type(ftype: str) -> bool:
    """Keep gene-level GFF/GTF rows (not transcript/exon/CDS)."""
    t = (ftype or "").lower()
    if t in ("gene", "pseudogene"):
        return True
    if t.endswith("_gene"):
        return True
    if t.endswith("gene_segment"):
        return True
    return False

# GTF: key "value";  GFF3: key=value;
_GTF_ATTR_RE = re.compile(r'(\w+)\s+"([^"]*)"')
_GFF_ATTR_RE = re.compile(r"([^=;\s]+)=([^;]*)")


def build_arg_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        description="Hydrate gene-level genomic features from annotation GTF/GFFs"
    )
    p.add_argument(
        "--package",
        type=Path,
        required=True,
        help="Path to data-package directory",
    )
    p.add_argument(
        "--cache-dir",
        type=Path,
        default=None,
        help="Download cache (default: scripts/.cache)",
    )
    p.add_argument(
        "--skip-download",
        action="store_true",
        help="Fail if annotation file is not already cached",
    )
    p.add_argument("--verbose", action="store_true")
    return p


def _unversion(feature_id: str) -> str:
    return feature_id.split(".", 1)[0]


def _open_text(path: Path):
    name = path.name.lower()
    if name.endswith(".gz"):
        return io.TextIOWrapper(gzip.open(path, "rb"), encoding="utf-8", errors="replace")
    return path.open("r", encoding="utf-8", errors="replace")


def _parse_attrs(attr_field: str, *, gff3: bool) -> Dict[str, List[str]]:
    out: Dict[str, List[str]] = defaultdict(list)
    if gff3:
        for key, val in _GFF_ATTR_RE.findall(attr_field):
            out[key].append(val.strip())
    else:
        for key, val in _GTF_ATTR_RE.findall(attr_field):
            out[key].append(val)
    return out


def _strand_label(raw: str) -> Optional[str]:
    if raw == "+":
        return "positive"
    if raw == "-":
        return "negative"
    return None


def _normalize_xrefs(raw_values: Iterable[str]) -> List[str]:
    """Turn db_xref / Dbxref tokens into CURIE-ish strings."""
    curies: List[str] = []
    seen: Set[str] = set()
    for raw in raw_values:
        for part in re.split(r"[,|]", raw):
            token = part.strip()
            if not token:
                continue
            # GeneID:7157 / NCBI_Gene:7157 / HGNC:11998 / Ensembl:ENSG...
            if ":" in token:
                prefix, rest = token.split(":", 1)
                prefix_l = prefix.lower().replace("_", "")
                if prefix_l in ("geneid", "ncbigene", "ncbigeneid"):
                    curie = f"NCBIGene:{rest}"
                elif prefix_l == "hgnc":
                    curie = f"HGNC:{rest}" if not rest.upper().startswith("HGNC:") else rest
                elif prefix_l in ("ensembl", "ensemblgene"):
                    curie = f"ENSEMBL:{rest}"
                else:
                    curie = token
            else:
                curie = token
            if curie not in seen:
                seen.add(curie)
                curies.append(curie)
    return curies


def _gene_id_from_attrs(attrs: Dict[str, List[str]], *, gff3: bool) -> Optional[str]:
    if not gff3:
        vals = attrs.get("gene_id") or []
        return vals[0] if vals else None

    # NCBI / GFF3: prefer GeneID from Dbxref; else ID / gene_id / Name
    for key in ("Dbxref", "dbxref", "Dbxrefs"):
        for raw in attrs.get(key) or []:
            for part in re.split(r"[,|]", raw):
                part = part.strip()
                if part.lower().startswith("geneid:"):
                    return part.split(":", 1)[1].strip()
    for key in ("gene_id", "geneID", "ID", "locus_tag"):
        vals = attrs.get(key) or []
        if vals:
            # ID=gene-BRCA1 → still try Dbxref first; fall back to Name numeric later
            candidate = vals[0]
            if candidate.isdigit():
                return candidate
            if candidate.lower().startswith("gene-") and len(vals) == 1:
                continue
            if key == "gene_id":
                return candidate
    return None


def _symbol_aliases(attrs: Dict[str, List[str]], *, gff3: bool) -> Tuple[Optional[str], List[str]]:
    symbol: Optional[str] = None
    aliases: List[str] = []
    if gff3:
        for key in ("Name", "gene", "gene_name"):
            vals = attrs.get(key) or []
            if vals and not symbol:
                symbol = vals[0]
        for key in ("gene_synonym", "Alias"):
            for v in attrs.get(key) or []:
                for part in re.split(r"[,|]", v):
                    part = part.strip()
                    if part:
                        aliases.append(part)
    else:
        for key in ("gene_name", "gene"):
            vals = attrs.get(key) or []
            if vals and not symbol:
                symbol = vals[0]
        for v in attrs.get("gene_synonym") or []:
            for part in re.split(r"[,|]", v):
                part = part.strip()
                if part:
                    aliases.append(part)
    # Dedupe aliases; drop if equal to symbol
    seen: Set[str] = set()
    clean: List[str] = []
    for a in aliases:
        if symbol and a == symbol:
            continue
        if a not in seen:
            seen.add(a)
            clean.append(a)
    return symbol, clean


def iter_gene_records(path: Path) -> Iterator[Dict[str, Any]]:
    """Yield gene-level records from a GTF or GFF3 annotation file."""
    name = path.name.lower()
    # Prefer extension; NCBI genomic.gff.gz is GFF3; gencode *.gtf.gz is GTF.
    gff3 = ".gff" in name and ".gtf" not in name
    with _open_text(path) as fh:
        for line in fh:
            if not line or line.startswith("#"):
                continue
            parts = line.rstrip("\n").split("\t")
            if len(parts) < 9:
                continue
            chrom, _src, ftype, start_s, end_s, _score, strand_s, _phase, attrs_s = parts[:9]
            ftype_l = ftype.lower()
            if not _is_gene_like_feature_type(ftype_l):
                continue
            attrs = _parse_attrs(attrs_s, gff3=gff3)
            gene_id = _gene_id_from_attrs(attrs, gff3=gff3)
            if not gene_id:
                continue
            try:
                start = int(start_s)
                end = int(end_s)
            except ValueError:
                continue
            if start > end:
                start, end = end, start
            symbol, aliases = _symbol_aliases(attrs, gff3=gff3)
            xref_raw: List[str] = []
            for key in ("db_xref", "Dbxref", "dbxref", "Dbxrefs"):
                xref_raw.extend(attrs.get(key) or [])
            xrefs = _normalize_xrefs(xref_raw)
            if gff3 and gene_id.isdigit():
                ncbi = f"NCBIGene:{gene_id}"
                if ncbi not in xrefs:
                    xrefs.insert(0, ncbi)
            yield {
                "gene_id": gene_id,
                "symbol": symbol,
                "aliases": aliases,
                "xrefs": xrefs,
                "chrom": chrom,
                "start": start,
                "end": end,
                "strand": _strand_label(strand_s),
                "feature_type": ftype_l,
            }


def _load_matrix_feature_ids(features_path: Path) -> List[str]:
    import pyarrow.parquet as pq

    table = pq.read_table(features_path, columns=["feature_id"])
    return [str(x) for x in table.column("feature_id").to_pylist() if x is not None]


def _safe_matrix_dirname(matrix_id: str) -> str:
    return "".join(c if c.isalnum() or c in "-_." else "_" for c in matrix_id)


def _resource_for_annotation(source: str) -> str:
    src = (source or "").lower()
    if src in ("gencode", "ensembl"):
        return src
    if src in ("ncbigene", "refseq", "ncbi"):
        return "ncbigene"
    return src or "local"


def _match_needed(
    gene_id: str,
    needed_exact: Set[str],
    needed_unversioned: Dict[str, List[str]],
) -> List[str]:
    """Return matrix feature_ids that this annotation gene_id covers."""
    if gene_id in needed_exact:
        return [gene_id]
    uv = _unversion(gene_id)
    hits = needed_unversioned.get(uv) or needed_unversioned.get(gene_id)
    if hits:
        return list(hits)
    # Annotation unversioned, matrix versioned already covered by needed_unversioned.
    # Annotation versioned, matrix unversioned (rare for GEO):
    if uv != gene_id and uv in needed_exact:
        return [uv]
    return []


def hydrate_package(
    package: Path,
    *,
    cache_dir: Path,
    skip_download: bool = False,
) -> Dict[str, Any]:
    import pyarrow as pa
    import pyarrow.parquet as pq

    matrices_path = package / "matrices.json"
    manifest_path = package / "manifest.json"
    if not matrices_path.is_file():
        raise SystemExit(f"Missing {matrices_path}")
    if not manifest_path.is_file():
        raise SystemExit(f"Missing {manifest_path}")

    with matrices_path.open(encoding="utf-8") as fh:
        matrices: List[Dict[str, Any]] = json.load(fh)
    with manifest_path.open(encoding="utf-8") as fh:
        manifest: Dict[str, Any] = json.load(fh)

    # Resolve matrix dir from manifest when present.
    dir_by_id = {
        e["matrix_id"]: e["dir"]
        for e in (manifest.get("matrices") or [])
        if e.get("matrix_id") and e.get("dir")
    }

    # Group matrices by annotation file.
    groups: Dict[Tuple[str, str, str], List[Dict[str, Any]]] = defaultdict(list)
    matrix_meta: Dict[str, Dict[str, Any]] = {}

    for m in matrices:
        mid = m.get("matrixId")
        if not mid:
            raise SystemExit("matrices.json entry missing matrixId")
        ann = m.get("annotation") or {}
        url = ann.get("file")
        source = ann.get("source") or ""
        version = str(ann.get("version") or "")
        if not url:
            raise SystemExit(f"matrix {mid}: annotation.file required for hydration")
        dirname = dir_by_id.get(mid) or _safe_matrix_dirname(mid)
        feat_path = package / "matrices" / dirname / "features.parquet"
        if not feat_path.is_file():
            raise SystemExit(f"matrix {mid}: missing {feat_path}")
        feature_ids = _load_matrix_feature_ids(feat_path)
        meta = {
            "matrix_id": mid,
            "dir": dirname,
            "features_path": feat_path,
            "feature_ids": feature_ids,
            "annotation_file": url,
            "annotation_source": source,
            "annotation_version": version,
            "resource": _resource_for_annotation(source),
        }
        matrix_meta[mid] = meta
        groups[(url, source, version)].append(meta)

    # genes keyed by (source, version, feature_id)
    genes: Dict[Tuple[str, str, str], Dict[str, Any]] = {}
    # Unique feature_ids hydrated per matrix (not raw GFF row counts).
    hits_per_matrix: Dict[str, Set[str]] = defaultdict(set)

    for (url, source, version), members in groups.items():
        print(f"Hydrating annotation source={source} version={version}")
        print(f"  file={url}")
        path = download_file(
            url,
            cache_dir=cache_dir,
            skip_download=skip_download,
            timeout=(30, 1200),
        )
        print(f"  cached={path.name} ({path.stat().st_size / 1e6:.1f} MB)")

        needed_exact: Set[str] = set()
        needed_unversioned: Dict[str, List[str]] = defaultdict(list)
        feature_to_matrices: Dict[str, Set[str]] = defaultdict(set)
        resource = members[0]["resource"]

        for mem in members:
            mid = mem["matrix_id"]
            for fid in mem["feature_ids"]:
                needed_exact.add(fid)
                needed_unversioned[_unversion(fid)].append(fid)
                feature_to_matrices[fid].add(mid)
        # Dedupe unversioned lists
        needed_unversioned = {k: sorted(set(v)) for k, v in needed_unversioned.items()}

        matched_genes = 0
        scanned = 0
        for rec in iter_gene_records(path):
            scanned += 1
            matched_ids = _match_needed(rec["gene_id"], needed_exact, needed_unversioned)
            if not matched_ids:
                continue
            matched_genes += 1
            for fid in matched_ids:
                key = (source, version, fid)
                matrix_ids = sorted(feature_to_matrices.get(fid) or [])
                for mid in matrix_ids:
                    hits_per_matrix[mid].add(fid)
                existing = genes.get(key)
                if existing is None:
                    genes[key] = {
                        "feature_id": fid,
                        "feature_id_unversioned": _unversion(fid),
                        "resource": resource,
                        "annotation_source": source,
                        "annotation_version": version,
                        "annotation_file": url,
                        "symbol": rec["symbol"],
                        "aliases": list(rec["aliases"]),
                        "xrefs": list(rec["xrefs"]),
                        "feature_type_id": SO_GENE[0],
                        "feature_type_label": SO_GENE[1],
                        "chrom": rec["chrom"],
                        "start": rec["start"],
                        "end": rec["end"],
                        "strand": rec["strand"],
                        "matrix_ids": matrix_ids,
                    }
                else:
                    # Merge matrix_ids / aliases / xrefs if same gene seen again
                    merged_m = sorted(set(existing["matrix_ids"]) | set(matrix_ids))
                    existing["matrix_ids"] = merged_m
                    if not existing.get("symbol") and rec["symbol"]:
                        existing["symbol"] = rec["symbol"]
                    existing["aliases"] = list(
                        dict.fromkeys((existing.get("aliases") or []) + list(rec["aliases"]))
                    )
                    existing["xrefs"] = list(
                        dict.fromkeys((existing.get("xrefs") or []) + list(rec["xrefs"]))
                    )

        print(f"  scanned_gene_rows={scanned} matched_annotation_genes={matched_genes}")

    for mid, meta in matrix_meta.items():
        n_features = len(meta["feature_ids"])
        n_hits = len(hits_per_matrix.get(mid) or ())
        coverage = (n_hits / n_features) if n_features else 0.0
        print(
            f"  matrix {mid}: hydrated_unique_features={n_hits}/{n_features} "
            f"({coverage:.1%})"
        )

    gene_rows = list(genes.values())
    lookup_rows: List[Dict[str, Any]] = []
    lookup_seen: Set[Tuple[str, str, str, str, str]] = set()

    def add_lookup(
        key: str,
        kind: str,
        feature_id: str,
        resource: str,
        source: str,
        version: str,
    ) -> None:
        if not key:
            return
        sig = (key, kind, feature_id, source, version)
        if sig in lookup_seen:
            return
        lookup_seen.add(sig)
        lookup_rows.append(
            {
                "lookup_key": key,
                "lookup_kind": kind,
                "feature_id": feature_id,
                "resource": resource,
                "annotation_source": source,
                "annotation_version": version,
            }
        )

    for g in gene_rows:
        fid = g["feature_id"]
        src = g["annotation_source"]
        ver = g["annotation_version"]
        res = g["resource"]
        add_lookup(fid, "feature_id", fid, res, src, ver)
        uv = g["feature_id_unversioned"]
        if uv and uv != fid:
            add_lookup(uv, "feature_id_unversioned", fid, res, src, ver)
        sym = g.get("symbol")
        if sym:
            add_lookup(sym.upper(), "symbol", fid, res, src, ver)
        for a in g.get("aliases") or []:
            add_lookup(str(a).upper(), "alias", fid, res, src, ver)
        for x in g.get("xrefs") or []:
            add_lookup(str(x), "xref", fid, res, src, ver)

    genes_path = package / "genes.parquet"
    lookup_path = package / "gene_lookup.parquet"

    list_str = pa.list_(pa.string())
    genes_schema = pa.schema(
        [
            ("feature_id", pa.string()),
            ("feature_id_unversioned", pa.string()),
            ("resource", pa.string()),
            ("annotation_source", pa.string()),
            ("annotation_version", pa.string()),
            ("annotation_file", pa.string()),
            ("symbol", pa.string()),
            ("aliases", list_str),
            ("xrefs", list_str),
            ("feature_type_id", pa.string()),
            ("feature_type_label", pa.string()),
            ("chrom", pa.string()),
            ("start", pa.int64()),
            ("end", pa.int64()),
            ("strand", pa.string()),
            ("matrix_ids", list_str),
        ]
    )
    lookup_schema = pa.schema(
        [
            ("lookup_key", pa.string()),
            ("lookup_kind", pa.string()),
            ("feature_id", pa.string()),
            ("resource", pa.string()),
            ("annotation_source", pa.string()),
            ("annotation_version", pa.string()),
        ]
    )

    pq.write_table(
        pa.Table.from_pylist(gene_rows, schema=genes_schema),
        genes_path,
        compression="zstd",
    )
    pq.write_table(
        pa.Table.from_pylist(lookup_rows, schema=lookup_schema),
        lookup_path,
        compression="zstd",
    )
    print(f"Wrote {genes_path.name} rows={len(gene_rows)}")
    print(f"Wrote {lookup_path.name} rows={len(lookup_rows)}")

    # Enrich per-matrix features.parquet with symbol / aliases / xrefs from genes
    by_matrix_gene: Dict[str, Dict[str, Dict[str, Any]]] = defaultdict(dict)
    for g in gene_rows:
        for mid in g["matrix_ids"]:
            by_matrix_gene[mid][g["feature_id"]] = g

    for mid, meta in matrix_meta.items():
        feat_path = meta["features_path"]
        table = pq.read_table(feat_path)
        rows = table.to_pylist()
        catalog = by_matrix_gene.get(mid) or {}
        updated = 0
        for row in rows:
            fid = row.get("feature_id")
            g = catalog.get(fid)
            if not g:
                continue
            if g.get("symbol"):
                row["symbol"] = g["symbol"]
            # Merge aliases: keep existing + GFF aliases + unversioned id
            merged = list(row.get("aliases") or [])
            for a in g.get("aliases") or []:
                if a not in merged:
                    merged.append(a)
            uv = g.get("feature_id_unversioned")
            if uv and uv != fid and uv not in merged:
                merged.append(uv)
            row["aliases"] = merged
            updated += 1
        pq.write_table(pa.Table.from_pylist(rows), feat_path, compression="zstd")
        print(f"  enriched features.parquet for {mid}: {updated} rows")

    manifest["genesPath"] = "genes.parquet"
    manifest["geneLookupPath"] = "gene_lookup.parquet"
    manifest["genes"] = {
        "rows": len(gene_rows),
        "lookupRows": len(lookup_rows),
        "annotations": [
            {
                "source": source,
                "version": version,
                "file": url,
                "matrices": [m["matrix_id"] for m in members],
            }
            for (url, source, version), members in groups.items()
        ],
    }
    with manifest_path.open("w", encoding="utf-8") as fh:
        json.dump(manifest, fh, indent=2)
        fh.write("\n")

    return {
        "genes": len(gene_rows),
        "lookup": len(lookup_rows),
        "hits_per_matrix": {mid: len(ids) for mid, ids in hits_per_matrix.items()},
    }


def main(argv: Optional[List[str]] = None) -> int:
    args = build_arg_parser().parse_args(argv)
    try:
        hydrate_package(
            args.package,
            cache_dir=args.cache_dir or CACHE_DIR,
            skip_download=args.skip_download,
        )
        return 0
    except SystemExit:
        raise
    except Exception as exc:
        print(f"Error: {exc}", file=sys.stderr)
        if args.verbose:
            traceback.print_exc()
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
