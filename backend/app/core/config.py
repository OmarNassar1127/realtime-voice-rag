import os
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

class Settings:
    PROJECT_NAME: str = "VoiceRAG"
    VERSION: str = "1.0.0"
    API_V1_STR: str = "/api/v1"

    # OpenAI Configuration
    OPENAI_API_KEY: str = os.getenv("OPENAI_API_KEY")
    MODEL_NAME: str = os.getenv("MODEL_NAME", "gpt-4o-realtime-preview-2024-10-01")

    # Server Configuration
    HOST: str = os.getenv("HOST", "localhost")
    PORT: int = int(os.getenv("PORT", 8000))
    WEBSOCKET_PATH: str = os.getenv("WEBSOCKET_PATH", "/realtime")

    # Document Storage Configuration
    DOCUMENT_STORE_PATH: str = os.getenv("DOCUMENT_STORE_PATH", "./data/documents")
    VECTOR_DB_PATH: str = os.getenv("VECTOR_DB_PATH", "./data/vector_store")
    MAX_FILE_SIZE: int = int(os.getenv("MAX_FILE_SIZE", 50000000))  # 50MB default
    ALLOWED_FILE_TYPES: list = os.getenv("ALLOWED_FILE_TYPES", "pdf,txt,doc,docx").split(",")

settings = Settings()
