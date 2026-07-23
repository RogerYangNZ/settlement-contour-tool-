"""
Settlement Contour Tool — FastAPI backend.

Endpoints:
  GET  /                    -> frontend UI
  POST /api/generate        -> IDW interpolation + contour extraction
  POST /api/export          -> DXF export of (possibly edited) contours

Run with:
  uvicorn app:app --reload --port 8420
"""
from __future__ import annotations

import csv
import io
from pathlib import Path
from typing import Optional

import numpy as np
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from contouring import generate_contours, levels_from_range
from dxf_export import export_dxf
from interpolation import build_grid, idw_interpolate

BASE_DIR = Path(__file__).resolve().parent
FRONTEND_DIR = BASE_DIR.parent / "frontend"

app = FastAPI(title="Settlement Contour Tool")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------
class Point(BaseModel):
    x: float
    y: float
    z: float
    id: Optional[str] = None


class GenerateRequest(BaseModel):
    points: list[Point]
    interval: float = Field(gt=0)
    power: float = Field(default=2.0, gt=0)
    resolution: int = Field(default=150, ge=20, le=400)
    min_level: Optional[float] = None
    max_level: Optional[float] = None


class ContourLine(BaseModel):
    level: float
    coords: list[list[float]]
    closed: Optional[bool] = None


class ExportRequest(BaseModel):
    contours: list[ContourLine]
    points: Optional[list[Point]] = None
    layer_prefix: str = "SETTLEMENT"
    include_points: bool = True
    include_labels: bool = True
    filename: str = "settlement_contours.dxf"


class ParseCSVRequest(BaseModel):
    csv_text: str


# ---------------------------------------------------------------------------
# API
# ---------------------------------------------------------------------------
@app.post("/api/parse-csv")
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


@app.post("/api/generate")
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


@app.post("/api/export")
def export(req: ExportRequest):
    contours = [c.model_dump() for c in req.contours]
    points = None
    if req.include_points and req.points:
        points = [p.model_dump() for p in req.points]

    dxf_bytes = export_dxf(
        contours=contours,
        points=points,
        layer_prefix=req.layer_prefix,
        add_labels=req.include_labels,
    )
    filename = req.filename or "settlement_contours.dxf"
    if not filename.lower().endswith(".dxf"):
        filename += ".dxf"

    return Response(
        content=dxf_bytes,
        media_type="application/dxf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@app.get("/", response_class=HTMLResponse)
def index():
    return (FRONTEND_DIR / "index.html").read_text(encoding="utf-8")


app.mount("/static", StaticFiles(directory=str(FRONTEND_DIR)), name="static")
