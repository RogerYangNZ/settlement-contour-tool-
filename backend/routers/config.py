"""Runtime config for the browser.

If the server has a LINZ Basemaps key in the LINZ_API_KEY env var, the frontend
fetches it here instead of needing a key pasted in. Nothing sets it at the
moment — the Databricks deploy no longer wires a secret into it (see app.yaml) —
so this returns an empty key and config.js / the UI paste are what's used. Kept
so a server-side key can come back with config alone, no code change.

The key ends up in tile URLs in the browser anyway, so serving it exposes
nothing new — the app itself sits behind Databricks SSO.
"""
from __future__ import annotations

import os

from fastapi import APIRouter

router = APIRouter(prefix="/api", tags=["config"])


@router.get("/config")
def config():
    return {"linz_api_key": os.environ.get("LINZ_API_KEY", "")}
