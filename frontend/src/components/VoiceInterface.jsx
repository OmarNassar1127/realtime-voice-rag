import { Box, Button, HStack, Text, VStack, useToast } from '@chakra-ui/react'
import { useReactMediaRecorder } from 'react-media-recorder'
import { FaMicrophone, FaStop } from 'react-icons/fa'
import { useState, useRef, useEffect } from 'react'

function VoiceInterface() {
  const [isProcessing, setIsProcessing] = useState(false)
  const [isConnected, setIsConnected] = useState(false)
  const wsRef = useRef(null)
  const toast = useToast()

  const { status, startRecording, stopRecording, mediaBlobUrl, clearBlobUrl } = useReactMediaRecorder({
    audio: true,
    onStop: async (blobUrl, blob) => {
      if (!isConnected) {
        toast({
          title: 'Not connected',
          description: 'Please wait for WebSocket connection',
          status: 'error',
          duration: 3000,
          isClosable: true,
        })
        return
      }

      try {
        setIsProcessing(true)
        // Convert blob to raw PCM audio data
        const arrayBuffer = await blob.arrayBuffer()
        const audioContext = new AudioContext({ sampleRate: 24000 })
        const audioBuffer = await audioContext.decodeAudioData(arrayBuffer)

        // Convert to 16-bit PCM
        const pcmData = new Int16Array(audioBuffer.length)
        const inputData = audioBuffer.getChannelData(0)

        // Convert Float32 to Int16
        for (let i = 0; i < inputData.length; i++) {
          const s = Math.max(-1, Math.min(1, inputData[i]))
          pcmData[i] = s < 0 ? s * 0x8000 : s * 0x7FFF
        }

        // Send audio data to WebSocket
        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
          wsRef.current.send(pcmData.buffer)
        }

        toast({
          title: 'Processing',
          description: 'Processing your message...',
          status: 'info',
          duration: 3000,
          isClosable: true,
        })
      } catch (error) {
        console.error('Error processing audio:', error)
        toast({
          title: 'Error',
          description: error.message,
          status: 'error',
          duration: 5000,
          isClosable: true,
        })
      } finally {
        setIsProcessing(false)
        clearBlobUrl()
      }
    },
  })

  useEffect(() => {
    // Connect to WebSocket server
    const connectWebSocket = () => {
      const ws = new WebSocket('ws://localhost:8000/ws')

      ws.onopen = () => {
        setIsConnected(true)
        toast({
          title: 'Connected',
          description: 'Ready to process voice input',
          status: 'success',
          duration: 3000,
          isClosable: true,
        })
      }

      ws.onmessage = async (event) => {
        try {
          const response = JSON.parse(event.data)

          // Handle text response
          if (response.type === 'text') {
            console.log('Text response:', response.text)
          }

          // Handle audio response
          if (response.type === 'audio') {
            // Convert base64 audio to ArrayBuffer
            const audioData = atob(response.audio)
            const arrayBuffer = new ArrayBuffer(audioData.length)
            const view = new Uint8Array(arrayBuffer)
            for (let i = 0; i < audioData.length; i++) {
              view[i] = audioData.charCodeAt(i)
            }

            // Play audio
            const audioContext = new AudioContext()
            const audioBuffer = await audioContext.decodeAudioData(arrayBuffer)
            const source = audioContext.createBufferSource()
            source.buffer = audioBuffer
            source.connect(audioContext.destination)
            source.start(0)
          }
        } catch (error) {
          console.error('Error handling WebSocket message:', error)
        }
      }

      ws.onclose = () => {
        setIsConnected(false)
        toast({
          title: 'Disconnected',
          description: 'Connection lost. Reconnecting...',
          status: 'warning',
          duration: 3000,
          isClosable: true,
        })
        // Attempt to reconnect after 3 seconds
        setTimeout(connectWebSocket, 3000)
      }

      ws.onerror = (error) => {
        console.error('WebSocket error:', error)
        toast({
          title: 'Error',
          description: 'Connection error occurred',
          status: 'error',
          duration: 3000,
          isClosable: true,
        })
      }

      wsRef.current = ws
    }

    connectWebSocket()

    // Cleanup on component unmount
    return () => {
      if (wsRef.current) {
        wsRef.current.close()
      }
    }
  }, [toast])

  return (
    <Box p={6} borderWidth={1} borderRadius="lg" bg="white">
      <VStack spacing={4} align="stretch">
        <Text fontSize="xl" fontWeight="bold">Voice Interface</Text>
        <Text color="gray.600">Click the microphone to start recording your question</Text>

        <HStack spacing={4} justify="center">
          <Button
            leftIcon={status === 'recording' ? <FaStop /> : <FaMicrophone />}
            colorScheme={status === 'recording' ? 'red' : 'blue'}
            onClick={status === 'recording' ? stopRecording : startRecording}
            isLoading={isProcessing}
            loadingText="Processing..."
            isDisabled={!isConnected}
          >
            {status === 'recording' ? 'Stop Recording' : 'Start Recording'}
          </Button>
        </HStack>

        {!isConnected && (
          <Text color="red.500" textAlign="center">
            Connecting to server...
          </Text>
        )}
      </VStack>
    </Box>
  )
}

export default VoiceInterface
