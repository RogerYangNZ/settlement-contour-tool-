"""ArcGIS .lpkx layer-package import — returns flat geometry for a
georeferenced utility-line underlay."""
from __future__ import annotations

from fastapi import APIRouter, File, HTTPException, UploadFile

from lpkx_import import LpkxImportError, load_utilities

router = APIRouter(prefix="/api", tags=["utilities"])

# Geodatabases can run larger than a typical DXF underlay; still guard against
# an unreasonably large upload.
MAX_BYTES = 100 * 1024 * 1024


@router.post("/import-utilities")
async def import_utilities(file: UploadFile = File(...)):
    data = await file.read()
    if not data:
        raise HTTPException(400, "Empty file.")
    if len(data) > MAX_BYTES:
        raise HTTPException(413, "File too large (100 MB max).")
    try:
        return load_utilities(data, file.filename or "upload.lpkx")
    except LpkxImportError as exc:
        raise HTTPException(422, str(exc)) from exc
