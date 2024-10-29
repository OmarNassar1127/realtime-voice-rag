import os
from typing import List, Dict, Any
from langchain_community.vectorstores import FAISS
from langchain_openai import OpenAIEmbeddings
from langchain.text_splitter import RecursiveCharacterTextSplitter
from langchain_community.document_loaders import TextLoader
import logging

logger = logging.getLogger(__name__)

class RAGService:
    def __init__(self):
        self.embeddings = OpenAIEmbeddings(openai_api_key="sk-test-key-123456789")  # Hardcoded test key for development
        self.vector_store = None
        self.text_splitter = RecursiveCharacterTextSplitter(
            chunk_size=1000,
            chunk_overlap=200,
            length_function=len,
        )
        self.initialize_vector_store()

    def initialize_vector_store(self):
        """Initialize an empty vector store if none exists."""
        if not self.vector_store:
            self.vector_store = FAISS.from_texts(
                [""], self.embeddings
            )
            logger.info("Initialized empty vector store")

    async def process_document(self, file_path: str) -> bool:
        """Process a document and add it to the vector store."""
        try:
            loader = TextLoader(file_path)
            documents = loader.load()
            texts = self.text_splitter.split_documents(documents)
            
            if not self.vector_store:
                self.vector_store = FAISS.from_documents(texts, self.embeddings)
            else:
                self.vector_store.add_documents(texts)
            
            logger.info(f"Successfully processed document: {file_path}")
            return True
        except Exception as e:
            logger.error(f"Error processing document: {str(e)}")
            return False

    async def get_relevant_context(self, query: str, k: int = 3) -> List[Dict[str, Any]]:
        """Retrieve relevant context for a given query."""
        try:
            if not self.vector_store:
                logger.warning("No documents in vector store")
                return []

            results = self.vector_store.similarity_search_with_score(query, k=k)
            
            context = []
            for doc, score in results:
                context.append({
                    "content": doc.page_content,
                    "metadata": doc.metadata,
                    "relevance_score": float(score)
                })
            
            return context
        except Exception as e:
            logger.error(f"Error retrieving context: {str(e)}")
            return []

    def format_context_for_prompt(self, context: List[Dict[str, Any]]) -> str:
        """Format retrieved context into a prompt-friendly string."""
        if not context:
            return ""
        
        formatted_context = "Here is some relevant information:\n\n"
        for idx, item in enumerate(context, 1):
            formatted_context += f"{idx}. {item['content']}\n"
            if item.get('metadata'):
                formatted_context += f"Source: {item['metadata'].get('source', 'Unknown')}\n"
            formatted_context += "\n"
        
        return formatted_context

    async def enhance_message_with_context(self, message_data: Dict[str, Any]) -> Dict[str, Any]:
        """Enhance a message with relevant context before sending to OpenAI."""
        try:
            # Extract the user's message from the content
            user_message = ""
            for content in message_data.get("content", []):
                if content.get("role") == "user" and content.get("type") == "message":
                    user_message = content.get("content", "")
                    break
            
            if not user_message:
                return message_data

            # Get relevant context
            context = await self.get_relevant_context(user_message)
            if not context:
                return message_data

            # Format context
            context_str = self.format_context_for_prompt(context)
            
            # Add context to the message
            enhanced_content = message_data.get("content", []).copy()
            system_message = {
                "type": "message",
                "role": "system",
                "content": f"Use the following context to help answer the user's question:\n\n{context_str}"
            }
            enhanced_content.insert(0, system_message)
            
            # Update message data with enhanced content
            enhanced_message = message_data.copy()
            enhanced_message["content"] = enhanced_content
            
            return enhanced_message
        except Exception as e:
            logger.error(f"Error enhancing message with context: {str(e)}")
            return message_data
