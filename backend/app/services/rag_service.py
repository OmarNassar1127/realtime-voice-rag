from langchain.text_splitter import RecursiveCharacterTextSplitter
import chromadb
from sentence_transformers import SentenceTransformer
import os
import json
import websockets
import base64
from typing import List, Dict, Optional, Tuple
from ..core.config import settings

class RAGService:
    class SentenceTransformerEmbedding:
        def __init__(self, model):
            self.model = model

        def __call__(self, input):
            return self.model.encode(input).tolist()

    def __init__(self):
        self.text_splitter = RecursiveCharacterTextSplitter(
            chunk_size=1000,
            chunk_overlap=200,
            separators=["\n\n", "\n", " ", ""]
        )

        # Initialize sentence transformer for embeddings
        self.embedding_model = SentenceTransformer('all-MiniLM-L6-v2')

        # Initialize ChromaDB with sentence transformer embeddings
        self.chroma_client = chromadb.PersistentClient(path="./data/chromadb")
        self.collection = self.chroma_client.get_or_create_collection(
            name="documents",
            metadata={"hnsw:space": "cosine"},
            embedding_function=self.SentenceTransformerEmbedding(self.embedding_model)
        )

        self.websocket_url = "wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-10-01"
        self.websocket_headers = {
            "Authorization": f"Bearer {settings.OPENAI_API_KEY}",
            "Content-Type": "application/json",
            "OpenAI-Beta": "realtime=v1"
        }

        # Create data directory if it doesn't exist
        os.makedirs("./data/documents", exist_ok=True)

    async def add_document(self, content: str, metadata: Dict = None) -> str:
        """Add a document to the document store"""
        texts = self.text_splitter.split_text(content)
        doc_id = str(self.collection.count())

        # Add chunks to ChromaDB
        self.collection.add(
            documents=texts,
            ids=[f"{doc_id}_{i}" for i in range(len(texts))],
            metadatas=[{**(metadata or {}), "chunk_id": i} for i in range(len(texts))]
        )
        return doc_id

    async def search(self, query: str, k: int = 3) -> List[Dict]:
        """Search for relevant documents using ChromaDB's similarity search"""
        try:
            results = self.collection.query(
                query_texts=[query],
                n_results=k,
                include=['documents', 'metadatas', 'distances']
            )

            documents = []
            if results['documents'] and len(results['documents'][0]) > 0:
                for i in range(len(results['documents'][0])):
                    documents.append({
                        "id": results['ids'][0][i].split('_')[0],
                        "content": results['documents'][0][i],
                        "metadata": results['metadatas'][0][i],
                        "score": 1 - results['distances'][0][i]  # Convert distance to similarity score
                    })
            return documents
        except Exception as e:
            print(f"Error processing query '{query}': {str(e)}")
            return []

    async def get_context(self, query: str) -> Tuple[str, Optional[str]]:
        """Get context for the query to be used in the conversation"""
        try:
            results = await self.search(query)
            if not results:
                return query, None

            context = "\n\n".join([
                f"Document {i+1}:\n{doc['content']}"
                for i, doc in enumerate(results)
            ])

            formatted_prompt = (
                "Based on the following context, please provide a natural response. "
                "If the context doesn't contain relevant information, respond based on your general knowledge:\n\n"
                f"Context:\n{context}\n\n"
                f"User Query: {query}"
            )

            citations = "\n".join([
                f"[{i+1}] {doc.get('metadata', {}).get('source', 'Unknown source')}"
                for i, doc in enumerate(results)
            ])

            # Connect to GPT-4o Realtime API with proper headers
            headers = {
                "Authorization": f"Bearer {settings.OPENAI_API_KEY}",
                "Content-Type": "application/json",
                "OpenAI-Beta": "realtime=v1"
            }

            async with websockets.connect(
                f"{self.websocket_url}?model={settings.MODEL_NAME}",
                extra_headers=headers
            ) as websocket:
                # Send initial response creation message
                await websocket.send(json.dumps({
                    "type": "response.create",
                    "response": {
                        "modalities": ["text", "audio"],
                        "instructions": formatted_prompt,
                        "voice": "alloy"
                    }
                }))

                # Process the response stream
                while True:
                    response = await websocket.recv()
                    response_data = json.loads(response)

                    if response_data.get("type") == "error":
                        raise Exception(response_data.get("error", {}).get("message", "Unknown error"))

                    if response_data.get("type") == "audio_data":
                        # Return audio data along with citations
                        audio_data = base64.b64decode(response_data.get("audio"))
                        return audio_data, citations

                    if response_data.get("type") == "response.end":
                        break

                return formatted_prompt, citations

        except Exception as e:
            print(f"Error getting context: {e}")
            return query, None

    async def remove_document(self, doc_id: str) -> bool:
        """Remove a document from the document store"""
        try:
            # Get all chunk IDs for the document
            chunk_ids = [
                id for id in self.collection.get()['ids']
                if id.startswith(f"{doc_id}_")
            ]
            # Remove chunks from ChromaDB
            self.collection.delete(ids=chunk_ids)
            return True
        except Exception as e:
            print(f"Error removing document: {e}")
            return False
