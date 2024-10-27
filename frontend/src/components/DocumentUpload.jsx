import { useState } from 'react'
import {
  Box,
  Button,
  VStack,
  Text,
  useToast,
  List,
  ListItem,
  IconButton,
  HStack,
} from '@chakra-ui/react'
import { FaUpload, FaTrash } from 'react-icons/fa'

const DocumentUpload = () => {
  const [documents, setDocuments] = useState([])
  const toast = useToast()

  const handleFileUpload = async (event) => {
    const file = event.target.files[0]
    if (!file) return

    const formData = new FormData()
    formData.append('file', file)

    try {
      // TODO: Send to backend
      console.log('Uploading file:', file)
      setDocuments(prev => [...prev, file.name])
      toast({
        title: 'Success',
        description: 'File uploaded successfully',
        status: 'success',
        duration: 3000,
      })
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to upload file',
        status: 'error',
        duration: 3000,
      })
    }
  }

  const handleDelete = async (filename) => {
    try {
      // TODO: Send delete request to backend
      console.log('Deleting file:', filename)
      setDocuments(prev => prev.filter(doc => doc !== filename))
      toast({
        title: 'Success',
        description: 'File deleted successfully',
        status: 'success',
        duration: 3000,
      })
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to delete file',
        status: 'error',
        duration: 3000,
      })
    }
  }

  return (
    <Box w="100%">
      <VStack spacing={4} align="stretch">
        <Button
          as="label"
          leftIcon={<FaUpload />}
          colorScheme="teal"
          cursor="pointer"
        >
          Upload Document
          <input
            type="file"
            hidden
            accept=".pdf,.txt,.doc,.docx"
            onChange={handleFileUpload}
          />
        </Button>
        
        {documents.length > 0 && (
          <List spacing={2}>
            {documents.map((doc, index) => (
              <ListItem key={index}>
                <HStack justify="space-between">
                  <Text>{doc}</Text>
                  <IconButton
                    icon={<FaTrash />}
                    colorScheme="red"
                    size="sm"
                    onClick={() => handleDelete(doc)}
                    aria-label="Delete document"
                  />
                </HStack>
              </ListItem>
            ))}
          </List>
        )}
      </VStack>
    </Box>
  )
}

export default DocumentUpload
