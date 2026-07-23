"""
Contour line extraction from a regular grid using contourpy (the same
marching-squares engine matplotlib uses under the hood).
"""
from __future__ import annotations

import math

import numpy as np
import contourpy


def levels_from_range(z_min: float, z_max: float, interval: float) -> list[float]:
    """Build a list of contour levels covering [z_min, z_max] stepped by
    ``interval``, snapped to clean multiples of the interval so labels read
    nicely (e.g. 0, 5, 10, 15mm rather than 0.3, 5.3, 10.3)."""
    if interval <= 0:
        raise ValueError("interval must be > 0")
    start = math.floor(z_min / interval) * interval
    stop = math.ceil(z_max / interval) * interval
    n = int(round((stop - start) / interval)) + 1
    levels = [round(start + i * interval, 10) for i in range(n)]
    # Drop a degenerate single-level case (flat data) - contourpy needs at
    # least a little range, but we still want *something* returned.
    return levels


def generate_contours(
    grid_x: np.ndarray,
    grid_y: np.ndarray,
    grid_z: np.ndarray,
    levels: list[float],
) -> list[dict]:
    """Trace contour lines at each level.

    Returns a list of dicts: {"level": float, "coords": [[x, y], ...]}
    one entry per disjoint contour line segment (a single level can produce
    several separate closed or open lines).
    """
    cg = contourpy.contour_generator(
        x=grid_x,
        y=grid_y,
        z=grid_z,
        line_type=contourpy.LineType.Separate,
    )

    result = []
    for level in levels:
        try:
            lines = cg.lines(level)
        except Exception:
            continue
        for line in lines:
            if line is None or len(line) < 2:
                continue
            coords = np.asarray(line, dtype=float)
            # drop NaN rows if any slip through
            coords = coords[~np.isnan(coords).any(axis=1)]
            if len(coords) < 2:
                continue
            result.append({"level": float(level), "coords": coords.tolist()})
    return result
