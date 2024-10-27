import { useState, useEffect, useRef } from 'react'
import {
  Box,
  VStack,
  Text,
  Card,
  CardBody,
  Divider,
} from '@chakra-ui/react'

const ChatInterface = () => {
  const messagesEndRef = useRef(null)
  const [messages, setMessages] = useState([])

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  useEffect(() => {
    scrollToBottom()
  }, [messages])

  return (
    <Box w="100%" h="400px" borderWidth={1} borderRadius="lg" overflowY="auto">
      <VStack spacing={4} p={4} align="stretch">
        {messages.map((message, index) => (
          <Card key={index} variant={message.type === 'user' ? 'filled' : 'outline'}>
            <CardBody>
              <Text>{message.content}</Text>
              {message.citations && (
                <>
                  <Divider my={2} />
                  <Text fontSize="sm" color="gray.500">
                    Sources: {message.citations.join(', ')}
                  </Text>
                </>
              )}
            </CardBody>
          </Card>
        ))}
        <div ref={messagesEndRef} />
      </VStack>
    </Box>
  )
}

export default ChatInterface
