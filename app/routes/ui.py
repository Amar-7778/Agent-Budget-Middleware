import os
from fastapi import APIRouter
from fastapi.responses import FileResponse

router = APIRouter(tags=["UI"])

STATIC_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "static"))
INDEX_FILE = os.path.join(STATIC_DIR, "index.html")

@router.get("/", response_class=FileResponse)
async def serve_root():
    return FileResponse(INDEX_FILE)

@router.get("/ui", response_class=FileResponse)
async def serve_ui():
    return FileResponse(INDEX_FILE)
