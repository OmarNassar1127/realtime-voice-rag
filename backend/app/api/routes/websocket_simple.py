from fastapi import WebSocket, WebSocketDisconnect, HTTPException
from typing import List, Optional
import logging
import json
import os
import websockets
import asyncio

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

SUPPORTED_PROTOCOLS = ["realtime"]
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
OPENAI_WS_URL = "wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-10-01"

class ConnectionManager:
    def __init__(self):
        self.active_connections: List[WebSocket] = []
        self.openai_connections: dict = {}  # Maps client WebSocket to OpenAI WebSocket

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
            logger.info("WebSocket connections closed")

    async def send_message(self, message: str, websocket: WebSocket):
        try:
            await websocket.send_text(json.dumps({
                "type": "message",
                "content": message,
                "protocol": websocket.accepted_subprotocol
            }))
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
                            await manager.openai_connections[websocket].send(data)
                            # Start receiving responses
                            while True:
                                try:
                                    response = await manager.openai_connections[websocket].recv()
                                    response_data = json.loads(response)
                                    logger.info(f"Received OpenAI response: {response_data}")

                                    # Forward response to client
                                    await websocket.send_text(response)

                                    # Break if response is complete or error occurred
                                    if response_data.get("type") in ["response.completed", "error"]:
                                        break
                                except Exception as e:
                                    logger.error(f"Error processing OpenAI response: {str(e)}")
                                    await websocket.send_json({"type": "error", "message": str(e)})
                                    break

                    elif message_type in ["input_audio_buffer.append", "response.create"]:
                        # Forward audio data or response creation request to OpenAI
                        if websocket in manager.openai_connections:
                            logger.info(f"Forwarding audio data to OpenAI")
                            await manager.openai_connections[websocket].send(data)
                            # Start receiving responses
                            while True:
                                try:
                                    response = await manager.openai_connections[websocket].recv()
                                    response_data = json.loads(response)
                                    logger.info(f"Received OpenAI audio response: {response_data}")

                                    # Forward response to client
                                    await websocket.send_text(response)

                                    # Break if response is complete or error occurred
                                    if response_data.get("type") in ["response.completed", "error"]:
                                        break
                                except Exception as e:
                                    logger.error(f"Error processing OpenAI audio response: {str(e)}")
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
