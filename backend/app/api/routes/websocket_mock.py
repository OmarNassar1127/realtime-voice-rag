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
            del self.active_connections[websocket]

    async def handle_message(self, websocket: WebSocket, message_data: dict):
        try:
            # Simulate processing delay
            await asyncio.sleep(1)

            if message_data.get("type") == "message":
                # Get enhanced response using RAG service
                enhanced_message = await self.rag_service.enhance_message_with_context(
                    message_data.get("content", "")
                )

                # Send RAG-enhanced text response
                await websocket.send_json({
                    "type": "message",
                    "role": "assistant",
                    "content": enhanced_message,
                })

                # Send mock audio response with proper format
                await websocket.send_json({
                    "type": "audio",
                    "format": "pcm_16",
                    "sample_rate": 24000,
                    "channels": 1,
                    "data": self.rag_service.get_mock_audio()
                })
            else:
                logger.warning(f"Unsupported message type: {message_data.get('type')}")

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
