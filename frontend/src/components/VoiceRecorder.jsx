import { useState, useCallback, useEffect, useRef } from 'react'
import { Button, HStack, Text, useToast, Box, VStack, Input, Progress } from '@chakra-ui/react'
import { FaMicrophone, FaStop, FaVolumeUp } from 'react-icons/fa'
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
  const [sessionId, setSessionId] = useState(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [responseReceived, setResponseReceived] = useState(false)
  const audioContext = useRef(null)
  const audioQueue = useRef([])
  const isPlayingRef = useRef(false)
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
      const processMessage = async () => {
        try {
          console.log('Processing new WebSocket message...')
          const response = JSON.parse(lastMessage.data)
          console.log('Parsed WebSocket message:', response)

          if (response.type === 'connection_established') {
            console.log('WebSocket connection established successfully')
            console.log('Sending initial session configuration...')
            // Send initial session configuration
            sendMessage(JSON.stringify({
              type: 'session.update',
              output_format: {
                type: 'audio',
                format: 'pcm_16',
                sample_rate: 24000,
                channels: 1
              }
            }))
            console.log('Initial session configuration sent')
            return
          }

          if (response.type === 'session.created') {
            const newSessionId = response.session?.id
            if (newSessionId) {
              console.log('New session created, ID:', newSessionId)
              setSessionId(newSessionId)
              console.log('Configuring session for audio output...')
              // Configure session after creation
              sendMessage(JSON.stringify({
                type: 'session.update',
                output_format: {
                  type: 'audio',
                  format: 'pcm_16',
                  sample_rate: 24000,
                  channels: 1
                }
              }))
              console.log('Session configuration sent')
            } else {
              console.warn('Session created but no ID received')
            }
            return
          }
          if (response.type === 'response.create' || response.type === 'response.chunk') {
            console.log('Received AI response:', JSON.stringify(response, null, 2))
            setResponseReceived(true)

            if (response.content && Array.isArray(response.content)) {
              console.log('Processing response content items:', response.content.length)
              for (const item of response.content) {
                console.log('Processing content item. Type:', item.type, 'Has data:', !!item.data)
                if (item.type === 'audio' && item.data) {
                  console.log('Processing audio content. Data length:', item.data.length)
                  try {
                    // Decode and play audio data
                    console.log('Decoding base64 audio data...')
                    const audioData = atob(item.data)
                    const audioArray = new Uint8Array(audioData.length)
                    for (let i = 0; i < audioData.length; i++) {
                      audioArray[i] = audioData.charCodeAt(i)
                    }

                    if (audioArray.length > 0) {
                      console.log('Audio data decoded successfully, length:', audioArray.length)
                      setIsPlaying(true)
                      audioQueue.current.push(audioArray.buffer)

                      // Play audio if not already playing
                      if (!isPlayingRef.current) {
                        console.log('Starting audio playback...')
                        isPlayingRef.current = true
                        await playNextAudio(audioArray.buffer)
                      } else {
                        console.log('Audio queued for playback')
                      }
                    } else {
                      console.warn('Received empty audio data from AI')
                    }
                  } catch (audioError) {
                    console.error('Error processing audio data:', audioError)
                    toast({
                      title: 'Audio Processing Error',
                      description: 'Failed to process AI audio response: ' + audioError.message,
                      status: 'error',
                      duration: 3000,
                      isClosable: true
                    })
                  }
                } else if (item.type === 'message' || item.type === 'text') {
                  console.log('Processing text message:', item.content || item.text)
                  setTranscript(prev => prev + (prev ? '\n' : '') + (item.content || item.text))
                }
              }
            } else {
              console.warn('Response create message contains no content array')
            }
            return
          }

          if (response.type === 'error') {
            console.error('Received error from server:', response)
            setIsProcessing(false)
            const errorDescription = response.error ?
              `${response.error.message || response.error.code || 'Unknown error'}` :
              'An error occurred'
            console.error('Error description:', errorDescription)
            toast({
              title: 'Server Error',
              description: errorDescription,
              status: 'error',
              duration: 3000,
              isClosable: true
            })
            return
          }

          if (response.type === 'response.completed') {
            console.log('AI response completed')
            setIsProcessing(false)
            setIsPlaying(false)
            if (response.citations) {
              console.log('Setting citations:', response.citations)
              setCitations(response.citations)
            }
            console.log('Clearing audio queue')
            audioQueue.current = []
            isPlayingRef.current = false
          }
        } catch (e) {
          console.error('Error processing WebSocket message:', e)
          setIsProcessing(false)
          toast({
            title: 'Message Processing Error',
            description: 'Failed to process server response: ' + e.message,
            status: 'error',
            duration: 3000,
            isClosable: true
          })
        }
      }
      processMessage()
    }
  }, [lastMessage, toast, sessionId, sendMessage])

  const playNextAudio = async (audioData) => {
    console.log('playNextAudio called with data type:', typeof audioData)
    console.log('Audio data size:', audioData instanceof ArrayBuffer ? audioData.byteLength : 'N/A')

    try {
      if (!audioContext.current) {
        console.log('Creating new AudioContext with 24kHz sample rate')
        audioContext.current = new (window.AudioContext || window.webkitAudioContext)({
          sampleRate: 24000,
          latencyHint: 'interactive'
        })
        console.log('AudioContext state:', audioContext.current.state)

        if (audioContext.current.state === 'suspended') {
          await audioContext.current.resume()
          console.log('AudioContext resumed from suspended state')
        }
      }

      if (isPlayingRef.current) {
        console.log('Already playing audio, queueing...')
        console.log('Current queue size:', audioQueue.current.length)
        audioQueue.current.push(audioData)
        return
      }

      isPlayingRef.current = true
      console.log('Processing audio data for playback...')
      let audioBuffer
      if (typeof audioData === 'string') {
        // Convert base64 to ArrayBuffer
        const base64Data = audioData.split(',')[1] || audioData
        const binaryString = atob(base64Data)
        const bytes = new Uint8Array(binaryString.length)
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i)
        }
        try {
          audioBuffer = await audioContext.current.decodeAudioData(bytes.buffer)
        } catch (decodeError) {
          console.error('Failed to decode audio data:', decodeError)
          throw new Error('Invalid audio data format: Failed to decode base64 audio')
        }
      } else if (audioData instanceof ArrayBuffer) {
        try {
          audioBuffer = await audioContext.current.decodeAudioData(audioData)
        } catch (decodeError) {
          console.error('Failed to decode ArrayBuffer:', decodeError)
          throw new Error('Invalid audio data format: Failed to decode ArrayBuffer')
        }
      } else {
        throw new Error('Invalid audio data format: Expected base64 string or ArrayBuffer')
      }

      console.log('Audio data decoded successfully')
      const source = audioContext.current.createBufferSource()
      source.buffer = audioBuffer

      const gainNode = audioContext.current.createGain()
      gainNode.gain.value = 1.0
      source.connect(gainNode)
      gainNode.connect(audioContext.current.destination)

      return new Promise((resolve, reject) => {
        source.onended = () => {
          console.log('Audio playback completed')
          isPlayingRef.current = false
          setIsPlaying(false)
          source.disconnect()
          gainNode.disconnect()

          if (audioQueue.current.length > 0) {
            const nextAudio = audioQueue.current.shift()
            playNextAudio(nextAudio).catch(console.error)
          }
          resolve()
        }

        source.onerror = (error) => {
          console.error('Audio playback error:', error)
          isPlayingRef.current = false
          setIsPlaying(false)
          source.disconnect()
          gainNode.disconnect()
          toast({
            title: 'Playback Error',
            description: 'Failed to play audio response',
            status: 'error',
            duration: 3000,
            isClosable: true
          })
          reject(error)
        }

        try {
          console.log('Starting audio playback...')
          source.start(0)
          setIsPlaying(true)
        } catch (error) {
          console.error('Failed to start audio playback:', error)
          isPlayingRef.current = false
          setIsPlaying(false)
          source.disconnect()
          gainNode.disconnect()
          reject(error)
        }
      })
    } catch (error) {
      console.error('Error processing audio:', error)
      isPlayingRef.current = false
      setIsPlaying(false)
      toast({
        title: 'Audio Processing Error',
        description: error.message || 'Failed to process audio response',
        status: 'error',
        duration: 3000,
        isClosable: true
      })
      throw error
    }
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
        if (readyState === 1 && sessionId) {
          try {
            const inputData = e.inputBuffer.getChannelData(0)
            const pcmData = convertToPCM16(inputData)
            const base64Audio = btoa(String.fromCharCode.apply(null, new Uint8Array(pcmData)))

            // Send audio buffer with session ID
            sendMessage(JSON.stringify({
              type: 'input_audio_buffer.append',
              session: { id: sessionId },
              data: base64Audio,
              encoding: {
                type: 'audio/pcm',
                sample_rate: 24000,
                bit_depth: 16,
                channels: 1
              }
            }))

            // Send commit message after buffer append
            sendMessage(JSON.stringify({
              type: 'input_audio_buffer.commit',
              session: { id: sessionId }
            }))
          } catch (error) {
            console.error('Error processing audio:', error)
            toast({
              title: 'Audio Processing Error',
              description: 'Failed to process audio input: ' + error.message,
              status: 'error',
              duration: 3000,
              isClosable: true
            })
          }
        }
      }
      setMediaRecorder({ stream, audioCtx, processor, source })
      setIsRecording(true)
      setIsProcessing(true)
      setCitations([])
      setTranscript('')
      setResponseReceived(false)

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

        // Send audio input message
        const audioMessage = {
          type: 'conversation.item.create',
          session: { id: sessionId },
          content: [{
            type: 'message',
            content: mediaRecorder.lastAudioBuffer || '',
            role: 'user'
          }]
        }
        console.log('Sending audio message:', audioMessage)
        sendMessage(JSON.stringify(audioMessage))

        // Request AI response
        const responseMessage = {
          type: 'response.create',
          session: { id: sessionId },
          content: [{
            type: 'message',
            role: 'assistant'
          }],
          output_format: {
            type: 'audio',
            format: 'pcm_16',
            sample_rate: 24000,
            channels: 1
          }
        }
        console.log('Requesting AI response:', responseMessage)
        sendMessage(JSON.stringify(responseMessage))
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
  }, [mediaRecorder, isRecording, sendMessage, sessionId])

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
    console.log('Attempting to submit text message...')
    if (!textInput.trim()) {
      console.log('Text input is empty, skipping submission')
      return
    }
    if (readyState !== 1) {
      console.log('WebSocket not ready, state:', readyState)
      return
    }
    if (!sessionId) {
      console.log('No session ID available, message may not be processed correctly')
      return
    }
    setIsProcessing(true)
    setCitations([])
    setTranscript('')
    setResponseReceived(false)
    try {
      const message = {
        type: 'conversation.item.create',
        session: { id: sessionId },
        content: [{
          type: 'message',
          content: textInput.trim(),
          role: 'user'
        }]
      }
      console.log('Sending text message:', message)
      sendMessage(JSON.stringify(message))

      // Wait briefly to ensure message is processed before requesting response
      setTimeout(() => {
        // Request AI response with audio
        const responseMessage = {
          type: 'response.create',
          session: { id: sessionId },
          content: [{
            type: 'message',
            role: 'assistant'
          }],
          output_format: {
            type: 'audio',
            format: 'pcm_16',
            sample_rate: 24000,
            channels: 1
          }
        }
        console.log('Requesting AI response:', responseMessage)
        sendMessage(JSON.stringify(responseMessage))
      }, 100)
      setTextInput('')
    } catch (error) {
      console.error('Error sending message:', error)
      toast({
        title: 'Error',
        description: 'Failed to send message. Please try again.',
        status: 'error',
        duration: 3000,
        isClosable: true,
      })
      setIsProcessing(false)
    }
  }

  return (
    <Box>
      <VStack spacing={4} align="stretch">
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
          {isPlaying && (
            <HStack>
              <FaVolumeUp />
              <Text>Playing response...</Text>
            </HStack>
          )}
        </HStack>
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
        {isProcessing && !isRecording && (
          <Box>
            <Text mb={2}>Processing response...</Text>
            <Progress size="xs" isIndeterminate colorScheme="blue" />
          </Box>
        )}
        {readyState !== 1 && <Text color="red">Connecting to server...</Text>}
      </VStack>
      {responseReceived && !transcript && (
        <Box mt={4} p={4} borderWidth="1px" borderRadius="lg" bg="yellow.50">
          <Text>Listening to your message...</Text>
        </Box>
      )}
      {transcript && (
        <Box mt={4} p={4} borderWidth="1px" borderRadius="lg">
          <Text fontWeight="bold" mb={2}>Response:</Text>
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

export default VoiceRecorder;
