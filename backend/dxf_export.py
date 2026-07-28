"""
Export contour polylines (and optionally the original survey points) to a
DXF file that opens cleanly in QGIS / ArcGIS as a vector layer.

Design choices, all aimed at GIS/CAD interoperability:
- Output is R2007 (AC1021) to match the source contour DXFs we import, which
  open cleanly in the AutoCAD/ArcGIS the user round-trips through.
- Each contour is a 3D SPLINE (per-vertex Z = the settlement value), the same
  primitive the source contour DXFs use. ArcGIS/QGIS read a contour's height
  from the geometry Z coordinate; XDATA and a flat 2D LWPOLYLINE's code-38
  elevation are ignored by Esri's reader, so the height must live on the
  geometry. A 3D polyline is used as a fallback when a contour has too few /
  degenerate points to interpolate a spline.
- Closed contours are written *open* with the first vertex repeated at the end,
  NOT with the DXF "closed" flag set. Esri's CAD reader routes every *closed*
  entity into the CAD **polygon** feature class instead of the polyline one, so
  a contour flagged closed vanishes from the polyline layer a user loads
  ("opens but empty"). A duplicated-endpoint entity is the same closed ring
  visually (and re-imports as closed, see dwg_import._entity_closed) but stays a
  line for ArcGIS/QGIS.
- One DXF layer per contour level (e.g. SETTLEMENT_5, SETTLEMENT_10, ...)
  so QGIS/ArcGIS can filter/symbolise by the "Layer" field it reads on
  import, same as a normal DXF import workflow.
- XDATA is attached with the numeric level too, for tools that read DXF
  extended entity data as attributes.
"""
from __future__ import annotations

import io
import re

import ezdxf
from ezdxf import bbox, zoom
from ezdxf import colors as ezcolors

XDATA_APP_ID = "SETTLEMENT_CONTOUR"


def _safe_layer_name(prefix: str, level: float) -> str:
    label = f"{level:g}"
    label = label.replace("-", "NEG").replace(".", "_")
    name = f"{prefix}_{label}"
    # DXF layer names: keep it conservative (alnum + underscore).
    name = re.sub(r"[^A-Za-z0-9_]", "_", name)
    return name[:255]


def _dedupe_consecutive(pts: list, eps: float = 1e-9) -> list:
    """Drop consecutive duplicate points — spline fit-point interpolation
    rejects a zero-length chord between identical fit points."""
    out = [pts[0]]
    for p in pts[1:]:
        prev = out[-1]
        if abs(p[0] - prev[0]) > eps or abs(p[1] - prev[1]) > eps:
            out.append(p)
    return out


def _add_contour_entity(msp, points3d: list, layer_name: str):
    """Add one contour as a SPLINE (matching the source contour DXFs we import,
    which the downstream AutoCAD/ArcGIS reads natively), with Z = level carried
    on the geometry. Falls back to a 3D polyline if the fit-point interpolation
    can't run (too few or degenerate points). Never sets the DXF closed flag —
    closure is a repeated first/last vertex (see module docstring)."""
    pts = _dedupe_consecutive(points3d)
    if len(pts) >= 3:
        try:
            return msp.add_spline_control_frame(
                pts,
                degree=min(3, len(pts) - 1),
                method="distance",
                dxfattribs={"layer": layer_name},
            )
        except Exception:
            pass
    return msp.add_polyline3d(pts, close=False, dxfattribs={"layer": layer_name})


def _color_for_level(level: float, lo: float, hi: float) -> int:
    """Green (low settlement) -> yellow -> red (high settlement), as a
    24-bit true color int."""
    if hi <= lo:
        t = 0.0
    else:
        t = (level - lo) / (hi - lo)
        t = min(1.0, max(0.0, t))
    if t < 0.5:
        # green -> yellow
        u = t / 0.5
        r = int(255 * u)
        g = 200
    else:
        # yellow -> red
        u = (t - 0.5) / 0.5
        r = 255
        g = int(200 * (1 - u))
    b = 40
    return ezcolors.rgb2int((r, g, b))


def export_dxf(
    contours: list[dict],
    points: list[dict] | None = None,
    layer_prefix: str = "SETTLEMENT",
    add_labels: bool = True,
) -> bytes:
    """
    contours: [{"level": float, "coords": [[x, y], ...]}, ...]
    points:   optional [{"x": float, "y": float, "z": float, "id": str}, ...]
              -> written as POINT entities + text labels on a
              f"{layer_prefix}_SURVEY_POINTS" layer.
    """
    # R2007 (AC1021) to match the source contour DXFs we import (and open
    # cleanly in the same AutoCAD/GIS the user round-trips through); newer
    # versions were observed to open empty in older AutoCAD/ArcGIS.
    # setup=False keeps the file minimal (no unused linetypes / text styles /
    # dimstyles / arrow blocks), matching the lean structure of the source DXFs.
    doc = ezdxf.new(dxfversion="R2007", setup=False)
    # Horizontal coordinates are NZTM easting/northing in metres, so declare
    # metres (matches the source contour DXFs we import). The settlement value
    # carried as Z is millimetres, but DXF has one unit flag; metres is the
    # right choice for the planar geometry a GIS georeferences on.
    doc.units = ezdxf.units.M
    msp = doc.modelspace()

    levels = sorted({c["level"] for c in contours}) if contours else []
    lo = min(levels) if levels else 0.0
    hi = max(levels) if levels else 0.0

    layer_cache: dict[str, str] = {}
    for level in levels:
        layer_name = _safe_layer_name(layer_prefix, level)
        layer_cache[level] = layer_name
        if layer_name not in doc.layers:
            doc.layers.add(
                name=layer_name,
                true_color=_color_for_level(level, lo, hi),
            )

    for c in contours:
        level = c["level"]
        coords = c["coords"]
        if len(coords) < 2:
            continue
        layer_name = layer_cache[level]
        # Prefer the caller's explicit `closed` flag (the frontend edits
        # loops as a distinct-vertex list, with no duplicated closing
        # point, so duplicate-point sniffing alone would misdetect edited
        # closed contours as open). Fall back to duplicate-point detection
        # for callers that don't send the flag.
        explicit_closed = c.get("closed")
        duplicate_closed = (
            len(coords) > 2
            and abs(coords[0][0] - coords[-1][0]) < 1e-6
            and abs(coords[0][1] - coords[-1][1]) < 1e-6
        )
        is_closed = explicit_closed if explicit_closed is not None else duplicate_closed
        points2d = coords[:-1] if (is_closed and duplicate_closed) else coords
        # Z = level on every vertex, so ArcGIS/QGIS read the contour's height
        # straight from the geometry (see module docstring).
        points3d = [(x, y, level) for x, y in points2d]
        # Close a ring by repeating the first vertex, never by the DXF closed
        # flag: a flagged-closed entity imports into ArcGIS's polygon feature
        # class, not the polyline one (see module docstring).
        if is_closed and len(points3d) > 1 and points3d[0] != points3d[-1]:
            points3d.append(points3d[0])
        entity = _add_contour_entity(msp, points3d, layer_name)
        entity.set_xdata(XDATA_APP_ID, [(1000, "LEVEL"), (1040, float(level))])

        if add_labels and len(points2d) > 0:
            mid = points2d[len(points2d) // 2]
            text_height = _estimate_text_height(coords)
            msp.add_text(
                f"{level:g}",
                dxfattribs={
                    "layer": layer_name,
                    "height": text_height,
                    "insert": (mid[0], mid[1], level),
                },
            )

    if points:
        pts_layer = f"{layer_prefix}_SURVEY_POINTS"
        if pts_layer not in doc.layers:
            doc.layers.add(name=pts_layer, color=7)
        for p in points:
            msp.add_point(
                (p["x"], p["y"], p.get("z", 0.0)),
                dxfattribs={"layer": pts_layer},
            )
            if add_labels:
                label = p.get("id") or f"{p.get('z', 0):g}"
                msp.add_text(
                    str(label),
                    dxfattribs={
                        "layer": pts_layer,
                        "height": _default_point_label_height(points),
                        "insert": (p["x"], p["y"]),
                    },
                )

    # Populate the drawing extents. ezdxf leaves these at their uninitialised
    # sentinels (1e20 / -1e20); ArcGIS uses the extents to establish the CAD
    # dataset's spatial extent, so leaving them unset makes the imported layer
    # land with a broken extent (won't draw / "zoom to layer" fails). We set the
    # *modelspace layout* extents — on write, ezdxf's update_extents() copies
    # those into the header $EXTMIN/$EXTMAX (setting the header directly is
    # futile: that same step would overwrite it). zoom.extents frames the view.
    box = bbox.extents(msp)
    if box.has_data:
        msp.dxf.extmin = box.extmin
        msp.dxf.extmax = box.extmax
        zoom.extents(msp)

    buf = io.StringIO()
    doc.write(buf)
    return buf.getvalue().encode("utf-8")


def _estimate_text_height(coords) -> float:
    xs = [c[0] for c in coords]
    ys = [c[1] for c in coords]
    span = max(max(xs) - min(xs), max(ys) - min(ys), 1.0)
    return max(span * 0.01, 0.05)


def _default_point_label_height(points) -> float:
    if len(points) < 2:
        return 0.2
    xs = [p["x"] for p in points]
    ys = [p["y"] for p in points]
    span = max(max(xs) - min(xs), max(ys) - min(ys), 1.0)
    return max(span * 0.008, 0.05)
