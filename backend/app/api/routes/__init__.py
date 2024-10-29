# API routes package

from fastapi import APIRouter
from .document import router as document_router
from .websocket_mock import websocket_endpoint

# Create main API router
api_router = APIRouter()

# Include sub-routers with prefixes
api_router.include_router(document_router, tags=["documents"])

# Add WebSocket endpoint
api_router.add_api_websocket_route("/ws", websocket_endpoint, name="websocket")
