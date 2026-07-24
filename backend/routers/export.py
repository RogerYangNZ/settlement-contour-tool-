"""DXF export endpoint for (possibly hand-edited) contours."""
from __future__ import annotations

from fastapi import APIRouter
from fastapi.responses import Response

from dxf_export import export_dxf
from schemas import ExportRequest

router = APIRouter(prefix="/api", tags=["export"])


@router.post("/export")
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
