javascript
import { useState, useCallback, useEffect, useRef } from 'react'
import { Button, HStack, Text, useToast, Box } from '@chakra-ui/react'
import { FaMicrophone, FaStop } from 'react-icons/fa'
import useWebSocket from 'react-use-websocket'

const WEBSOCKET_URL = 'wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-10-01'

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
  const audioContext = useRef(null)
  const audioQueue = useRef([])
  const toast = useToast()

  const { sendMessage, lastMessage, readyState } = useWebSocket(WEBSOCKET_URL, {
    queryParams: {
      model: 'gpt-4o-realtime-preview-2024-10-01'
    },
    options: {
      headers: {
        'Authorization': `Bearer ${process.env.REACT_APP_OPENAI_API_KEY}`,
        'OpenAI-Beta': 'realtime=v1',
        'Content-Type': 'application/json'
      }
    },
    onOpen: () => {
      console.log('WebSocket Connected')
      // Send initial configuration
      sendMessage(JSON.stringify({
        type: 'response.create',
        response: {
          modalities: ['text', 'audio'],
          instructions: 'You are a helpful assistant that provides both text and audio responses. Use the provided context to answer questions accurately.',
        }
      }))
    },
    onError: (error) => {
      console.error('WebSocket error:', error)
      toast({
        title: 'Connection Error',
        description: 'Could not connect to OpenAI Realtime API. Please check your API key and try again.',
        status: 'error',
        duration: 5000,
        isClosable: true,
      })
    },
    shouldReconnect: (closeEvent) => {
      console.log('WebSocket closed:', closeEvent)
      return true
    },
    reconnectInterval: 3000,
    reconnectAttempts: 5,
  })

  useEffect(() => {
    if (lastMessage) {
      try {
        const response = JSON.parse(lastMessage.data)

        if (response.type === 'error') {
          setIsProcessing(false)
          toast({
            title: 'Server Error',
            description: response.error?.message || response.content,
            status: 'error',
            duration: 3000,
          })
        }

        if (response.type === 'audio_data') {
          // Queue audio data for playback
          const audioData = atob(response.audio)
          const audioArray = new Uint8Array(audioData.length)
          for (let i = 0; i < audioData.length; i++) {
            audioArray[i] = audioData.charCodeAt(i)
          }
          audioQueue.current.push(audioArray.buffer)
          playNextAudio()
        }

        if (response.type === 'text') {
          // Handle text response
          console.log('Text response:', response.text)
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
        }
      } catch (e) {
        console.error('Error parsing WebSocket message:', e)
        setIsProcessing(false)
      }
    }
  }, [lastMessage, toast])

  const playNextAudio = async () => {
    if (!audioContext.current) {
      audioContext.current = new (window.AudioContext || window.webkitAudioContext)()
    }

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
          sendMessage(JSON.stringify({
            type: 'input_audio_buffer.append',
            audio: btoa(String.fromCharCode.apply(null, new Uint8Array(pcmData)))
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
