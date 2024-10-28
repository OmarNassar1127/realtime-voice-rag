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

python
    async def connect(self, websocket: WebSocket):
        try:
            await websocket.accept()
            print("WebSocket connection accepted")
            self.active_connections.append(websocket)
            session_id = str(uuid.uuid4())
            self.session_ids[websocket] = session_id

            try:
                message = await websocket.receive_text()
                print(f"Received message from client: {message}")
                message_data = json.loads(message)

                if message_data.get("type") != "session.create":
                    print(f"Unexpected message type: {message_data.get('type')}")
                    raise ValueError("Expected session.create message")

                print(f"Processing session.create message")

                # Connect to OpenAI's WebSocket with exact configuration
                openai_ws = await websockets.connect(
                    'wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-10-01',
                    extra_headers={
                        'Authorization': f'Bearer {settings.OPENAI_API_KEY}',
                        'OpenAI-Beta': 'realtime=v1'
                    },
                    subprotocols=['webcast-protocol']
                )
                print("Connected to OpenAI WebSocket")
                self.openai_ws_connections[websocket] = openai_ws

                # Send session creation message to OpenAI
                session_message = {
                    "type": "session.create",
                    "session": {
                        "model": "gpt-4o-realtime-preview-2024-10-01",
                        "modalities": ["text", "audio"],
                        "voice": "alloy",
                        "input_audio_format": {
                            "type": "pcm16",
                            "sampling_rate": 24000,
                            "channels": 1,
                            "endianness": "little"
                        },
                        "output_audio_format": {
                            "type": "pcm16",
                            "sampling_rate": 24000,
                            "channels": 1,
                            "endianness": "little"
                        },
                        "temperature": 0.7,
                        "max_tokens": 4096,
                        "stream": true
                    }
                }
                await openai_ws.send(json.dumps(session_message))
                print("Sent session creation message to OpenAI")

                # Wait for OpenAI's response with timeout
                try:
                    response = await asyncio.wait_for(openai_ws.recv(), timeout=10.0)
                    print(f"Received OpenAI response: {response}")
                    response_data = json.loads(response)

                    if response_data.get("type") == "error":
                        error_details = response_data.get("error", {})
                        print(f"OpenAI error response: {error_details}")
                        raise ValueError(f"OpenAI configuration error: {error_details}")

                    if response_data.get("type") == "session.created":
                        # Send success response to client
                        await websocket.send_json({
                            "type": "session.created",
                            "session_id": session_id,
                            "status": "success"
                        })
                        print(f"Session created successfully: {session_id}")

                        # Start background task to handle OpenAI responses
                        asyncio.create_task(self.receive_openai_response(openai_ws, websocket))
                    else:
                        raise ValueError(f"Unexpected response type: {response_data.get('type')}")

                except asyncio.TimeoutError:
                    print("OpenAI connection timeout")
                    raise ValueError("OpenAI connection timeout - no response received")

            except json.JSONDecodeError as e:
                print(f"Invalid JSON in message: {str(e)}")
                await websocket.send_json({
                    "type": "error",
                    "error": "Invalid message format",
                    "details": str(e)
                })
                await websocket.close(code=1003)
                return
            except Exception as e:
                print(f"Error during session creation: {str(e)}")
                await websocket.send_json({
                    "type": "error",
                    "error": "Session creation failed",
                    "details": str(e)
                })
                await websocket.close(code=1011)
                return

        except Exception as e:
            print(f"Error in connect: {str(e)}")
            if websocket in self.active_connections:
                self.active_connections.remove(websocket)
            raise

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

                    # Send audio data
                    await openai_ws.send(json.dumps({
                        "type": "audio",
                        "audio": {
                            "data": base64.b64encode(audio_data).decode('utf-8'),
                            "format": {
                                "type": "pcm16",
                                "sampling_rate": 24000
                            }
                        }
                    }))

                    # Send context and query
                    await openai_ws.send(json.dumps({
                        "type": "text",
                        "text": f"Context: {context}\nUser Query: {text}"
                    }))

                    # Send transcription and citations to client
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

    async def receive_openai_response(self, openai_ws: WebSocket, client_ws: WebSocket):
        """Handle responses from OpenAI WebSocket and forward to client."""
        try:
            while True:
                if client_ws not in self.active_connections:
                    print("Client disconnected, stopping OpenAI response handler")
                    break

                try:
                    response = await openai_ws.recv()
                    response_data = json.loads(response)
                    print(f"Received from OpenAI: {response_data.get('type', 'unknown')}")

                    if response_data.get("type") == "error":
                        print(f"OpenAI error: {response_data.get('error', {})}")
                        await client_ws.send_json({"type": "error", "error": response_data.get("error")})
                        break

                    await client_ws.send_json(response_data)
                except websockets.exceptions.ConnectionClosed:
                    print("OpenAI WebSocket connection closed")
                    break
                except json.JSONDecodeError as e:
                    print(f"JSON decode error: {str(e)}")
                    continue
                except Exception as e:
                    print(f"Error handling OpenAI response: {str(e)}")
                    break
        finally:
            if openai_ws in self.openai_ws_connections.values():
                await openai_ws.close()

manager = ConnectionManager()

@router.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)

    # Start response listener task
    response_task = asyncio.create_task(handle_openai_responses(websocket))

    try:
        while True:
            # Receive message from client
            try:
                message = await websocket.receive()
                if message["type"] == "websocket.receive":
                    if "bytes" in message:
                        # Handle binary audio data
                        data = message["bytes"]
                        await manager.forward_audio(data, websocket)
                    elif "text" in message:
                        # Handle text messages (like session.create)
                        text_data = json.loads(message["text"])
                        if text_data.get("type") == "session.create":
                            # Session creation is handled in manager.connect
                            continue
                        else:
                            print(f"Received text message: {text_data}")

            except json.JSONDecodeError as e:
                print(f"JSON decode error: {str(e)}")
                await manager.send_message({
                    "type": "error",
                    "content": "Invalid JSON message format",
                    "status": "error"
                }, websocket)
            except Exception as e:
                # Handle general errors
                print(f"Unexpected WebSocket error: {str(e)}")
                await manager.send_message({
                    "type": "error",
                    "content": "An unexpected error occurred while processing message",
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
                elif response_type == "audio":
                    await manager.send_message({
                        "type": "audio",
                        "content": response.get("audio", {}).get("data"),
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
                elif response_type == "response.end":
                    await manager.send_message({
                        "type": "response.completed",
                        "status": "success"
                    }, websocket)
            await asyncio.sleep(0.1)  # Small delay to prevent busy waiting
    except Exception as e:
        print(f"Error in OpenAI response handler: {str(e)}")
