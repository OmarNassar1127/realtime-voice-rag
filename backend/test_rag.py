from app.core.rag_manager import RAGManager
import asyncio
import os

async def test_rag():
    rag = RAGManager()

    # Test document addition
    test_docs = [
        ("test_doc.txt", """
        Artificial Intelligence (AI) is revolutionizing how we interact with computers.
        Machine learning models can now understand natural language and context.
        Modern AI systems use advanced algorithms for processing and understanding data.
        Neural networks enable computers to learn patterns from large datasets.
        """),
        ("voice_doc.txt", """
        Voice interfaces represent a major advancement in human-computer interaction.
        Natural Language Processing (NLP) enables computers to understand human speech.
        Modern voice assistants can process context and maintain conversation flow.
        Semantic understanding helps voice interfaces provide relevant responses.
        """),
        ("semantic_doc.txt", """
        Semantic search goes beyond simple keyword matching.
        It understands the meaning and context of search queries.
        Vector embeddings help capture semantic relationships between words.
        Context-aware search provides more relevant results to user queries.
        """)
    ]

    doc_ids = []
    for filename, content in test_docs:
        # Write test content to file
        with open(filename, "w") as f:
            f.write(content)

        # Add document to RAG
        with open(filename, "r") as f:
            content = f.read()
        success = rag.process_document(filename)
        if success:
            doc_ids.append(filename)
            print(f"Added document: {filename}")

    # Test semantic search capabilities
    print("\nTesting Semantic Search Capabilities:")
    queries = [
        "How does AI improve computer interactions?",
        "What makes voice interfaces effective?",
        "How does semantic understanding enhance search?",
        "Explain the role of context in modern AI systems",
        "How do neural networks relate to machine learning?"
    ]

    for i, query in enumerate(queries):
        try:
            # Test search functionality
            search_results = rag.query_documents(query)
            print(f"\nQuery {i}: {query}")
            print("Search Results:")
            if search_results:
                for result in search_results:
                    print(f"- Score: {result.get('score', 'N/A'):.4f}")
                    print(f"- Content: {result['content'][:100]}...")
                    print(f"- Source: {result['metadata'].get('source', 'Unknown')}")
            else:
                print("No results found")

            # Format context and citations
            context = "\n".join([doc["content"] for doc in search_results])
            citations = [{"content": doc["content"], "metadata": doc["metadata"]} for doc in search_results]

            print("\nGenerated Context:")
            print(context)

            # Verify citations
            if citations:
                print("\nCitations:")
                print(citations)
            else:
                print("\nNo citations found")

        except Exception as e:
            print(f"Error processing query '{query}': {e}")

    # Test document removal
    print("\nTesting Document Removal:")
    for doc_id in doc_ids:
        success = await rag.remove_document(doc_id)
        print(f"Removed document {doc_id}: {success}")

        # Verify document was removed by attempting to search
        try:
            results = await rag.search("test query")
            remaining_docs = len(results)
            print(f"Remaining documents after removal: {remaining_docs}")
        except Exception as e:
            print(f"Error verifying document removal: {e}")

    # Cleanup test files
    for filename, _ in test_docs:
        if os.path.exists(filename):
            os.remove(filename)

    print("\nTest completed.")

if __name__ == "__main__":
    asyncio.run(test_rag())
