from fastapi import FastAPI, WebSocket, Request
from fastapi.middleware.cors import CORSMiddleware
from app.api.routes import api_router
from app.api.routes.websocket import router as websocket_router
from fastapi.responses import JSONResponse
from starlette.websockets import WebSocketState
import logging

app = FastAPI(title="VoiceRAG API")

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Configure CORS with WebSocket support
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Allow all origins in development
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*", "upgrade", "sec-websocket-key",
                  "sec-websocket-version", "sec-websocket-extensions",
                  "sec-websocket-protocol"],
    expose_headers=["*", "upgrade", "sec-websocket-accept",
                   "sec-websocket-protocol", "sec-websocket-version"],
)

# Include WebSocket router at root level
app.include_router(websocket_router)

# Include API router
app.include_router(api_router, prefix="/api")

@app.get("/")
async def root():
    return {"message": "Welcome to VoiceRAG API"}

@app.get("/health")
async def health_check():
    return {"status": "healthy"}
