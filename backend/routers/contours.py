"""CSV sniffing + IDW interpolation / contour extraction endpoints."""
from __future__ import annotations

import csv
import io

import numpy as np
from fastapi import APIRouter, HTTPException

from contouring import generate_contours, levels_from_range
from interpolation import build_grid, idw_interpolate
from schemas import GenerateRequest, ParseCSVRequest

router = APIRouter(prefix="/api", tags=["contours"])


@router.post("/parse-csv")
def parse_csv(req: ParseCSVRequest):
    """Sniff a CSV's header + a preview of rows so the frontend can offer
    column mapping (easting / northing / settlement value columns)."""
    text = req.csv_text
    try:
        sample = text[:4096]
        dialect = csv.Sniffer().sniff(sample, delimiters=",;\t")
    except csv.Error:
        dialect = csv.excel
    reader = csv.reader(io.StringIO(text), dialect)
    rows = list(reader)
    if not rows:
        raise HTTPException(400, "Empty CSV")
    header = rows[0]
    preview = rows[1:11]
    return {"header": header, "preview": preview, "row_count": len(rows) - 1}


@router.post("/generate")
def generate(req: GenerateRequest):
    if len(req.points) < 3:
        raise HTTPException(400, "Need at least 3 points to interpolate a surface")

    x = np.array([p.x for p in req.points], dtype=float)
    y = np.array([p.y for p in req.points], dtype=float)
    z = np.array([p.z for p in req.points], dtype=float)

    grid_x, grid_y = build_grid(x, y, resolution=req.resolution)
    grid_z = idw_interpolate(x, y, z, grid_x, grid_y, power=req.power)

    z_min = req.min_level if req.min_level is not None else float(np.min(z))
    z_max = req.max_level if req.max_level is not None else float(np.max(z))
    if z_max <= z_min:
        z_max = z_min + req.interval

    levels = levels_from_range(z_min, z_max, req.interval)
    contours = generate_contours(grid_x, grid_y, grid_z, levels)

    return {
        "levels": levels,
        "contours": contours,
        "grid_bounds": {
            "x_min": float(grid_x.min()),
            "x_max": float(grid_x.max()),
            "y_min": float(grid_y.min()),
            "y_max": float(grid_y.max()),
        },
        "data_range": {"z_min": float(np.min(z)), "z_max": float(np.max(z))},
    }
