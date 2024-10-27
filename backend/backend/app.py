from fastapi import FastAPI, UploadFile, WebSocket, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pathlib import Path
from .rag_processor import RAGProcessor
from .websocket_handler import WebSocketHandler
import asyncio
from typing import List, Dict, Any

app = FastAPI()

# Disable CORS. Do not remove this for full-stack development.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Allows all origins
    allow_credentials=True,
    allow_methods=["*"],  # Allows all methods
    allow_headers=["*"],  # Allows all headers
)

# Initialize RAG processor and WebSocket handler
rag_processor = RAGProcessor()
ws_handler = WebSocketHandler(rag_processor)

@app.get("/healthz")
async def healthz():
    return {"status": "ok"}

@app.post("/upload")
async def upload_document(file: UploadFile):
    """Upload and process a document."""
    try:
        # Validate file type
        allowed_extensions = ['.txt', '.pdf', '.doc', '.docx']
        file_ext = Path(file.filename).suffix.lower()
        if file_ext not in allowed_extensions:
            raise HTTPException(
                status_code=400,
                detail=f"File type not allowed. Allowed types: {allowed_extensions}"
            )

        # Save file
        file_path = rag_processor.upload_dir / file.filename
        with open(file_path, "wb") as buffer:
            content = await file.read()
            buffer.write(content)

        # Process document
        await rag_processor.process_document(str(file_path))

        return {"message": "Document uploaded and processed successfully"}

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/documents")
async def list_documents() -> List[Dict[str, Any]]:
    """List all uploaded documents."""
    try:
        documents = []
        for doc_id, doc_info in rag_processor.documents.items():
            doc_path = Path(doc_info['path'])
            documents.append({
                "id": doc_id,
                "name": doc_path.name,
                "size": doc_path.stat().st_size,
                "uploadedAt": doc_path.stat().st_mtime
            })
        return documents
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.delete("/documents/{doc_id}")
async def delete_document(doc_id: str):
    """Delete a document."""
    try:
        if doc_id in rag_processor.documents:
            file_path = rag_processor.documents[doc_id]['path']
            await rag_processor.remove_document(file_path)
            return {"message": "Document deleted successfully"}
        raise HTTPException(status_code=404, detail="Document not found")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    """WebSocket endpoint for real-time voice processing."""
    try:
        # Connect client WebSocket
        await ws_handler.connect(websocket)

        # Set RAG processor for context
        ws_handler.set_rag_processor(rag_processor)

        # Forward connection to OpenAI Realtime API
        await ws_handler.forward_to_openai(websocket)
    except Exception as e:
        print(f"WebSocket error: {e}")
    finally:
        # Ensure connection is removed on disconnect
        if websocket in ws_handler.active_connections:
            ws_handler.disconnect(websocket)
        await websocket.close()

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
