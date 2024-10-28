import { useState, useCallback, useEffect, useRef } from 'react'
import { Button, HStack, Text, useToast, Box, VStack } from '@chakra-ui/react'
import { FaMicrophone, FaStop } from 'react-icons/fa'
import useWebSocket from 'react-use-websocket'

// Hardcoded WebSocket URL as per documentation
const WEBSOCKET_URL = 'ws://localhost:8000/ws'

// Function to convert audio buffer to PCM 16-bit
const convertToPCM16 = (audioBuffer) => {
  const pcmData = new Int16Array(audioBuffer.length)
  for (let i = 0; i < audioBuffer.length; i++) {
    const s = Math.max(-1, Math.min(1, audioBuffer[i]))
    pcmData[i] = s < 0 ? s * 0x8000 : s * 0x7fff
  }
  return pcmData.buffer
}

const VoiceRecorder = () => {
  const [isRecording, setIsRecording] = useState(false)
  const [mediaRecorder, setMediaRecorder] = useState(null)
  const [citations, setCitations] = useState([])
  const [isProcessing, setIsProcessing] = useState(false)
  const [transcript, setTranscript] = useState('')
  const audioContext = useRef(null)
  const audioQueue = useRef([])
  const isPlaying = useRef(false)
  const toast = useToast()
  const { sendMessage, lastMessage, readyState } = useWebSocket(WEBSOCKET_URL, {
    onOpen: () => {
      console.log('WebSocket Connected')
      // Don't send session.create immediately - wait for stable connection
      setTimeout(() => {
        try {
          console.log('Sending session.create message')
          sendMessage(JSON.stringify({
            type: 'session.create',
            session: {
              model: 'gpt-4o-realtime-preview-2024-10-01',
              modalities: ['text', 'audio'],
              voice: 'alloy',
              input_audio_format: 'pcm16',
              output_audio_format: 'pcm16'
            }
          }))
        } catch (error) {
          console.error('Error sending session create message:', error)
          toast({
            title: 'Connection Error',
            description: 'Failed to initialize session',
            status: 'error',
            duration: 3000,
            isClosable: true,
          })
        }
      }, 1000) // Give connection time to stabilize
    },
    onError: (error) => {
      console.error('WebSocket error:', error)
      toast({
        title: 'WebSocket Error',
        description: 'Connection error occurred. Retrying...',
        status: 'error',
        duration: 3000,
        isClosable: true,
      })
    },
    onClose: (event) => {
      console.log('WebSocket closed:', event)
      // Only show toast if it wasn't a normal closure
      if (event.code !== 1000) {
        toast({
          title: 'Connection Closed',
          description: `Connection closed (${event.code}). ${event.code === 1006 ? 'Abnormal closure' : event.reason}`,
          status: 'warning',
          duration: 3000,
          isClosable: true,
        })
      }
    },
    shouldReconnect: (closeEvent) => closeEvent.code !== 1000 && closeEvent.code !== 1005, // Don't reconnect on normal closure
    reconnectInterval: (lastAttemptNumber) => Math.min(1000 * Math.pow(2, lastAttemptNumber), 30000),
    reconnectAttempts: 10,
    share: false, // Don't share connections
    retryOnError: true,
    options: {
      headers: {
        'OpenAI-Beta': 'realtime=v1'
      }
    }
  })

  useEffect(() => {
    if (lastMessage) {
      try {
        const response = JSON.parse(lastMessage.data)
        console.log('Received WebSocket message:', response)

        if (response.type === 'session.created') {
          console.log('Session created successfully')
          toast({
            title: 'Connected',
            description: 'Session established successfully',
            status: 'success',
            duration: 3000,
          })
          return
        }

        if (response.type === 'error') {
          setIsProcessing(false)
          console.error('Server error:', response.error)
          toast({
            title: 'Server Error',
            description: response.error?.message || response.content,
            status: 'error',
            duration: 3000,
          })
          return
        }

        if (response.type === 'audio_data') {
          // Convert base64 audio to ArrayBuffer
          const audioData = atob(response.audio)
          const audioArray = new Uint8Array(audioData.length)
          for (let i = 0; i < audioData.length; i++) {
            audioArray[i] = audioData.charCodeAt(i)
          }
          // Queue audio for playback
          audioQueue.current.push(audioArray.buffer)
          if (!isPlaying.current) {
            playNextAudio()
          }
        }

        if (response.type === 'text') {
          // Update transcript with text response
          setTranscript(prev => prev + '\n' + response.text)
        }

        if (response.citations) {
          setCitations(response.citations.map(citation => ({
            text: citation.text,
            source: citation.source,
            score: citation.score
          })))
        }

        if (response.type === 'response.end') {
          setIsProcessing(false)
          console.log('Response completed')
        }
      } catch (e) {
        console.error('Error parsing WebSocket message:', e, lastMessage.data)
        setIsProcessing(false)
        toast({
          title: 'Message Error',
          description: 'Failed to process server response',
          status: 'error',
          duration: 3000,
        })
      }
    }
  }, [lastMessage, toast])

  const playNextAudio = async () => {
    if (!audioContext.current) {
      audioContext.current = new (window.AudioContext || window.webkitAudioContext)()
    }

    isPlaying.current = true
    while (audioQueue.current.length > 0) {
      const audioData = audioQueue.current.shift()
      try {
        const audioBuffer = await audioContext.current.decodeAudioData(audioData)
        const source = audioContext.current.createBufferSource()
        source.buffer = audioBuffer
        source.connect(audioContext.current.destination)
        source.start(0)
        await new Promise(resolve => source.onended = resolve)
      } catch (error) {
        console.error('Error playing audio:', error)
        toast({
          title: 'Playback Error',
          description: 'Failed to play audio response',
          status: 'error',
          duration: 3000,
        })
      }
    }
    isPlaying.current = false
  }

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: 24000,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true
        }
      })

      const audioCtx = new AudioContext({ sampleRate: 24000 })
      const source = audioCtx.createMediaStreamSource(stream)
      const processor = audioCtx.createScriptProcessor(4096, 1, 1)
      source.connect(processor)
      processor.connect(audioCtx.destination)

      processor.onaudioprocess = (e) => {
        if (readyState === 1) {
          const inputData = e.inputBuffer.getChannelData(0)
          const pcmData = convertToPCM16(inputData)
          // Convert PCM data to base64
          const base64Audio = btoa(String.fromCharCode.apply(null, new Uint8Array(pcmData)))

          // Send audio data in OpenAI Realtime API format
          sendMessage(JSON.stringify({
            type: 'input_audio_buffer.append',
            audio: base64Audio
          }))

          // Commit the audio buffer after sending
          sendMessage(JSON.stringify({
            type: 'input_audio_buffer.commit'
          }))
        }
      }
      setMediaRecorder({ stream, audioCtx, processor, source })
      setIsRecording(true)
      setIsProcessing(true)
      setCitations([])
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Could not access microphone',
        status: 'error',
        duration: 3000,
      })
    }
  }

  const stopRecording = useCallback(() => {
    if (mediaRecorder && isRecording) {
      mediaRecorder.stream.getTracks().forEach(track => track.stop())
      mediaRecorder.source.disconnect()
      mediaRecorder.processor.disconnect()
      mediaRecorder.audioCtx.close()
      setIsRecording(false)

      // Send commit message
      sendMessage(JSON.stringify({ type: 'input_audio_buffer.commit' }))
    }
  }, [mediaRecorder, isRecording, sendMessage])

  // Clean up on unmount
  useEffect(() => {
    return () => {
      if (mediaRecorder) {
        stopRecording()
      }
      if (audioContext.current) {
        audioContext.current.close()
      }
    }
  }, [mediaRecorder, stopRecording])

  return (
    <Box>
      <HStack spacing={4}>
        <Button
          leftIcon={isRecording ? <FaStop /> : <FaMicrophone />}
          colorScheme={isRecording ? 'red' : 'blue'}
          onClick={isRecording ? stopRecording : startRecording}
          isDisabled={readyState !== 1 || isProcessing}
        >
          {isRecording ? 'Stop Recording' : 'Start Recording'}
        </Button>
        {isRecording && <Text>Recording in progress...</Text>}
        {isProcessing && !isRecording && <Text>Processing response...</Text>}
        {readyState !== 1 && <Text color="red">Connecting to server...</Text>}
      </HStack>
      {citations && citations.length > 0 && (
        <Box mt={4} p={4} borderWidth="1px" borderRadius="lg">
          <Text fontWeight="bold" mb={2}>Sources Used:</Text>
          <VStack align="stretch" spacing={2}>
            {citations.map((citation, index) => (
              <Box key={index} p={2} bg="gray.50" borderRadius="md">
                <Text fontSize="sm">{citation.text}</Text>
                <Text fontSize="xs" color="gray.600">
                  Source: {citation.source}
                  {citation.score && ` (Relevance: ${Math.round(citation.score * 100)}%)`}
                </Text>
              </Box>
            ))}
          </VStack>
        </Box>
      )}
    </Box>
  )
}

export default VoiceRecorder
