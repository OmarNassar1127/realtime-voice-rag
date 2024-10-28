# API routes package

from fastapi import APIRouter
from .documents import router as documents_router
from .websocket import router as websocket_router

# Create main API router
api_router = APIRouter()

# Include sub-routers with prefixes
api_router.include_router(documents_router, prefix="/documents", tags=["documents"])
api_router.include_router(websocket_router, prefix="/ws", tags=["websocket"])
