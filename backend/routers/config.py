"""Runtime config for the browser.

On Databricks the LINZ Basemaps key comes from a workspace secret (LINZ_API_KEY,
see app.yaml), so the frontend fetches it here instead of needing a key pasted
in. Locally the env var is normally unset and this returns an empty key, so
config.js / the UI paste work exactly as before.

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
