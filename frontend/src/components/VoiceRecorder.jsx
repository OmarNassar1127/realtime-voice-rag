import { useState, useCallback, useEffect, useRef } from 'react'
import { Button, HStack, Text, useToast, Box, VStack, Input } from '@chakra-ui/react'
import { FaMicrophone, FaStop } from 'react-icons/fa'
import useWebSocket from 'react-use-websocket'

// Hardcoded WebSocket URL as per documentation
const WEBSOCKET_URL = `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.hostname}:8000/ws`

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
  const [isTextMode, setIsTextMode] = useState(false)
  const [textInput, setTextInput] = useState('')
  const audioContext = useRef(null)
  const audioQueue = useRef([])
  const isPlaying = useRef(false)
  const toast = useToast()

  const { sendMessage, lastMessage, readyState } = useWebSocket(WEBSOCKET_URL, {
    protocols: ['realtime'],
    onOpen: () => {
      console.log('WebSocket connection established')
      toast({
        title: 'Connected',
        description: 'Ready to start recording',
        status: 'success',
        duration: 3000,
        isClosable: true,
      })
    },
    onError: (error) => {
      console.error('WebSocket error:', error)
      toast({
        title: 'WebSocket Error',
        description: error.message || 'Connection error occurred. Please try again.',
        status: 'error',
        duration: 3000,
        isClosable: true,
      })
      if (mediaRecorder) {
        stopRecording()
      }
    },
    onClose: (event) => {
      console.log('WebSocket closed:', event)
      if (event.code !== 1000) {
        toast({
          title: 'Connection Closed',
          description: event.reason || 'Connection closed unexpectedly. Please refresh the page.',
          status: 'warning',
          duration: 3000,
          isClosable: true,
        })
        if (mediaRecorder) {
          stopRecording()
        }
      }
    },
    shouldReconnect: (closeEvent) => closeEvent.code !== 1000 && closeEvent.code !== 3000,
    reconnectInterval: (attemptNumber) => Math.min(1000 * Math.pow(2, attemptNumber), 10000),
    reconnectAttempts: 5,
    share: false,
    retryOnError: true
  })

  useEffect(() => {
    if (lastMessage) {
      try {
        const response = JSON.parse(lastMessage.data)
        console.log('Received WebSocket message:', response)

        if (response.type === 'connection_established') {
          console.log('Connection established successfully')
          return
        }

        if (response.type === 'error') {
          setIsProcessing(false)
          console.error('Server error:', JSON.stringify(response, null, 2))
          const errorDescription = response.error ?
            `${response.error.message || response.error.code || 'Unknown error'}` :
            'An error occurred'
          toast({
            title: 'Server Error',
            description: errorDescription,
            status: 'error',
            duration: 3000,
            isClosable: true
          })
          return
        }

        if (response.type === 'audio') {
          const audioData = atob(response.audio)
          const audioArray = new Uint8Array(audioData.length)
          for (let i = 0; i < audioData.length; i++) {
            audioArray[i] = audioData.charCodeAt(i)
          }
          audioQueue.current.push(audioArray.buffer)
          if (!isPlaying.current) {
            playNextAudio()
          }
        }

        if (response.type === 'conversation.item.create' || response.type === 'response.create') {
          setTranscript(prev => prev + (prev ? '\n' : '') + response.content)
        }

        if (response.type === 'response.completed') {
          setIsProcessing(false)
          if (response.citations) {
            setCitations(response.citations)
          }
          audioQueue.current = []
          isPlaying.current = false
        }
      } catch (e) {
        console.error('Error parsing WebSocket message:', e)
        setIsProcessing(false)
        toast({
          title: 'Message Error',
          description: 'Failed to process server response',
          status: 'error',
          duration: 3000,
          isClosable: true
        })
      }
    }
  }, [lastMessage, toast])

  const playNextAudio = async () => {
    if (!audioContext.current) {
      audioContext.current = new (window.AudioContext || window.webkitAudioContext)({
        sampleRate: 24000
      })
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
    if (readyState !== 1) {
      toast({
        title: 'Connection Error',
        description: 'Waiting for connection to be established',
        status: 'warning',
        duration: 3000,
        isClosable: true
      })
      return
    }

    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        setIsTextMode(true)
        toast({
          title: 'Device Error',
          description: 'Microphone access is not available in this environment. Using text input instead.',
          status: 'info',
          duration: 5000,
          isClosable: true
        })
        return
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: 24000,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      }).catch(error => {
        setIsTextMode(true)
        if (error.name === 'NotAllowedError') {
          throw new Error('Microphone permission denied. Please allow microphone access and try again.')
        } else if (error.name === 'NotFoundError') {
          throw new Error('No microphone found. Please connect a microphone and try again.')
        } else {
          throw new Error('Microphone error: ' + error.message)
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
          const base64Audio = btoa(String.fromCharCode.apply(null, new Uint8Array(pcmData)))

          sendMessage(JSON.stringify({
            type: 'input_audio_buffer.append',
            audio: base64Audio,
            audio_config: {
              encoding: 'pcm16',
              sample_rate: 24000,
              num_channels: 1,
              endianness: 'little'
            }
          }))
        }
      }

      setMediaRecorder({ stream, audioCtx, processor, source })
      setIsRecording(true)
      setIsProcessing(true)
      setCitations([])
      setTranscript('')

      toast({
        title: 'Recording Started',
        description: 'Microphone is now active and recording',
        status: 'success',
        duration: 3000,
        isClosable: true
      })
    } catch (error) {
      console.error('Microphone access error:', error)
      toast({
        title: 'Microphone Error',
        description: error.message || 'Could not access microphone',
        status: 'error',
        duration: 5000,
        isClosable: true
      })
      setIsTextMode(true)
    }
  }

  const stopRecording = useCallback(() => {
    if (mediaRecorder && isRecording) {
      try {
        mediaRecorder.stream.getTracks().forEach(track => track.stop())
        mediaRecorder.source.disconnect()
        mediaRecorder.processor.disconnect()
        mediaRecorder.audioCtx.close()
        setIsRecording(false)

        const message = {
          type: 'conversation.item.create',
          item: {
            type: 'text',
            content: transcript || 'Audio input received',
            role: 'user',
            response_format: {
              type: 'text_and_audio',
              voice: 'alloy'
            }
          }
        }
        sendMessage(JSON.stringify(message))
      } catch (error) {
        console.error('Error stopping recording:', error)
        toast({
          title: 'Recording Error',
          description: 'Failed to stop recording properly',
          status: 'error',
          duration: 3000,
          isClosable: true
        })
      }
    }
  }, [mediaRecorder, isRecording, sendMessage, transcript])

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

  const handleTextSubmit = () => {
    if (!textInput.trim() || readyState !== 1) return

    setIsProcessing(true)
    setCitations([])
    setTranscript('')

    const message = {
      type: 'conversation.item.create',
      item: {
        type: 'text',
        content: textInput,
        role: 'user',
        response_format: {
          type: 'text_and_audio',
          voice: 'alloy'
        }
      }
    }
    sendMessage(JSON.stringify(message))
    setTextInput('')
  }
  return (
    <Box>
      <HStack spacing={4}>
        {!isTextMode && (
          <Button
            leftIcon={isRecording ? <FaStop /> : <FaMicrophone />}
            colorScheme={isRecording ? 'red' : 'blue'}
            onClick={isRecording ? stopRecording : startRecording}
            isDisabled={readyState !== 1 || isProcessing}
          >
            {isRecording ? 'Stop Recording' : 'Start Recording'}
          </Button>
        )}
        {isTextMode && (
          <HStack>
            <Input
              placeholder="Type your message..."
              value={textInput}
              onChange={(e) => setTextInput(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && handleTextSubmit()}
            />
            <Button
              colorScheme="blue"
              onClick={handleTextSubmit}
              isDisabled={readyState !== 1 || isProcessing || !textInput.trim()}
            >
              Send
            </Button>
          </HStack>
        )}
        {isRecording && <Text>Recording in progress...</Text>}
        {isProcessing && !isRecording && <Text>Processing response...</Text>}
        {readyState !== 1 && <Text color="red">Connecting to server...</Text>}
      </HStack>
      {transcript && (
        <Box mt={4} p={4} borderWidth="1px" borderRadius="lg">
          <Text fontWeight="bold" mb={2}>Transcript:</Text>
          <Text>{transcript}</Text>
        </Box>
      )}
      {citations && citations.length > 0 && (
        <Box mt={4} p={4} borderWidth="1px" borderRadius="lg">
          <Text fontWeight="bold" mb={2}>Sources Used:</Text>
          <VStack align="stretch" spacing={2}>
            {citations.map((citation, index) => (
              <Box key={index} p={2} bg="gray.50" borderRadius="md">
                <Text fontSize="sm">{citation.content}</Text>
                <Text fontSize="xs" color="gray.600">
                  Source: {citation.metadata.source}
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
