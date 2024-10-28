from typing import List, Dict, Any
import os
from langchain.text_splitter import RecursiveCharacterTextSplitter
from langchain.vectorstores import FAISS
from langchain.embeddings import OpenAIEmbeddings
from langchain.document_loaders import TextLoader, PyPDFLoader
from pathlib import Path

class RAGManager:
    def __init__(self, documents_dir: str = "documents"):
        self.documents_dir = documents_dir
        self.embeddings = OpenAIEmbeddings()
        self.vector_store = None
        self.initialize_vector_store()

    def initialize_vector_store(self):
        """Initialize or load the vector store."""
        if not os.path.exists(self.documents_dir):
            os.makedirs(self.documents_dir)
            self.vector_store = FAISS.from_texts([""], self.embeddings)
        else:
            # Load existing index if available
            index_path = os.path.join(self.documents_dir, "faiss_index")
            if os.path.exists(index_path):
                self.vector_store = FAISS.load_local(index_path, self.embeddings)
            else:
                self.vector_store = FAISS.from_texts([""], self.embeddings)

    def process_document(self, file_path: str) -> bool:
        """Process a document and add it to the vector store."""
        try:
            # Determine file type and load accordingly
            path = Path(file_path)
            if path.suffix.lower() == '.pdf':
                loader = PyPDFLoader(file_path)
            else:
                loader = TextLoader(file_path)

            documents = loader.load()
            
            # Split documents into chunks
            text_splitter = RecursiveCharacterTextSplitter(
                chunk_size=1000,
                chunk_overlap=200,
                length_function=len,
            )
            texts = text_splitter.split_documents(documents)

            # Add to vector store
            if self.vector_store is None:
                self.vector_store = FAISS.from_documents(texts, self.embeddings)
            else:
                self.vector_store.add_documents(texts)

            # Save the updated index
            self.vector_store.save_local(os.path.join(self.documents_dir, "faiss_index"))
            return True
        except Exception as e:
            print(f"Error processing document: {str(e)}")
            return False

    def query_documents(self, query: str, k: int = 3) -> List[Dict[str, Any]]:
        """Query the vector store for relevant documents."""
        if self.vector_store is None:
            return []

        try:
            results = self.vector_store.similarity_search_with_score(query, k=k)
            return [
                {
                    "content": doc.page_content,
                    "metadata": doc.metadata,
                    "score": score
                }
                for doc, score in results
            ]
        except Exception as e:
            print(f"Error querying documents: {str(e)}")
            return []

    def delete_document(self, file_path: str) -> bool:
        """Delete a document from the system."""
        try:
            if os.path.exists(file_path):
                os.remove(file_path)
                # Note: FAISS doesn't support direct deletion of documents
                # We would need to rebuild the index, which is a limitation
                return True
            return False
        except Exception as e:
            print(f"Error deleting document: {str(e)}")
            return False

    def list_documents(self) -> List[Dict[str, Any]]:
        """List all documents in the documents directory."""
        try:
            documents = []
            for file_path in Path(self.documents_dir).glob("*.*"):
                if file_path.name != "faiss_index":
                    documents.append({
                        "name": file_path.name,
                        "path": str(file_path),
                        "size": os.path.getsize(file_path)
                    })
            return documents
        except Exception as e:
            print(f"Error listing documents: {str(e)}")
            return []
