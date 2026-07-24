"""
Export contour polylines (and optionally the original survey points) to a
DXF file that opens cleanly in QGIS / ArcGIS as a vector layer.

Design choices, all aimed at GIS interoperability:
- One DXF layer per contour level (e.g. SETTLEMENT_5, SETTLEMENT_10, ...)
  so QGIS/ArcGIS can filter/symbolise by the "Layer" field it reads on
  import, same as a normal DXF import workflow.
- Each LWPOLYLINE is also given a constant elevation (Z) equal to the
  settlement value, so tools that read Z as an attribute (e.g. QGIS's
  "Set Z value" / Extract Z, or 3D DXF viewers) also see the correct value.
- XDATA is attached with the numeric level too, for tools that read DXF
  extended entity data as attributes.
"""
from __future__ import annotations

import io
import re

import ezdxf
from ezdxf import colors as ezcolors

XDATA_APP_ID = "SETTLEMENT_CONTOUR"


def _safe_layer_name(prefix: str, level: float) -> str:
    label = f"{level:g}"
    label = label.replace("-", "NEG").replace(".", "_")
    name = f"{prefix}_{label}"
    # DXF layer names: keep it conservative (alnum + underscore).
    name = re.sub(r"[^A-Za-z0-9_]", "_", name)
    return name[:255]


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
    doc = ezdxf.new(dxfversion="R2010", setup=True)
    doc.units = ezdxf.units.MM
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
        pl = msp.add_lwpolyline(
            points2d,
            format="xy",
            close=is_closed,
            dxfattribs={
                "layer": layer_name,
                "elevation": level,
            },
        )
        pl.set_xdata(XDATA_APP_ID, [(1000, "LEVEL"), (1040, float(level))])

        if add_labels and len(points2d) > 0:
            mid = points2d[len(points2d) // 2]
            text_height = _estimate_text_height(coords)
            msp.add_text(
                f"{level:g}",
                dxfattribs={
                    "layer": layer_name,
                    "height": text_height,
                    "insert": (mid[0], mid[1]),
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
