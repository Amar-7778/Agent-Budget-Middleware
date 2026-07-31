import os
from fastapi import APIRouter
from fastapi.responses import FileResponse

router = APIRouter(tags=["UI"])

STATIC_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "static"))
INDEX_FILE = os.path.join(STATIC_DIR, "index.html")

NO_CACHE_HEADERS = {
    "Cache-Control": "no-cache, no-store, must-revalidate",
    "Pragma": "no-cache",
    "Expires": "0"
}

@router.get("/", response_class=FileResponse)
async def serve_root():
    return FileResponse(INDEX_FILE, headers=NO_CACHE_HEADERS)

@router.get("/ui", response_class=FileResponse)
async def serve_ui():
    return FileResponse(INDEX_FILE, headers=NO_CACHE_HEADERS)
