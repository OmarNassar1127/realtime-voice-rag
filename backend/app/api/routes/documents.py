from fastapi import APIRouter, UploadFile, File, HTTPException
from ...core.config import settings
from pydantic import BaseModel
import os
import shutil

router = APIRouter()

class DocumentQuery(BaseModel):
    query: str
    document: str

@router.post("/upload")
async def upload_document(file: UploadFile = File(...)):
    # Validate file type
    file_extension = file.filename.split(".")[-1].lower()
    if file_extension not in settings.ALLOWED_FILE_TYPES:
        raise HTTPException(
            status_code=400,
            detail=f"File type not allowed. Allowed types: {settings.ALLOWED_FILE_TYPES}"
        )

    # Create documents directory if it doesn't exist
    os.makedirs(settings.DOCUMENT_STORE_PATH, exist_ok=True)

    file_path = os.path.join(settings.DOCUMENT_STORE_PATH, file.filename)

    try:
        with open(file_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    return {"filename": file.filename, "status": "uploaded"}

@router.get("/list")
async def list_documents():
    try:
        files = []
        for filename in os.listdir(settings.DOCUMENT_STORE_PATH):
            if any(filename.endswith(ext) for ext in settings.ALLOWED_FILE_TYPES):
                files.append(filename)
        return {"files": files}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.delete("/{filename}")
async def delete_document(filename: str):
    file_path = os.path.join(settings.DOCUMENT_STORE_PATH, filename)
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="File not found")

    try:
        os.remove(file_path)
        return {"filename": filename, "status": "deleted"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/query")
async def query_document(query: DocumentQuery):
    try:
        file_path = os.path.join(settings.DOCUMENT_STORE_PATH, query.document)
        if not os.path.exists(file_path):
            raise HTTPException(status_code=404, detail="Document not found")

        # Read document content
        with open(file_path, 'r') as f:
            content = f.read()

        # Split query and content into words for keyword matching
        query_words = set(query.query.lower().split())
        sentences = [s.strip() for s in content.split('.') if s.strip()]

        # Score each sentence based on keyword matches
        best_score = 0
        best_sentence = None

        for sentence in sentences:
            sentence_words = set(sentence.lower().split())
            # Count how many query words appear in the sentence
            score = len(query_words.intersection(sentence_words))
            if score > best_score:
                best_score = score
                best_sentence = sentence

        if best_score > 0:
            return {
                "answer": best_sentence,
                "context": best_sentence,
                "source": query.document
            }
        else:
            return {
                "answer": "No relevant information found in the document.",
                "context": None,
                "source": query.document
            }

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
