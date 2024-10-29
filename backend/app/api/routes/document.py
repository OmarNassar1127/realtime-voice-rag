from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from app.api.services.mock_rag_service import MockRAGService
import logging
from typing import Dict, Any, List

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

@router.post("/documents")
async def upload_document(document: DocumentInput):
    try:
        # Process the document using RAG service
        success = await rag_service.process_document(document.content, document.metadata)
        if not success:
            raise HTTPException(status_code=400, detail="Failed to process document")

        return {"message": "Document uploaded and processed successfully"}
    except Exception as e:
        logger.error(f"Error processing document: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/documents/list", response_model=List[DocumentOutput])
async def list_documents():
    try:
        documents = await rag_service.get_documents()
        return documents
    except Exception as e:
        logger.error(f"Error listing documents: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))
