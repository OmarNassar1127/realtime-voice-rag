from fastapi import WebSocket, WebSocketDisconnect, HTTPException
from typing import List, Optional
import asyncio
import logging
import json
import os
import websockets
import base64
from app.api.services.rag_service import RAGService

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

SUPPORTED_PROTOCOLS = ["realtime"]
OPENAI_API_KEY = "sk-test-key-123456789"  # Hardcoded test key for development
OPENAI_WS_URL = "wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-10-01"

class ConnectionManager:
    def __init__(self):
        self.active_connections: List[WebSocket] = []
        self.openai_connections: dict = {}  # Maps client WebSocket to OpenAI WebSocket
        self.sessions: dict = {}  # Maps client WebSocket to session ID
        self.audio_buffers: dict = {}  # Maps session ID to audio buffer
        self.rag_service = RAGService()  # Initialize RAG service for document retrieval

    async def connect(self, websocket: WebSocket):
        try:
            # Get requested protocols
            requested_protocol = websocket.headers.get("sec-websocket-protocol")
            logger.info(f"Requested protocol: {requested_protocol}")

            # Validate protocol - only accept if realtime protocol is explicitly requested
            if not requested_protocol or "realtime" not in [p.strip() for p in requested_protocol.split(",")]:
                logger.error("Client must request 'realtime' protocol")
                await websocket.close(code=1002, reason="realtime protocol required")
                return

            await websocket.accept(subprotocol="realtime")
            self.active_connections.append(websocket)
            logger.info("New WebSocket connection accepted with realtime protocol")

            # Connect to OpenAI WebSocket and initialize session
            try:
                logger.info(f"Connecting to OpenAI WebSocket at {OPENAI_WS_URL}")
                openai_websocket = await websockets.connect(
                    OPENAI_WS_URL,
                    extra_headers={
                        "Authorization": f"Bearer {OPENAI_API_KEY}",
                        "OpenAI-Beta": "realtime=v1"
                    },
                    subprotocols=["realtime"]
                )
                self.openai_connections[websocket] = openai_websocket
                logger.info("OpenAI WebSocket connection established")

                # Send initial connection message to client
                await websocket.send_json({
                    "type": "connection_established",
                    "message": "WebSocket connections established successfully",
                    "protocol": "realtime"
                })

                # Wait for session creation confirmation
                response = await openai_websocket.recv()
                response_data = json.loads(response)
                if response_data.get("type") == "session.created":
                    session_id = response_data.get("session", {}).get("id")
                    self.sessions[websocket] = session_id
                    logger.info(f"Session created with ID: {session_id}")

                    # Configure session for audio output
                    session_config = {
                        "type": "session.update",
                        "output_format": {
                            "type": "audio",
                            "format": "pcm_16",
                            "sample_rate": 24000,
                            "channels": 1
                        },
                        "tools": [{
                            "type": "text-to-speech",
                            "model": "tts-1",
                            "voice": "alloy"
                        }]
                    }
                    await openai_websocket.send(json.dumps(session_config))
                    logger.info("Session configured for audio output")

                    # Forward OpenAI responses to client
                    async def forward_responses():
                        try:
                            while True:
                                response = await openai_websocket.recv()
                                response_data = json.loads(response)
                                logger.info(f"Received response from OpenAI: {response_data.get('type')}")
                                if response_data.get("type") == "response.create":
                                    # Ensure audio data is properly forwarded
                                    if "content" in response_data:
                                        for item in response_data["content"]:
                                            if item.get("type") == "audio":
                                                logger.info(f"Audio response received, length: {len(item.get('data', ''))}")
                                    await websocket.send_text(response)
                                elif response_data.get("type") == "error":
                                    logger.error(f"OpenAI error: {response_data}")
                                    await websocket.send_text(response)
                                else:
                                    # Forward other message types as well
                                    await websocket.send_text(response)
                        except Exception as e:
                            logger.error(f"Error in response forwarding: {str(e)}")
                            await websocket.send_json({
                                "type": "error",
                                "error": "Response forwarding error",
                                "details": str(e)
                            })

                    # Start forwarding responses in background
                    asyncio.create_task(forward_responses())

                    # Send session ID to client
                    await websocket.send_json({
                        "type": "session.created",
                        "session": {"id": session_id}
                    })

                logger.info("Connection established successfully")

            except Exception as e:
                logger.error(f"Error connecting to OpenAI: {str(e)}")
                await websocket.send_json({
                    "type": "error",
                    "error": "Failed to establish OpenAI connection",
                    "details": str(e)
                })
                await self.disconnect(websocket)

        except Exception as e:
            logger.error(f"Error in WebSocket connection: {str(e)}")
            if not websocket.client_state.DISCONNECTED:
                await websocket.close(code=1011, reason=str(e))

    async def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)
            if websocket in self.openai_connections:
                await self.openai_connections[websocket].close()
                del self.openai_connections[websocket]
            if websocket in self.sessions:
                del self.sessions[websocket]
            logger.info("WebSocket connections closed")

    async def send_message(self, message: str, websocket: WebSocket):
        try:
            if websocket in self.sessions:
                session_id = self.sessions[websocket]
                message_data = {
                    "type": "conversation.item.create",
                    "session": {"id": session_id},
                    "content": [{
                        "type": "message",
                        "role": "user",
                        "content": message
                    }]
                }
                await self.openai_connections[websocket].send(json.dumps(message_data))
            else:
                logger.error("No session ID found for websocket")
                await websocket.send_json({
                    "type": "error",
                    "error": "No active session"
                })
        except Exception as e:
            logger.error(f"Error sending message: {str(e)}")
            await self.disconnect(websocket)

manager = ConnectionManager()


async def websocket_endpoint(websocket: WebSocket):
    try:
        await manager.connect(websocket)

        while True:
            try:
                data = await websocket.receive_text()
                logger.info(f"Received message from client: {data}")

                # Parse the message
                try:
                    message_data = json.loads(data)
                    message_type = message_data.get("type", "unknown")
                    logger.info(f"Processing message type: {message_type}")

                    # Handle different message types
                    if message_type == "ping":
                        await websocket.send_json({"type": "pong"})
                    elif message_type == "conversation.item.create":
                        # Forward the conversation.item.create message directly to OpenAI
                        if websocket in manager.openai_connections:
                            logger.info(f"Sending message to OpenAI: {message_data}")
                            # Add session ID to the message if not present
                            if "session" not in message_data:
                                message_data["session"] = {"id": manager.sessions[websocket]}
                            # Enhance message with RAG context
                            enhanced_message = await manager.rag_service.enhance_message_with_context(message_data)
                            logger.info(f"Enhanced message with RAG context: {enhanced_message}")
                            await manager.openai_connections[websocket].send(json.dumps(enhanced_message))
                            # Start receiving responses
                            while True:
                                try:
                                    response = await manager.openai_connections[websocket].recv()
                                    response_data = json.loads(response)
                                    logger.info(f"Received OpenAI response: {response_data}")

                                    # Forward complete response to client
                                    await websocket.send_text(response)

                                    # Break if response is complete or error occurred
                                    if response_data.get("type") in ["response.completed", "error"]:
                                        break
                                except Exception as e:
                                    logger.error(f"Error processing OpenAI response: {str(e)}")
                                    await websocket.send_json({"type": "error", "message": str(e)})
                                    break

                    elif message_type == "response.create":
                        # Forward response creation request to OpenAI
                        if websocket in manager.openai_connections:
                            logger.info(f"Forwarding response request to OpenAI")
                            # Add session ID to the message if not present
                            if "session" not in message_data:
                                message_data["session"] = {"id": manager.sessions[websocket]}
                            # Clean message data and ensure proper audio response format
                            message_data = {
                                "type": "response.create",
                                "session": message_data["session"],
                                "output_format": {
                                    "type": "audio",
                                    "format": "pcm_16",
                                    "sample_rate": 24000,
                                    "channels": 1
                                },
                                "tools": [{
                                    "type": "text-to-speech",
                                    "model": "tts-1",
                                    "voice": "alloy"
                                }]
                            }
                            await manager.openai_connections[websocket].send(json.dumps(message_data))
                            # Start receiving responses
                            while True:
                                try:
                                    response = await manager.openai_connections[websocket].recv()
                                    response_data = json.loads(response)
                                    logger.info(f"Received OpenAI response: {response_data}")

                                    # Forward complete response to client
                                    await websocket.send_text(response)

                                    # Break if response is complete or error occurred
                                    if response_data.get("type") in ["response.completed", "error"]:
                                        break
                                except Exception as e:
                                    logger.error(f"Error processing OpenAI response: {str(e)}")
                                    await websocket.send_json({"type": "error", "message": str(e)})
                                    break

                except json.JSONDecodeError:
                    logger.warning("Received invalid JSON message")
                    await manager.send_message("Invalid message format", websocket)

            except WebSocketDisconnect:
                await manager.disconnect(websocket)
                break
            except Exception as e:
                logger.error(f"Error in websocket communication: {str(e)}")
                await manager.disconnect(websocket)
                break

    except Exception as e:
        logger.error(f"Error in websocket endpoint: {str(e)}")
        await manager.disconnect(websocket)
