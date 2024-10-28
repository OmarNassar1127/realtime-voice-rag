from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.api.routes import api_router
from app.api.routes.websocket import router as websocket_router

app = FastAPI(title="VoiceRAG API")

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Allows all origins in development
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=[
        "*",
        "Sec-WebSocket-Key",
        "Sec-WebSocket-Version",
        "Sec-WebSocket-Extensions",
        "Sec-WebSocket-Protocol",
        "Authorization",
        "Content-Type"
    ],
    expose_headers=["*"],
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
