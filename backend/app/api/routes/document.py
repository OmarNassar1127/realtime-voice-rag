from fastapi import APIRouter, HTTPException, UploadFile, File
from pydantic import BaseModel
from app.api.services.mock_rag_service import MockRAGService
import logging
from typing import Dict, Any, List
from fastapi.responses import JSONResponse

router = APIRouter()
logger = logging.getLogger(__name__)

rag_service = MockRAGService()

class DocumentInput(BaseModel):
    content: str
    metadata: Dict[str, Any]

class DocumentOutput(BaseModel):
    id: str
    content: str
    metadata: Dict[str, Any]

@router.post("/upload")
async def upload_document(file: UploadFile = File(...)):
    try:
        # Read file content
        content = await file.read()
        content_str = content.decode('utf-8')

        # Process the document using RAG service
        metadata = {"filename": file.filename}
        success = await rag_service.process_document(content_str, metadata)

        if not success:
            raise HTTPException(status_code=400, detail="Failed to process document")

        return JSONResponse(content={
            "message": "Document uploaded and processed successfully",
            "filename": file.filename
        })
    except UnicodeDecodeError:
        logger.error("Failed to decode file content")
        raise HTTPException(status_code=400, detail="Invalid file format. Only text files are supported.")
    except Exception as e:
        logger.error(f"Error processing document: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/list")
async def list_documents():
    try:
        documents = await rag_service.get_documents()
        # Transform the response to match frontend expectations
        files = [doc.get("metadata", {}).get("filename", f"document_{doc['id']}") for doc in documents]
        return JSONResponse(content={"files": files})
    except Exception as e:
        logger.error(f"Error listing documents: {str(e)}")
        return JSONResponse(content={"files": []})

@router.delete("/{doc_id}")
async def delete_document(doc_id: str):
    try:
        success = await rag_service.delete_document(doc_id)
        if not success:
            raise HTTPException(status_code=404, detail="Document not found")
        return JSONResponse(content={"message": "Document deleted successfully"})
    except Exception as e:
        logger.error(f"Error deleting document: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))
