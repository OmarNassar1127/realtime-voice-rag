import React, { useState, useCallback, useEffect } from 'react';
import {
  Box,
  Button,
  Text,
  VStack,
  HStack,
  useToast,
  List,
  ListItem,
  IconButton,
  Progress,
} from '@chakra-ui/react';
import { FaUpload, FaTrash } from 'react-icons/fa';

const DocumentManager = () => {
  const [documents, setDocuments] = useState([]);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const toast = useToast();

  const fetchDocuments = useCallback(async () => {
    try {
      const response = await fetch(`${import.meta.env.VITE_BACKEND_URL}/api/documents/list`);
      if (!response.ok) {
        throw new Error('Failed to fetch documents');
      }
      const data = await response.json();
      setDocuments(data.files.map(name => ({ id: name, name })));
    } catch (error) {
      console.error('Fetch error:', error);
      toast({
        title: 'Error',
        description: 'Failed to fetch documents',
        status: 'error',
        duration: 3000,
      });
    }
  }, [toast]);

  useEffect(() => {
    fetchDocuments();
  }, [fetchDocuments]);

  const handleFileUpload = useCallback(async (event) => {
    const files = Array.from(event.target.files);
    setIsUploading(true);
    setUploadProgress(0);

    for (const file of files) {
      const formData = new FormData();
      formData.append('file', file);

      try {
        const response = await fetch(`${import.meta.env.VITE_BACKEND_URL}/api/documents/upload`, {
          method: 'POST',
          body: formData,
        });

        if (!response.ok) {
          throw new Error(`Upload failed: ${response.statusText}`);
        }

        const result = await response.json();
        setDocuments(prev => [...prev, { id: result.filename, name: file.name }]);

        toast({
          title: 'Upload Successful',
          description: `${file.name} has been uploaded`,
          status: 'success',
          duration: 3000,
        });
      } catch (error) {
        console.error('Upload error:', error);
        toast({
          title: 'Upload Failed',
          description: error.message,
          status: 'error',
          duration: 3000,
        });
      }

      setUploadProgress(prev => prev + (100 / files.length));
    }

    setIsUploading(false);
    setUploadProgress(0);
    fetchDocuments(); // Refresh the document list after upload
  }, [toast, fetchDocuments]);

  const handleDelete = async (docId, docName) => {
    try {
      const response = await fetch(`${import.meta.env.VITE_BACKEND_URL}/api/documents/${docId}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        throw new Error(`Delete failed: ${response.statusText}`);
      }

      setDocuments(prev => prev.filter(doc => doc.id !== docId));

      toast({
        title: 'Document Deleted',
        description: `${docName} has been removed`,
        status: 'success',
        duration: 3000,
      });
    } catch (error) {
      console.error('Delete error:', error);
      toast({
        title: 'Delete Failed',
        description: error.message,
        status: 'error',
        duration: 3000,
      });
    }
  };

  return (
    <Box p={4} borderWidth="1px" borderRadius="lg">
      <VStack spacing={4} align="stretch">
        <HStack>
          <Button
            as="label"
            htmlFor="file-upload"
            leftIcon={<FaUpload />}
            colorScheme="blue"
            cursor="pointer"
            isDisabled={isUploading}
          >
            Upload Documents
            <input
              id="file-upload"
              type="file"
              multiple
              accept=".pdf,.txt,.doc,.docx"
              onChange={handleFileUpload}
              style={{ display: 'none' }}
            />
          </Button>
          {isUploading && (
            <Text fontSize="sm" color="gray.600">
              Uploading... {Math.round(uploadProgress)}%
            </Text>
          )}
        </HStack>

        {isUploading && (
          <Progress
            value={uploadProgress}
            size="sm"
            colorScheme="blue"
            isAnimated
          />
        )}

        <List spacing={2}>
          {documents.map((doc) => (
            <ListItem
              key={doc.id}
              p={2}
              bg="gray.50"
              borderRadius="md"
              display="flex"
              justifyContent="space-between"
              alignItems="center"
            >
              <Text>{doc.name}</Text>
              <IconButton
                icon={<FaTrash />}
                size="sm"
                colorScheme="red"
                variant="ghost"
                onClick={() => handleDelete(doc.id, doc.name)}
                aria-label="Delete document"
              />
            </ListItem>
          ))}
        </List>

        {documents.length === 0 && (
          <Text color="gray.500" textAlign="center">
            No documents uploaded yet
          </Text>
        )}
      </VStack>
    </Box>
  );
};

export default DocumentManager;
