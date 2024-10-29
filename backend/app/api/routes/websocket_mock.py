import asyncio
import json
import base64
import os
from fastapi import WebSocket
import logging
from app.api.services.mock_rag_service import MockRAGService

logger = logging.getLogger(__name__)

class MockConnectionManager:
    def __init__(self):
        self.active_connections = {}
        self.rag_service = MockRAGService()
        self.audio_buffers = {}  # Store audio buffers per session

    async def connect(self, websocket: WebSocket):
        try:
            # Validate WebSocket protocol
            protocols = websocket.scope.get("subprotocols", [])
            if "realtime" not in protocols:
                logger.warning("Connection rejected: Missing 'realtime' protocol")
                await websocket.close(code=4000, reason="Missing 'realtime' protocol")
                return

            # Accept connection with realtime protocol
            await websocket.accept(subprotocol="realtime")

            # Generate unique session ID
            session_id = f"mock_session_{len(self.active_connections) + 1}"
            self.active_connections[websocket] = {
                "session_id": session_id,
                "created_at": asyncio.get_event_loop().time()
            }
            # Initialize audio buffer for the session
            self.audio_buffers[session_id] = []

            # Send connection established message
            await websocket.send_json({
                "type": "session.created",
                "session": {
                    "id": session_id,
                    "created_at": self.active_connections[websocket]["created_at"]
                }
            })
            logger.info(f"WebSocket connection established with session ID: {session_id}")

        except Exception as e:
            logger.error(f"Error establishing WebSocket connection: {str(e)}")
            await websocket.close(code=1011, reason="Internal server error")
            return

    async def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            session_id = self.active_connections[websocket]["session_id"]
            if session_id in self.audio_buffers:
                del self.audio_buffers[session_id]
            del self.active_connections[websocket]

    async def handle_message(self, websocket: WebSocket, message_data: dict):
        try:
            session_id = self.active_connections[websocket]["session_id"]
            message_type = message_data.get("type")

            # Handle session update
            if message_type == "session.update":
                await websocket.send_json({
                    "type": "session.update.ack",
                    "session": {"id": session_id}
                })
                return

            # Handle audio buffer append
            if message_type == "input_audio_buffer.append":
                if "data" in message_data:
                    self.audio_buffers[session_id].append(message_data["data"])
                await websocket.send_json({
                    "type": "input_audio_buffer.append.ack",
                    "session": {"id": session_id}
                })
                return

            # Handle audio buffer commit
            if message_type == "input_audio_buffer.commit":
                # Clear buffer after processing
                self.audio_buffers[session_id] = []
                await websocket.send_json({
                    "type": "input_audio_buffer.commit.ack",
                    "session": {"id": session_id}
                })
                return

            # Handle conversation item create
            if message_type == "conversation.item.create":
                content = message_data.get("content", [{}])[0].get("text", "")
                enhanced_message = await self.rag_service.enhance_message_with_context(content)

                await websocket.send_json({
                    "type": "conversation.item.created",
                    "session": {"id": session_id}
                })
                return

            # Handle response create
            if message_type == "response.create":
                mock_audio = self.rag_service.get_mock_audio()
                output_format = {
                    "type": "audio",
                    "format": "pcm_16",
                    "sample_rate": 24000,
                    "channels": 1
                }
                await websocket.send_json({
                    "type": "response.created",
                    "session": {"id": session_id},
                    "content": [{
                        "type": "audio",
                        "format": "pcm_16",
                        "sample_rate": 24000,
                        "channels": 1,
                        "data": mock_audio
                    }],
                    "output_format": output_format
                })
                return

            # Handle legacy message type
            if message_type == "message":
                enhanced_message = await self.rag_service.enhance_message_with_context(
                    message_data.get("content", "")
                )
                await websocket.send_json({
                    "type": "message",
                    "role": "assistant",
                    "content": enhanced_message,
                })
                await websocket.send_json({
                    "type": "audio",
                    "format": "pcm_16",
                    "sample_rate": 24000,
                    "channels": 1,
                    "data": self.rag_service.get_mock_audio()
                })
                return

            logger.warning(f"Unsupported message type: {message_type}")

        except Exception as e:
            logger.error(f"Error in handle_message: {str(e)}")
            await websocket.send_json({
                "type": "error",
                "message": f"Error processing message: {str(e)}"
            })

manager = MockConnectionManager()

async def websocket_endpoint(websocket: WebSocket):
    try:
        await manager.connect(websocket)

        while True:
            try:
                message = await websocket.receive_text()
                message_data = json.loads(message)
                await manager.handle_message(websocket, message_data)
            except Exception as e:
                logger.error(f"Error handling message: {str(e)}")
                break
    except Exception as e:
        logger.error(f"WebSocket error: {str(e)}")
    finally:
        await manager.disconnect(websocket)
