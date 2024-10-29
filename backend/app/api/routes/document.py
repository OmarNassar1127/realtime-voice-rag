from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from app.api.services.mock_rag_service import MockRAGService
import logging
from typing import Dict, Any

router = APIRouter()
logger = logging.getLogger(__name__)

rag_service = MockRAGService()

class DocumentInput(BaseModel):
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
