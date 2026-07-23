"""
Inverse Distance Weighting (IDW) interpolation of scattered survey points
(easting, northing, settlement value) onto a regular grid.
"""
from __future__ import annotations

import numpy as np


def build_grid(
    x: np.ndarray,
    y: np.ndarray,
    resolution: int = 150,
    padding_frac: float = 0.05,
):
    """Build a regular grid covering the bounding box of the input points,
    padded by ``padding_frac`` of the span on each side so contours don't
    get clipped right at the edge points.

    Returns (grid_x, grid_y) as 2D meshgrid arrays.
    """
    x_min, x_max = float(np.min(x)), float(np.max(x))
    y_min, y_max = float(np.min(y)), float(np.max(y))

    x_span = x_max - x_min or 1.0
    y_span = y_max - y_min or 1.0

    x_min -= x_span * padding_frac
    x_max += x_span * padding_frac
    y_min -= y_span * padding_frac
    y_max += y_span * padding_frac

    gx = np.linspace(x_min, x_max, resolution)
    gy = np.linspace(y_min, y_max, resolution)
    grid_x, grid_y = np.meshgrid(gx, gy)
    return grid_x, grid_y


def idw_interpolate(
    x: np.ndarray,
    y: np.ndarray,
    z: np.ndarray,
    grid_x: np.ndarray,
    grid_y: np.ndarray,
    power: float = 2.0,
    max_points: int | None = None,
) -> np.ndarray:
    """Vectorised IDW interpolation.

    x, y, z: 1D arrays of known sample points.
    grid_x, grid_y: 2D meshgrid arrays of query locations.
    power: distance decay exponent (2 is the classic IDW default).
    max_points: if set, only the N nearest points are used per grid cell
        (kept None here since settlement monitoring point counts are small
        enough for a full dense computation to stay fast).

    Returns a 2D array the same shape as grid_x/grid_y.
    """
    x = np.asarray(x, dtype=np.float64)
    y = np.asarray(y, dtype=np.float64)
    z = np.asarray(z, dtype=np.float64)

    shape = grid_x.shape
    gx = grid_x.ravel()[:, None]  # (M, 1)
    gy = grid_y.ravel()[:, None]  # (M, 1)

    dx = gx - x[None, :]  # (M, N)
    dy = gy - y[None, :]  # (M, N)
    dist = np.sqrt(dx * dx + dy * dy)

    # Avoid division by zero at/near sample locations: snap to exact value.
    eps = 1e-9
    exact_mask = dist < eps
    dist = np.where(exact_mask, eps, dist)

    weights = 1.0 / np.power(dist, power)
    weighted_sum = weights @ z
    weight_total = weights.sum(axis=1)
    z_grid = weighted_sum / weight_total

    # Snap any near-exact grid cell to the sample value it coincides with.
    any_exact = exact_mask.any(axis=1)
    if np.any(any_exact):
        rows = np.where(any_exact)[0]
        for r in rows:
            idx = np.argmin(dist[r])
            z_grid[r] = z[idx]

    return z_grid.reshape(shape)
