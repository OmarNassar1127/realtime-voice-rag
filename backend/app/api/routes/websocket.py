from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from ...core.config import settings
import openai
import json
import websockets
import asyncio
from typing import List, Dict
import whisper
from ...services.rag_service import RAGService
import tempfile
import os

router = APIRouter()

# Initialize OpenAI client and services
openai.api_key = settings.OPENAI_API_KEY

class ConnectionManager:
    def __init__(self):
        self.active_connections: List[WebSocket] = []
        self.openai_ws_connections: Dict[WebSocket, websockets.WebSocketClientProtocol] = {}
        self.whisper_model = whisper.load_model("base")
        self.rag_service = RAGService()

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)

        # Connect to OpenAI's WebSocket
        openai_ws = await websockets.connect(
            'wss://api.openai.com/v1/audio/realtime',
            extra_headers={
                'Authorization': f'Bearer {settings.OPENAI_API_KEY}',
                'Content-Type': 'audio/webm'
            }
        )
        self.openai_ws_connections[websocket] = openai_ws

    async def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)
            if websocket in self.openai_ws_connections:
                await self.openai_ws_connections[websocket].close()
                del self.openai_ws_connections[websocket]

    async def send_message(self, message: Dict, websocket: WebSocket):
        if websocket in self.active_connections:
            await websocket.send_json(message)

    async def forward_audio(self, audio_data: bytes, websocket: WebSocket):
        if websocket in self.openai_ws_connections:
            try:
                # Save audio data to temporary file
                with tempfile.NamedTemporaryFile(suffix='.webm', delete=False) as temp_file:
                    temp_file.write(audio_data)
                    temp_path = temp_file.name

                try:
                    # Transcribe audio using Whisper
                    result = self.whisper_model.transcribe(temp_path)
                    text = result["text"].strip()

                    # Get relevant context using RAG
                    context, citations = await self.rag_service.get_context(text)

                    # Format message with context
                    message = {
                        "type": "message",
                        "text": context,
                        "model": "gpt-4o-realtime-preview"
                    }

                    # Send context and transcribed text to OpenAI
                    openai_ws = self.openai_ws_connections[websocket]
                    await openai_ws.send(json.dumps(message))

                    # Send transcription and citations to client for reference
                    await self.send_message({
                        "type": "transcription",
                        "content": text,
                        "citations": citations,
                        "status": "success"
                    }, websocket)

                finally:
                    # Clean up temporary file
                    os.unlink(temp_path)

            except Exception as e:
                await self.send_message({
                    "type": "error",
                    "content": f"Error processing audio: {str(e)}",
                    "status": "error"
                }, websocket)

    async def receive_openai_response(self, websocket: WebSocket):
        if websocket in self.openai_ws_connections:
            openai_ws = self.openai_ws_connections[websocket]
            try:
                response = await openai_ws.recv()
                return json.loads(response)
            except websockets.exceptions.ConnectionClosed:
                return None

manager = ConnectionManager()

@router.websocket(settings.WEBSOCKET_PATH)
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)

    # Start response listener task
    response_task = asyncio.create_task(handle_openai_responses(websocket))

    try:
        while True:
            # Receive binary audio data
            data = await websocket.receive_bytes()

            try:
                # Forward audio data to OpenAI WebSocket
                await manager.forward_audio(data, websocket)

            except Exception as e:
                # Handle general errors
                await manager.send_message({
                    "type": "error",
                    "content": "An unexpected error occurred while processing audio",
                    "status": "error"
                }, websocket)
                print(f"Unexpected WebSocket error: {str(e)}")

    except WebSocketDisconnect:
        response_task.cancel()
        await manager.disconnect(websocket)
    except Exception as e:
        response_task.cancel()
        print(f"Connection error: {str(e)}")
        await manager.disconnect(websocket)
    finally:
        response_task.cancel()
        await manager.disconnect(websocket)
        await websocket.close()

async def handle_openai_responses(websocket: WebSocket):
    try:
        while True:
            response = await manager.receive_openai_response(websocket)
            if response:
                await manager.send_message({
                    "type": "response",
                    "content": response,
                    "status": "success"
                }, websocket)
            await asyncio.sleep(0.1)  # Small delay to prevent busy waiting
    except Exception as e:
        print(f"Error in OpenAI response handler: {str(e)}")
