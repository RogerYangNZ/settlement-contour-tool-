"""Read an ArcGIS .lpkx layer package and flatten its geometry to plain
polylines/points for use as a georeferenced underlay behind the contours.

.lpkx is Esri's compact layer-package format: a 7z-compressed container around
a File Geodatabase (a `*.gdb` folder, nested a few levels deep under
`commondata/`) plus ArcGIS symbology we deliberately ignore (see note below).
We extract it with py7zr (pure Python, no system 7z binary needed), then read
the geodatabase with pyogrio, whose bundled GDAL build includes the open-source
OpenFileGDB driver — no ArcGIS license or separate GDAL install required.

Unlike DWG (where the drawing is already in NZTM and we pass coordinates
through untouched), GIS layers carry their own CRS, so we reproject to
EPSG:2193 whenever the source CRS is defined and different. Layers with no
CRS at all are passed through untouched (same "trust the data" convention as
dwg_import.py) with a note added to the response's `warnings` list.

We intentionally do not parse the package's .lyrx symbology (ArcGIS's
renderer definitions) — the frontend applies its own simple, fixed
color/dash coding per uploaded file instead. That keeps this importer limited
to geometry extraction.
"""
from __future__ import annotations

import tempfile
from pathlib import Path

import py7zr
import pyogrio
import shapely
from pyproj import Transformer

TARGET_CRS = "EPSG:2193"  # NZTM2000 — the project's working CRS.

# Guard against a 7z archive that decompresses far beyond its uploaded size
# (the router already caps the compressed upload, but 7z's ratio can be
# extreme) — bail out before extracting rather than filling /tmp.
MAX_UNCOMPRESSED_BYTES = 1024 * 1024 * 1024  # 1 GB


class LpkxImportError(Exception):
    """Raised for any recoverable problem extracting/parsing a layer package."""


def _extract(file_bytes: bytes, tmp_dir: Path) -> Path:
    archive_path = tmp_dir / "upload.lpkx"
    archive_path.write_bytes(file_bytes)
    extract_dir = tmp_dir / "extracted"
    try:
        with py7zr.SevenZipFile(archive_path, mode="r") as archive:
            total_uncompressed = sum(f.uncompressed for f in archive.list())
            if total_uncompressed > MAX_UNCOMPRESSED_BYTES:
                raise LpkxImportError(
                    "This .lpkx package is too large once decompressed "
                    f"({total_uncompressed / 1e6:.0f} MB, 1 GB max)."
                )
            archive.extractall(path=extract_dir)
    except LpkxImportError:
        raise
    except Exception as exc:  # py7zr raises a handful of its own exception types
        raise LpkxImportError(f"Could not open this .lpkx file: {exc}") from exc
    return extract_dir


def _find_gdb(extract_dir: Path) -> Path:
    gdbs = sorted(extract_dir.rglob("*.gdb"))
    if not gdbs:
        raise LpkxImportError(
            "No File Geodatabase found inside this .lpkx package."
        )
    return gdbs[0]


def _reproject(xs, ys, source_crs: str | None, warnings: list[str]):
    if not source_crs:
        warnings.append(
            "This layer has no defined coordinate system; coordinates were used as-is."
        )
        return xs, ys
    if source_crs.upper() == TARGET_CRS:
        return xs, ys
    try:
        transformer = Transformer.from_crs(source_crs, TARGET_CRS, always_xy=True)
    except Exception as exc:
        warnings.append(
            f"Could not reproject from {source_crs} to {TARGET_CRS} ({exc}); "
            "coordinates were used as-is."
        )
        return xs, ys
    new_xs, new_ys = transformer.transform(xs, ys)
    return list(new_xs), list(new_ys)


def _flatten_geometry(geom, polylines: list, points: list) -> None:
    """Flatten one shapely geometry into the shared polylines/points lists."""
    gtype = geom.geom_type
    if gtype == "LineString":
        coords = list(geom.coords)
        if len(coords) >= 2:
            polylines.append([[round(x, 4), round(y, 4)] for x, y, *_ in coords])
    elif gtype == "MultiLineString":
        for part in geom.geoms:
            _flatten_geometry(part, polylines, points)
    elif gtype in ("Polygon",):
        rings = [r for r in [geom.exterior, *geom.interiors] if r is not None]
        for ring in rings:
            coords = list(ring.coords)
            if len(coords) >= 2:
                polylines.append([[round(x, 4), round(y, 4)] for x, y, *_ in coords])
    elif gtype == "MultiPolygon":
        for part in geom.geoms:
            _flatten_geometry(part, polylines, points)
    elif gtype == "Point":
        points.append([round(geom.x, 4), round(geom.y, 4)])
    elif gtype == "MultiPoint":
        for part in geom.geoms:
            points.append([round(part.x, 4), round(part.y, 4)])
    elif gtype == "GeometryCollection":
        for part in geom.geoms:
            _flatten_geometry(part, polylines, points)
    # Other/unknown geometry types are silently skipped.


def _read_layer(gdb_path: Path, layer_name: str, warnings: list[str]) -> tuple[list, list]:
    polylines: list = []
    points: list = []
    try:
        meta, _fids, wkb_geoms, _fields = pyogrio.raw.read(
            str(gdb_path), layer=layer_name, columns=[], read_geometry=True
        )
    except Exception as exc:
        warnings.append(f"Could not read layer '{layer_name}': {exc}")
        return polylines, points

    if wkb_geoms is None or len(wkb_geoms) == 0:
        return polylines, points

    raw_polylines: list = []
    raw_points: list = []
    for wkb in wkb_geoms:
        if wkb is None:
            continue
        try:
            geom = shapely.from_wkb(wkb)
        except Exception:
            continue
        _flatten_geometry(geom, raw_polylines, raw_points)

    source_crs = meta.get("crs")

    if raw_polylines:
        xs = [p[0] for line in raw_polylines for p in line]
        ys = [p[1] for line in raw_polylines for p in line]
        new_xs, new_ys = _reproject(xs, ys, source_crs, warnings)
        offset = 0
        for line in raw_polylines:
            n = len(line)
            seg_xs = new_xs[offset:offset + n]
            seg_ys = new_ys[offset:offset + n]
            polylines.append([[round(x, 4), round(y, 4)] for x, y in zip(seg_xs, seg_ys)])
            offset += n

    if raw_points:
        xs = [p[0] for p in raw_points]
        ys = [p[1] for p in raw_points]
        new_xs, new_ys = _reproject(xs, ys, source_crs, warnings)
        points = [[round(x, 4), round(y, 4)] for x, y in zip(new_xs, new_ys)]

    return polylines, points


def load_utilities(file_bytes: bytes, filename: str) -> dict:
    """Extract and flatten an uploaded .lpkx layer package.

    Returns {polylines: [[[x,y],...],...], points: [[x,y],...], bounds,
    polyline_count, point_count, warnings} with coordinates reprojected to
    EPSG:2193 (NZTM2000) when the source layer's CRS is known and different."""
    suffix = Path(filename).suffix.lower()
    if suffix != ".lpkx":
        raise LpkxImportError("Please upload a .lpkx file.")

    with tempfile.TemporaryDirectory() as tmp:
        tmp_dir = Path(tmp)
        extract_dir = _extract(file_bytes, tmp_dir)
        gdb_path = _find_gdb(extract_dir)

        try:
            layers = pyogrio.list_layers(str(gdb_path))
        except Exception as exc:
            raise LpkxImportError(
                f"Could not read the geodatabase in this package: {exc}"
            ) from exc

        polylines: list = []
        points: list = []
        warnings: list = []
        for layer_name, geom_type in layers:
            if geom_type is None:
                continue  # non-spatial table
            layer_polylines, layer_points = _read_layer(gdb_path, layer_name, warnings)
            polylines.extend(layer_polylines)
            points.extend(layer_points)

    if not polylines and not points:
        raise LpkxImportError("No utility geometry found in this layer package.")

    xs = [x for pl in polylines for x, _ in pl] + [p[0] for p in points]
    ys = [y for pl in polylines for _, y in pl] + [p[1] for p in points]
    bounds = {
        "x_min": min(xs), "x_max": max(xs),
        "y_min": min(ys), "y_max": max(ys),
    }
    return {
        "polylines": polylines,
        "points": points,
        "bounds": bounds,
        "polyline_count": len(polylines),
        "point_count": len(points),
        "warnings": warnings,
    }
