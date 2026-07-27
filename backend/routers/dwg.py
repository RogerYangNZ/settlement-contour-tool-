"""DWG/DXF drawing import — returns flat geometry for a georeferenced underlay."""
from __future__ import annotations

from fastapi import APIRouter, File, HTTPException, UploadFile

from dwg_import import DwgImportError, load_drawing

router = APIRouter(prefix="/api", tags=["dwg"])

# Guard against someone uploading an enormous drawing that would take minutes to
# convert / megabytes to ship to the browser.
MAX_BYTES = 50 * 1024 * 1024


@router.post("/import-dwg")
async def import_dwg(file: UploadFile = File(...)):
    data = await file.read()
    if not data:
        raise HTTPException(400, "Empty file.")
    if len(data) > MAX_BYTES:
        raise HTTPException(413, "File too large (50 MB max).")
    try:
        return load_drawing(data, file.filename or "upload.dwg")
    except DwgImportError as exc:
        raise HTTPException(422, str(exc)) from exc
