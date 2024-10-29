from typing import List, Dict, Any
import base64
import numpy as np
import math

class MockRAGService:
    def __init__(self):
        self.documents = []
        # Generate a 1-second 440Hz sine wave at 24kHz sample rate
        sample_rate = 24000
        duration = 1.0
        t = np.linspace(0, duration, int(sample_rate * duration), False)
        # Generate a more complex waveform with multiple frequencies for better audibility
        samples = (
            np.sin(2 * np.pi * 440 * t) * 0.5 +  # A4 note
            np.sin(2 * np.pi * 880 * t) * 0.3 +  # A5 note
            np.sin(2 * np.pi * 1320 * t) * 0.2   # E6 note
        )
        # Apply envelope to avoid clicks
        envelope = np.concatenate([
            np.linspace(0, 1, int(0.01 * sample_rate)),  # 10ms fade in
            np.ones(int(0.98 * sample_rate)),            # sustain
            np.linspace(1, 0, int(0.01 * sample_rate))   # 10ms fade out
        ])
        samples = samples * envelope * 32767  # Scale to 16-bit range
        # Convert to 16-bit PCM and encode as base64
        audio_data = samples.astype(np.int16).tobytes()
        self.mock_audio = base64.b64encode(audio_data).decode('utf-8')

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

    async def get_documents(self) -> List[Dict[str, Any]]:
        """Get list of processed documents."""
        return [{"id": str(i), "content": doc["content"], "metadata": doc["metadata"]}
                for i, doc in enumerate(self.documents)]

    async def delete_document(self, doc_id: str) -> bool:
        """Delete a document by its ID."""
        try:
            doc_index = int(doc_id)
            if 0 <= doc_index < len(self.documents):
                self.documents.pop(doc_index)
                return True
            return False
        except (ValueError, IndexError):
            return False
