"""Pydantic request/response models shared across the API routers."""
from __future__ import annotations

from typing import Optional

from pydantic import BaseModel, Field


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
