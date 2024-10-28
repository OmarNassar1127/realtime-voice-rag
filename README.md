# VoiceRAG Assistant

A real-time voice interface application that uses RAG (Retrieval Augmented Generation) to provide AI-powered responses based on your document knowledge base. Built with React and FastAPI, powered by OpenAI's GPT-4o Realtime API.

## Features

- **Voice Interface**: Real-time voice input processing using browser's microphone
- **Document Management**: Upload and manage your knowledge base documents
- **RAG Integration**: AI-powered answers based on your uploaded documents
- **Real-time Audio Responses**: Natural voice responses using OpenAI's GPT-4o
- **Citation Display**: View source documents used to generate responses

## Prerequisites

- Node.js (v16 or higher)
- Python (3.8 or higher)
- Poetry (Python dependency management)
- pnpm (Node.js package manager)
- OpenAI API key with access to GPT-4o Realtime API
- A modern web browser with microphone support

## Local Development Setup

1. **Clone the repository**
   ```bash
   git clone https://github.com/OmarNassar1127/realtime-voice-rag.git
   cd realtime-voice-rag
   ```

2. **Backend Setup**
   ```bash
   cd backend

   # Install Python dependencies using Poetry
   poetry install

   # Create .env file from example
   cp ../.env.example .env

   # Update .env with your OpenAI API key and configuration
   # OPENAI_API_KEY=your_api_key_here (no quotes needed)
   # OPENAI_BETA=realtime=v1
   # MODEL_NAME=gpt-4o-realtime-preview-2024-10-01

   # Start the backend server
   poetry run uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
   ```

3. **Frontend Setup**
   ```bash
   cd ../frontend

   # Install Node.js dependencies
   pnpm install

   # Start the frontend development server
   pnpm dev
   ```

4. **Access the Application**
   - Frontend: http://localhost:5173
   - Backend API: http://localhost:8000
   - API Documentation: http://localhost:8000/docs
   - WebSocket endpoint: ws://localhost:8000/ws

## Usage Guide

1. **Document Management**
   - Use the Document Management section to upload your knowledge base documents
   - Supported formats: PDF, TXT, DOC, DOCX
   - Maximum file size: 50MB
   - Documents are processed and indexed for RAG functionality
   - View and manage uploaded documents in the document list

2. **Voice Interface**
   - Click the microphone button to start recording
   - Speak your question clearly
   - The system will process your voice input in real-time
   - Listen to the AI's response through your speakers
   - View relevant citations from your knowledge base
   - Real-time transcription appears as you speak

3. **Best Practices**
   - Use a quiet environment for better voice recognition
   - Keep questions focused and specific
   - Upload relevant documents to improve answer quality
   - Check citations to verify source information
   - Ensure stable internet connection for WebSocket communication

## Environment Variables

Create a `.env` file in the backend directory using the provided `.env.example` as a template. Required variables include:

- `OPENAI_API_KEY`: Your OpenAI API key (required, no quotes needed)
- `OPENAI_BETA`: Set to 'realtime=v1' for Realtime API access
- `MODEL_NAME`: OpenAI model name (default: gpt-4o-realtime-preview-2024-10-01)
- `WEBSOCKET_PATH`: WebSocket endpoint path (default: /ws)
- `CORS_ORIGINS`: Allowed CORS origins (default: http://localhost:5173)
- Additional configuration variables as specified in `.env.example`

## Troubleshooting

1. **Microphone Issues**
   - Ensure your browser has microphone permissions
   - Check if the correct input device is selected
   - Verify microphone is working in system settings

2. **Document Upload Issues**
   - Verify file format is supported
   - Check file size is within limits
   - Ensure proper file permissions

3. **API Connection Issues**
   - Verify OpenAI API key is correct
   - Check network connectivity
   - Ensure backend server is running

## License

This project is licensed under the MIT License - see the LICENSE file for details.
