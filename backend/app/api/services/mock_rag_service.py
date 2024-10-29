from typing import List, Dict, Any
import base64

class MockRAGService:
    def __init__(self):
        self.documents = []
        # Mock audio data (empty PCM buffer)
        self.mock_audio = base64.b64encode(bytes(1000)).decode('utf-8')

    async def process_document(self, content: str, metadata: Dict[str, Any] = None) -> bool:
        """Mock document processing."""
        self.documents.append({
            "content": content,
            "metadata": metadata or {}
        })
        return True

    async def get_relevant_context(self, query: str) -> List[str]:
        """Mock context retrieval."""
        return ["This is a mock context from the RAG service."]

    async def format_context_for_prompt(self, context: List[str]) -> str:
        """Mock context formatting."""
        return "\n".join(context)

    async def enhance_message_with_context(self, message: str) -> str:
        """Mock message enhancement with context."""
        context = await self.get_relevant_context(message)
        formatted_context = await self.format_context_for_prompt(context)
        return f"Context: {formatted_context}\nUser message: {message}"

    def get_mock_audio(self) -> str:
        """Get mock audio data."""
        return self.mock_audio
