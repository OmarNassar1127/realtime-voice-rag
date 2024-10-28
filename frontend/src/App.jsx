import { ChakraProvider, Container, VStack, Heading, Box, Divider, Text } from '@chakra-ui/react'
import VoiceRecorder from './components/VoiceRecorder'
import DocumentManager from './components/DocumentManager'
import ChatInterface from './components/ChatInterface'
import ErrorBoundary from './components/ErrorBoundary'

function App() {
  return (
    <ChakraProvider>
      <Container maxW="container.lg" py={8}>
        <VStack spacing={8}>
          <Heading size="xl">VoiceRAG Assistant</Heading>

          <Box w="100%" p={6} borderWidth={1} borderRadius="lg" bg="white" shadow="sm">
            <VStack spacing={6}>
              <Text fontSize="lg" fontWeight="medium">Document Management</Text>
              <DocumentManager />
              <Divider />
              <Text fontSize="lg" fontWeight="medium">Voice Interface</Text>
              <ErrorBoundary>
                <VoiceRecorder />
              </ErrorBoundary>
            </VStack>
          </Box>

          <ChatInterface />
        </VStack>
      </Container>
    </ChakraProvider>
  )
}

export default App
