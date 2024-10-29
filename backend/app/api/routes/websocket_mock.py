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
        await websocket.accept(subprotocol="realtime")
        self.active_connections[websocket] = {"session_id": "mock_session"}

        # Send connection established message
        await websocket.send_json({
            "type": "connection_established",
            "message": "WebSocket connection established successfully",
            "protocol": "realtime"
        })

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
