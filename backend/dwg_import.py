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

import shutil
import subprocess
import tempfile
from pathlib import Path

import ezdxf
from ezdxf import path as ezpath
from ezdxf import recover
from ezdxf.entities.geodata import GeoData

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


def _entity_to_polylines(e) -> list[list[list[float]]]:
    """Flatten one entity to zero or more [[x, y], ...] line strings."""
    dxftype = e.dxftype()

    # Text is handled separately; skip here.
    if dxftype in ("TEXT", "MTEXT", "ATTRIB", "ATTDEF"):
        return []

    try:
        p = ezpath.make_path(e)
    except (TypeError, ValueError):
        return []

    pts = [[round(v.x, 4), round(v.y, 4)] for v in p.flattening(FLATTEN_DISTANCE)]
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


def _parse_dxf(dxf_path: Path) -> dict:
    try:
        doc = ezdxf.readfile(str(dxf_path))
    except IOError as exc:
        raise DwgImportError(f"Could not read the converted DXF: {exc}") from exc
    except ezdxf.DXFStructureError:
        # A single malformed object (commonly the AutoCAD GEODATA georeferencing
        # mesh emitted by the DWG->DXF conversion) makes the strict loader reject
        # the whole file. Recovery mode skips/repairs bad objects and keeps the
        # geometry, which is all we need for an underlay.
        try:
            doc, _auditor = recover.readfile(str(dxf_path))
        except (IOError, ezdxf.DXFStructureError) as exc:
            raise DwgImportError(f"Could not read the converted DXF: {exc}") from exc

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
