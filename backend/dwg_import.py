"""Read a DWG (or DXF) drawing and flatten it to plain polylines for use as a
georeferenced underlay behind the contours.

DWG is a closed binary format, so we shell out to GNU LibreDWG's `dwg2dxf` to
convert DWG -> DXF, then parse the DXF with ezdxf (already a project dependency).
Everything — arcs, circles, splines, polylines — is flattened to line strings so
the frontend only ever has to draw one primitive. Coordinates are passed through
untouched: survey drawings are already in real easting/northing (NZTM), which is
the same space the contours live in, so no reprojection is needed.

Install the converter with:  brew install libredwg   (provides `dwg2dxf`).
"""
from __future__ import annotations

import math
import re
import shutil
import subprocess
import tempfile
from pathlib import Path

import ezdxf
from ezdxf import path as ezpath
from ezdxf import recover
from ezdxf.entities.geodata import GeoData
from ezdxf.math import distance_point_line_3d
# Pure-Python B-spline evaluator. ezdxf's C-accelerated one caps the spline
# order (MAX_SPLINE_ORDER); some CAD contour exports use very high-degree
# splines that trip that cap, so we fall back to these for those entities.
from ezdxf.math._bspline import Basis as _PyBasis, Evaluator as _PyEvaluator

# App id the DXF exporter stamps each contour's numeric level into as XDATA.
# Importing it here (rather than re-typing the string) keeps read/write in sync,
# so a DXF this tool exports round-trips its levels back exactly.
from dxf_export import XDATA_APP_ID

# LibreDWG's DWG->DXF conversion sometimes emits a GEODATA object (AutoCAD's
# georeferencing metadata) with a mismatched source/target point mesh. ezdxf's
# strict loader rejects the *entire* drawing over that one object. We only want
# geometry, not the geo-mesh, so neutralise just that fatal check: keep loading
# the mesh, but on a count mismatch truncate to the common length instead of
# raising. Applied once at import time; leaves all other geometry untouched.
_orig_load_mesh_data = GeoData.load_mesh_data


def _lenient_load_mesh_data(self, tags, version: int = 2):
    try:
        return _orig_load_mesh_data(self, tags, version)
    except ezdxf.DXFStructureError:
        n = min(len(self.source_vertices), len(self.target_vertices))
        del self.source_vertices[n:]
        del self.target_vertices[n:]


GeoData.load_mesh_data = _lenient_load_mesh_data

# Chord tolerance (drawing units, i.e. metres for NZTM) used when flattening
# curved entities to line segments. 0.25 m is well below anything visible as an
# underlay while keeping the point count sane.
FLATTEN_DISTANCE = 0.25


class DwgImportError(Exception):
    """Raised for any recoverable problem converting/parsing a drawing."""


def _find_converter() -> str:
    exe = shutil.which("dwg2dxf")
    if not exe:
        raise DwgImportError(
            "LibreDWG's 'dwg2dxf' converter was not found on PATH. "
            "Install it with: brew install libredwg"
        )
    return exe


def _dwg_to_dxf_path(dwg_path: Path, out_dir: Path) -> Path:
    exe = _find_converter()
    dxf_path = out_dir / (dwg_path.stem + ".dxf")
    proc = subprocess.run(
        [exe, "-y", "--as", "r2000", "-o", str(dxf_path), str(dwg_path)],
        capture_output=True,
        text=True,
        timeout=120,
    )
    if proc.returncode != 0 or not dxf_path.exists():
        detail = (proc.stderr or proc.stdout or "").strip()[:500]
        raise DwgImportError(f"dwg2dxf failed to convert the file. {detail}")
    return dxf_path


def _iter_drawables(entities):
    """Yield real drawable entities, expanding block references (INSERT) into
    their constituent geometry so nothing inside a block is lost."""
    for e in entities:
        if e.dxftype() == "INSERT":
            try:
                yield from _iter_drawables(e.virtual_entities())
            except Exception:
                continue
        else:
            yield e


def _flatten_spline(e) -> list:
    """Flatten a SPLINE whose order exceeds ezdxf's accelerated evaluator cap,
    using the pure-Python evaluator with the same adaptive subdivision as
    ezdxf's BSpline.flattening. Returns a list of Vec3 (empty if unusable)."""
    cp = list(e.control_points)
    if len(cp) < 2:
        return []
    knots = list(e.knots)
    weights = list(e.weights) if e.weights else None
    order = len(knots) - len(cp)
    if order < 2 or order > len(cp):
        return []
    ev = _PyEvaluator(_PyBasis(knots, order, len(cp), weights), cp)

    def subdiv(s, en, t0, t1):
        mid = (t0 + t1) * 0.5
        m = ev.point(mid)
        try:
            d = distance_point_line_3d(m, s, en)
        except ZeroDivisionError:  # s == en
            d = 0.0
        if d < FLATTEN_DISTANCE:
            yield en
        else:
            yield from subdiv(s, m, t0, mid)
            yield from subdiv(m, en, mid, t1)

    lower, upper = knots[order - 1], knots[len(cp)]
    kseq = sorted(k for k in set(knots) if lower <= k <= upper)
    t = lower
    start = ev.point(t)
    out = [start]
    for t1 in kseq[1:]:
        delta = (t1 - t) / 4          # ezdxf's default min segments-per-knot
        while t < t1 - 1e-12:
            nt = t + delta
            if math.isclose(nt, t1):
                nt = t1
            end = ev.point(nt)
            out.extend(subdiv(start, end, t, nt))
            t = nt
            start = end
    return out


def _flatten_entity(e) -> list:
    """Reduce any drawable entity to a flat list of Vec3 vertices, with a
    pure-Python fallback for high-order splines ezdxf's fast path rejects."""
    try:
        return list(ezpath.make_path(e).flattening(FLATTEN_DISTANCE))
    except (TypeError, ValueError):
        if e.dxftype() == "SPLINE":
            try:
                return _flatten_spline(e)
            except Exception:
                return []
        return []


def _entity_to_polylines(e) -> list[list[list[float]]]:
    """Flatten one entity to zero or more [[x, y], ...] line strings."""
    # Text is handled separately; skip here.
    if e.dxftype() in ("TEXT", "MTEXT", "ATTRIB", "ATTDEF"):
        return []
    pts = [[round(v.x, 4), round(v.y, 4)] for v in _flatten_entity(e)]
    return [pts] if len(pts) >= 2 else []


def _entity_to_text(e) -> dict | None:
    dxftype = e.dxftype()
    if dxftype == "TEXT":
        content = e.dxf.text
        insert = e.dxf.insert
        height = e.dxf.height
    elif dxftype == "MTEXT":
        content = e.plain_text()
        insert = e.dxf.insert
        height = e.dxf.char_height
    else:
        return None
    content = (content or "").strip()
    if not content:
        return None
    return {
        "x": round(insert.x, 4),
        "y": round(insert.y, 4),
        "text": content,
        "height": round(float(height), 4),
    }


def _read_doc(dxf_path: Path):
    """Load a DXF, falling back to ezdxf's recovery reader.

    A single malformed object (commonly the AutoCAD GEODATA georeferencing mesh
    emitted by the DWG->DXF conversion) makes the strict loader reject the whole
    file. Recovery mode skips/repairs bad objects and keeps the geometry."""
    try:
        return ezdxf.readfile(str(dxf_path))
    except IOError as exc:
        raise DwgImportError(f"Could not read the converted DXF: {exc}") from exc
    except ezdxf.DXFStructureError:
        try:
            doc, _auditor = recover.readfile(str(dxf_path))
            return doc
        except (IOError, ezdxf.DXFStructureError) as exc:
            raise DwgImportError(f"Could not read the converted DXF: {exc}") from exc


def _parse_dxf(dxf_path: Path) -> dict:
    doc = _read_doc(dxf_path)
    msp = doc.modelspace()
    polylines: list[list[list[float]]] = []
    texts: list[dict] = []

    for e in _iter_drawables(msp):
        polylines.extend(_entity_to_polylines(e))
        t = _entity_to_text(e)
        if t:
            texts.append(t)

    if not polylines and not texts:
        raise DwgImportError("No drawable geometry found in the drawing.")

    xs = [x for pl in polylines for x, _ in pl] + [t["x"] for t in texts]
    ys = [y for pl in polylines for _, y in pl] + [t["y"] for t in texts]
    bounds = {
        "x_min": min(xs), "x_max": max(xs),
        "y_min": min(ys), "y_max": max(ys),
    }
    return {
        "polylines": polylines,
        "texts": texts,
        "bounds": bounds,
        "polyline_count": len(polylines),
    }


def load_drawing(file_bytes: bytes, filename: str) -> dict:
    """Convert (if needed) and parse an uploaded drawing to flat geometry.

    Accepts .dwg (converted via LibreDWG) or .dxf (parsed directly). Returns
    {polylines, texts, bounds, polyline_count} with coordinates in the drawing's
    own units (assumed easting/northing / NZTM)."""
    suffix = Path(filename).suffix.lower()
    if suffix not in (".dwg", ".dxf"):
        raise DwgImportError("Please upload a .dwg or .dxf file.")

    with tempfile.TemporaryDirectory() as tmp:
        tmp_dir = Path(tmp)
        src = tmp_dir / f"upload{suffix}"
        src.write_bytes(file_bytes)
        dxf_path = src if suffix == ".dxf" else _dwg_to_dxf_path(src, tmp_dir)
        return _parse_dxf(dxf_path)


# --- Contour import -------------------------------------------------------
# Unlike load_drawing (which throws away everything but 2D geometry for an
# underlay), this reads each line entity back as an *editable contour*, keeping
# its elevation/level and open-vs-closed state so it can flow into the same edit
# and export pipeline as a CSV-generated contour.

# Matches a level encoded in a layer name, tolerating this tool's own encoding
# (decimal point -> "_"). "NEG" -> "-" is normalised before matching.
_LAYER_LEVEL_RE = re.compile(r"-?\d+(?:[._]\d+)?")
# A text label that is purely a number (a contour elevation annotation).
_NUMERIC_TEXT_RE = re.compile(r"-?\d+(?:\.\d+)?$")


def _same_xy(a, b) -> bool:
    return abs(a[0] - b[0]) < 1e-6 and abs(a[1] - b[1]) < 1e-6


def _xdata_level(e) -> float | None:
    """Level from this tool's own XDATA stamp (group code 1040)."""
    try:
        tags = e.get_xdata(XDATA_APP_ID)
    except Exception:
        return None
    for code, value in tags:
        if code == 1040:
            try:
                return round(float(value), 4)
            except (TypeError, ValueError):
                return None
    return None


def _z_level(e, verts) -> float | None:
    """Level from the entity's constant elevation (Z), if it carries one."""
    elev = getattr(e.dxf, "elevation", None)
    if elev is not None:
        try:
            val = float(elev)
        except (TypeError, ValueError):
            val = float(getattr(elev, "z", 0.0))
        if abs(val) > 1e-9:
            return round(val, 4)
    for v in verts:
        if abs(v.z) > 1e-9:
            return round(float(v.z), 4)
    return None


def _layer_level(e) -> float | None:
    """Level parsed from the entity's layer name (e.g. CONTOUR_5.0 -> 5.0)."""
    layer = (getattr(e.dxf, "layer", "") or "").replace("NEG", "-")
    m = _LAYER_LEVEL_RE.search(layer)
    if not m:
        return None
    try:
        return round(float(m.group(0).replace("_", ".")), 4)
    except ValueError:
        return None


def _entity_closed(e, pts) -> bool:
    if e.dxftype() in ("CIRCLE", "ELLIPSE"):
        return True
    # A repeated first/last vertex is a closed ring regardless of the DXF closed
    # flag. Check this *before* the flag: our own export closes contours this way
    # (open polyline, duplicated endpoint — see dxf_export) so a flag of False
    # must not override the coincident endpoints, or closure is lost on re-import.
    if len(pts) > 2 and _same_xy(pts[0], pts[-1]):
        return True
    for attr in ("is_closed", "closed"):
        val = getattr(e, attr, None)
        if isinstance(val, bool):
            return val
    return False


def _iter_contour_entities(msp):
    """Yield (entity, pts, closed, z_level) for every drawable line entity,
    flattening curves and dropping the duplicated closing vertex."""
    for e in _iter_drawables(msp):
        if e.dxftype() in ("TEXT", "MTEXT", "ATTRIB", "ATTDEF", "POINT"):
            continue
        verts = _flatten_entity(e)
        pts = [[round(v.x, 4), round(v.y, 4)] for v in verts]
        if len(pts) < 2:
            continue
        closed = _entity_closed(e, pts)
        if closed and len(pts) > 2 and _same_xy(pts[0], pts[-1]):
            pts = pts[:-1]
        yield e, pts, closed, _z_level(e, verts)


def _numeric_labels(msp) -> list[dict]:
    labels = []
    for e in _iter_drawables(msp):
        t = _entity_to_text(e)
        if t and _NUMERIC_TEXT_RE.match(t["text"]):
            labels.append({"x": t["x"], "y": t["y"], "value": float(t["text"])})
    return labels


def _nearest_label_value(pts, labels) -> float | None:
    if not labels:
        return None
    cx = sum(p[0] for p in pts) / len(pts)
    cy = sum(p[1] for p in pts) / len(pts)
    best = min(labels, key=lambda l: (l["x"] - cx) ** 2 + (l["y"] - cy) ** 2)
    return round(best["value"], 4)


def _parse_contours(dxf_path: Path) -> dict:
    doc = _read_doc(dxf_path)
    msp = doc.modelspace()
    labels = _numeric_labels(msp)

    contours: list[dict] = []
    for e, pts, closed, z in _iter_contour_entities(msp):
        # First hit wins: XDATA (our own export) -> Z/elevation -> layer name
        # number -> nearest numeric text label -> 0.0 fallback.
        level = _xdata_level(e)
        if level is None:
            level = z
        if level is None:
            level = _layer_level(e)
        if level is None:
            level = _nearest_label_value(pts, labels)
        if level is None:
            level = 0.0
        contours.append({"level": level, "coords": pts, "closed": closed})

    if not contours:
        raise DwgImportError("No contour lines (polylines) found in the drawing.")

    xs = [x for c in contours for x, _ in c["coords"]]
    ys = [y for c in contours for _, y in c["coords"]]
    return {
        "contours": contours,
        "bounds": {"x_min": min(xs), "x_max": max(xs),
                   "y_min": min(ys), "y_max": max(ys)},
        "contour_count": len(contours),
    }


def load_contours(file_bytes: bytes, filename: str) -> dict:
    """Convert (if needed) and parse an uploaded drawing into editable contours.

    Accepts .dwg (converted via LibreDWG) or .dxf. Returns
    {contours: [{level, coords:[[x,y]], closed}], bounds, contour_count} with
    coordinates in the drawing's own units (assumed easting/northing / NZTM).
    Each contour's level is auto-detected (XDATA / Z / layer name / label)."""
    suffix = Path(filename).suffix.lower()
    if suffix not in (".dwg", ".dxf"):
        raise DwgImportError("Please upload a .dwg or .dxf file.")

    with tempfile.TemporaryDirectory() as tmp:
        tmp_dir = Path(tmp)
        src = tmp_dir / f"upload{suffix}"
        src.write_bytes(file_bytes)
        dxf_path = src if suffix == ".dxf" else _dwg_to_dxf_path(src, tmp_dir)
        return _parse_contours(dxf_path)
