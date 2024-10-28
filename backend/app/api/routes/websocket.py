from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from ...core.config import settings
import openai
import json
import websockets
import asyncio
from typing import List, Dict
import whisper
from ...core.rag_manager import RAGManager
import tempfile
import os
import uuid
import base64

router = APIRouter()

# Initialize OpenAI client and services
openai.api_key = settings.OPENAI_API_KEY

class ConnectionManager:
    def __init__(self):
        self.active_connections: List[WebSocket] = []
        self.openai_ws_connections: Dict[WebSocket, websockets.WebSocketClientProtocol] = {}
        self.whisper_model = whisper.load_model("base")
        self.rag_manager = RAGManager()
        self.session_ids: Dict[WebSocket, str] = {}

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)
        session_id = str(uuid.uuid4())
        self.session_ids[websocket] = session_id

        # Connect to OpenAI's WebSocket
        openai_ws = await websockets.connect(
            'wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-10-01',
            extra_headers={
                'Authorization': f'Bearer {settings.OPENAI_API_KEY}',
                'Content-Type': 'application/json',
                'OpenAI-Beta': 'realtime=v1'
            }
        )
        self.openai_ws_connections[websocket] = openai_ws

        # Send initial configuration
        await openai_ws.send(json.dumps({
            "type": "configure",
            "model": "gpt-4o-realtime-preview-2024-10-01",
            "metadata": {
                "user_id": "default",
                "session_id": session_id
            },
            "modalities": ["text", "audio"],
            "voice": "alloy",
            "input_audio_format": "pcm16",
            "output_audio_format": "pcm16",
            "temperature": 0.8,
            "max_response_output_tokens": 4096
        }))

    async def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)
            if websocket in self.openai_ws_connections:
                try:
                    await self.openai_ws_connections[websocket].close()
                finally:
                    del self.openai_ws_connections[websocket]
            if websocket in self.session_ids:
                del self.session_ids[websocket]

    async def send_message(self, message: Dict, websocket: WebSocket):
        if websocket in self.active_connections:
            try:
                await websocket.send_json(message)
            except Exception as e:
                print(f"Error sending message: {str(e)}")

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
                    results = self.rag_manager.query_documents(text)
                    context = "\n".join([doc["content"] for doc in results])
                    citations = [{"content": doc["content"], "metadata": doc["metadata"]} for doc in results]

                    # Format message for Realtime API
                    openai_ws = self.openai_ws_connections[websocket]

                    # Send audio buffer append event with base64 encoded audio
                    await openai_ws.send(json.dumps({
                        "type": "input_audio_buffer.append",
                        "audio": base64.b64encode(audio_data).decode('utf-8')
                    }))

                    # Send audio buffer flush event
                    await openai_ws.send(json.dumps({
                        "type": "input_audio_buffer.flush"
                    }))

                    # Send response creation event with context
                    await openai_ws.send(json.dumps({
                        "type": "response.create",
                        "response": {
                            "modalities": ["text", "audio"],
                            "instructions": f"Context: {context}\nUser Query: {text}",
                            "voice": "alloy"
                        }
                    }))

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
                print(f"Error in forward_audio: {str(e)}")
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
                print("OpenAI WebSocket connection closed")
                return None
            except json.JSONDecodeError as e:
                print(f"JSON decode error: {str(e)}")
                return None
            except Exception as e:
                print(f"Error receiving OpenAI response: {str(e)}")
                return None

manager = ConnectionManager()

@router.websocket("/ws")
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
                print(f"Unexpected WebSocket error: {str(e)}")
                await manager.send_message({
                    "type": "error",
                    "content": "An unexpected error occurred while processing audio",
                    "status": "error"
                }, websocket)

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
                response_type = response.get("type")
                if response_type == "error":
                    error_msg = response.get("error", {}).get("message", "Unknown error")
                    await manager.send_message({
                        "type": "error",
                        "content": error_msg,
                        "status": "error"
                    }, websocket)
                elif response_type == "audio_data":
                    await manager.send_message({
                        "type": "audio",
                        "content": response.get("audio"),
                        "status": "success"
                    }, websocket)
                elif response_type == "text":
                    await manager.send_message({
                        "type": "text",
                        "content": response.get("text"),
                        "status": "success"
                    }, websocket)
                elif response_type == "session.created":
                    await manager.send_message({
                        "type": "session.created",
                        "status": "success"
                    }, websocket)
                elif response_type == "response.completed":
                    await manager.send_message({
                        "type": "response.completed",
                        "status": "success"
                    }, websocket)
            await asyncio.sleep(0.1)  # Small delay to prevent busy waiting
    except Exception as e:
        print(f"Error in OpenAI response handler: {str(e)}")
