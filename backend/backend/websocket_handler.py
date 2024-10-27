from fastapi import WebSocket, WebSocketDisconnect
import json
import os
from typing import Dict, List
import websockets
import asyncio
import base64
from .rag_processor import RAGProcessor

class WebSocketHandler:
    def __init__(self, rag_processor: RAGProcessor):
        self.active_connections: List[WebSocket] = []
        self.openai_ws_url = "wss://api.openai.com/v1/realtime"
        self.model = "gpt-4o-realtime-preview-2024-10-01"
        self.rag_processor = rag_processor

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)

    def disconnect(self, websocket: WebSocket):
        self.active_connections.remove(websocket)

    async def forward_to_openai(self, websocket: WebSocket):
        try:
            # Connect to OpenAI's Realtime API
            openai_ws_url = f"{self.openai_ws_url}?model={self.model}"
            headers = {
                "Authorization": f"Bearer {os.getenv('OPENAI_API_KEY')}",
                "OpenAI-Beta": "realtime=v1"
            }

            async with websockets.connect(openai_ws_url, extra_headers=headers) as openai_ws:
                # Initialize the conversation with OpenAI
                init_message = {
                    "type": "response.create",
                    "response": {
                        "modalities": ["text", "audio"],
                        "instructions": "You are a helpful assistant that can engage in voice conversations and answer questions about uploaded documents. Use the provided document context to give accurate answers."
                    }
                }
                await openai_ws.send(json.dumps(init_message))

                # Create tasks for handling bidirectional communication
                async def forward_to_client():
                    try:
                        while True:
                            message = await openai_ws.recv()
                            await websocket.send_text(message)
                    except WebSocketDisconnect:
                        pass

                async def forward_to_openai():
                    try:
                        while True:
                            data = await websocket.receive()

                            if data.get("type") == "bytes":
                                # Handle audio input
                                audio_data = data.get("bytes")
                                # Process voice input through RAG
                                context = await self.rag_processor.get_relevant_context(audio_data)

                                # Send audio data and context to OpenAI
                                message = {
                                    "type": "input_audio_buffer.append",
                                    "input_audio_buffer": {
                                        "audio": base64.b64encode(audio_data).decode('utf-8'),
                                        "context": context
                                    }
                                }
                                await openai_ws.send(json.dumps(message))
                            else:
                                # Forward other message types directly
                                await openai_ws.send(data.get("text", ""))
                    except WebSocketDisconnect:
                        pass

                # Run both forwarding tasks concurrently
                await asyncio.gather(
                    forward_to_client(),
                    forward_to_openai()
                )

        except WebSocketDisconnect:
            self.disconnect(websocket)
        except Exception as e:
            print(f"Error in WebSocket connection: {str(e)}")
            if websocket in self.active_connections:
                self.disconnect(websocket)
