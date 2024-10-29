import { useState, useCallback, useEffect, useRef } from 'react'
import { Button, HStack, Text, useToast, Box, VStack, Input, Progress } from '@chakra-ui/react'
import { FaMicrophone, FaStop, FaVolumeUp } from 'react-icons/fa'
import useWebSocket from 'react-use-websocket'

// Hardcoded WebSocket URL as per documentation
const WEBSOCKET_URL = `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.hostname}:8000/api/ws`

// Function to convert audio buffer to PCM 16-bit
const convertToPCM16 = (audioBuffer) => {
  const pcmData = new Int16Array(audioBuffer.length)
  let maxSample = 0
  // Find maximum sample for normalization
  for (let i = 0; i < audioBuffer.length; i++) {
    maxSample = Math.max(maxSample, Math.abs(audioBuffer[i]))
  }
  // Scale and convert to 16-bit PCM with normalization
  const scale = maxSample > 0 ? 32767 / maxSample : 1
  for (let i = 0; i < audioBuffer.length; i++) {
    pcmData[i] = Math.round(audioBuffer[i] * scale)
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
  const [audioContextStatus, setAudioContextStatus] = useState('uninitialized')
  const [microphoneStatus, setMicrophoneStatus] = useState('unchecked')
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

          // Handle WebSocket connection establishment
          if (response.type === 'connection_established') {
            console.log('WebSocket connection established successfully')
            console.log('Sending initial session configuration...')
            // Send initial session configuration with retry logic
            const configMessage = {
              type: 'session.update',
              output_format: {
                type: 'audio',
                format: 'pcm_16',
                sample_rate: 24000,
                channels: 1
              }
            }
            try {
              sendMessage(JSON.stringify(configMessage))
              console.log('Initial session configuration sent')
            } catch (error) {
              console.error('Failed to send session configuration:', error)
              // Retry after 1 second
              setTimeout(() => sendMessage(JSON.stringify(configMessage)), 1000)
            }
            return
          }

          // Handle session creation
          if (response.type === 'session.created' || response.type === 'session.create.ack') {
            const newSessionId = response.session?.id
            if (newSessionId) {
              console.log('New session created, ID:', newSessionId)
              setSessionId(newSessionId)
              console.log('Configuring session for audio output...')
              // Configure session with retry logic
              const configMessage = {
                type: 'session.update',
                session: { id: newSessionId },
                output_format: {
                  type: 'audio',
                  format: 'pcm_16',
                  sample_rate: 24000,
                  channels: 1
                }
              }
              try {
                sendMessage(JSON.stringify(configMessage))
                console.log('Session configuration sent')
              } catch (error) {
                console.error('Failed to send session configuration:', error)
                setTimeout(() => sendMessage(JSON.stringify(configMessage)), 1000)
              }
            } else {
              console.warn('Session created but no ID received')
            }
            return
          }

          // Handle audio responses
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
                    // Decode and queue audio data with improved error handling
                    console.log('Decoding base64 audio data...')
                    const audioData = atob(item.data)
                    const audioArray = new Float32Array(audioData.length / 2)
                    const dataView = new DataView(new ArrayBuffer(audioData.length))

                    for (let i = 0; i < audioData.length; i++) {
                      dataView.setUint8(i, audioData.charCodeAt(i))
                    }

                    for (let i = 0; i < audioArray.length; i++) {
                      audioArray[i] = dataView.getInt16(i * 2, true) / 32768.0
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
      // Ensure AudioContext is created or resumed only when needed
      if (!audioContext.current || audioContext.current.state === 'closed') {
        console.log('Creating new AudioContext with 24kHz sample rate')
        try {
          audioContext.current = new (window.AudioContext || window.webkitAudioContext)({
            sampleRate: 24000,
            latencyHint: 'interactive'
          })
          console.log('New AudioContext created, state:', audioContext.current.state)

          // Add error handler for AudioContext state changes
          audioContext.current.onstatechange = () => {
            console.log('AudioContext state changed to:', audioContext.current.state)
          }
        } catch (error) {
          console.error('Failed to create AudioContext:', error)
          toast({
            title: 'Audio System Error',
            description: 'Failed to initialize audio playback system. Please refresh the page.',
            status: 'error',
            duration: 5000,
            isClosable: true
          })
          throw new Error('Failed to initialize audio playback system')
        }
      }

      if (audioContext.current.state === 'suspended') {
        try {
          console.log('Attempting to resume AudioContext from suspended state')
          await audioContext.current.resume()
          console.log('AudioContext resumed successfully, state:', audioContext.current.state)
        } catch (error) {
          console.error('Failed to resume AudioContext:', error)
          toast({
            title: 'Audio System Error',
            description: 'Failed to resume audio playback. Please try again.',
            status: 'error',
            duration: 3000,
            isClosable: true
          })
          throw new Error('Failed to resume audio playback system')
        }
      }

      // Validate audio data before processing
      if (!audioData) {
        console.error('No audio data provided for playback')
        throw new Error('No audio data provided for playback')
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
        try {
          // Convert base64 to ArrayBuffer
          const base64Data = audioData.split(',')[1] || audioData
          console.log('Processing base64 audio data, length:', base64Data.length)
          const binaryString = atob(base64Data)
          console.log('Decoded binary string length:', binaryString.length)

          // Create a Float32Array for better audio quality
          const bytes = new Float32Array(binaryString.length / 2)
          const dataView = new DataView(new ArrayBuffer(binaryString.length))

          for (let i = 0; i < binaryString.length; i++) {
            dataView.setUint8(i, binaryString.charCodeAt(i))
          }

          // Convert to 16-bit PCM samples
          for (let i = 0; i < bytes.length; i++) {
            bytes[i] = dataView.getInt16(i * 2, true) / 32768.0
          }

          console.log('Created Float32Array with length:', bytes.length)
          audioBuffer = await audioContext.current.decodeAudioData(bytes.buffer)
          console.log('Successfully decoded audio data to PCM format')
        } catch (decodeError) {
          console.error('Failed to decode audio data:', decodeError)
          toast({
            title: 'Audio Processing Error',
            description: 'Failed to decode audio response. The format may be invalid.',
            status: 'error',
            duration: 3000,
            isClosable: true
          })
          throw new Error('Invalid audio data format: Failed to decode base64 audio')
        }
      } else if (audioData instanceof ArrayBuffer) {
        try {
          audioBuffer = await audioContext.current.decodeAudioData(audioData.slice(0))
          console.log('Successfully decoded ArrayBuffer audio data')
        } catch (decodeError) {
          console.error('Failed to decode ArrayBuffer:', decodeError)
          toast({
            title: 'Audio Processing Error',
            description: 'Failed to decode audio response. The format may be invalid.',
            status: 'error',
            duration: 3000,
            isClosable: true
          })
          throw new Error('Invalid audio data format: Failed to decode ArrayBuffer')
        }
      } else {
        throw new Error('Invalid audio data format: Expected base64 string or ArrayBuffer')
      }

      console.log('Audio data decoded successfully:', {
        duration: audioBuffer.duration,
        numberOfChannels: audioBuffer.numberOfChannels,
        sampleRate: audioBuffer.sampleRate,
        length: audioBuffer.length
      })

      // Create and configure audio nodes
      const source = audioContext.current.createBufferSource()
      source.buffer = audioBuffer

      // Create and configure gain node for volume control
      const gainNode = audioContext.current.createGain()
      gainNode.gain.value = 0.5 // Set initial volume to 50%

      // Create analyzer node for debugging
      const analyzerNode = audioContext.current.createAnalyser()
      analyzerNode.fftSize = 2048

      // Connect the audio graph
      source.connect(gainNode)
      gainNode.connect(analyzerNode)
      analyzerNode.connect(audioContext.current.destination)

      console.log('Audio nodes connected and configured')

      return new Promise((resolve, reject) => {
        source.onended = () => {
          console.log('Audio playback completed')
          isPlayingRef.current = false
          setIsPlaying(false)
          // Clean up audio nodes
          source.disconnect()
          gainNode.disconnect()
          analyzerNode.disconnect()
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
          console.log('Starting audio playback with AudioContext sample rate:', audioContext.current.sampleRate)
          console.log('Audio buffer details:', {
            duration: source.buffer.duration,
            numberOfChannels: source.buffer.numberOfChannels,
            sampleRate: source.buffer.sampleRate,
            length: source.buffer.length
          })
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
      console.log('WebSocket not ready, current state:', readyState)
      toast({
        title: 'Connection Error',
        description: 'Waiting for connection to be established. Please try again.',
        status: 'warning',
        duration: 3000,
        isClosable: true
      })
      return
    }

    try {
      console.log('Starting recording process...')
      // Initialize AudioContext if needed
      if (!audioContext.current || audioContext.current.state === 'closed') {
        console.log('Creating new AudioContext for recording')
        audioContext.current = new (window.AudioContext || window.webkitAudioContext)({
          sampleRate: 24000,
          latencyHint: 'interactive'
        })
      }

      // Resume AudioContext if suspended
      if (audioContext.current.state === 'suspended') {
        console.log('Resuming suspended AudioContext')
        await audioContext.current.resume()
      }

      // Check for microphone support and permissions
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        console.log('Microphone access not supported, switching to text mode')
        setIsTextMode(true)
        toast({
          title: 'Device Error',
          description: 'Microphone access is not supported in this browser. Using text input instead.',
          status: 'info',
          duration: 5000,
          isClosable: true
        })
        return
      }

      // Initialize audio context if not already done
      if (!audioContext.current || audioContext.current.state === 'closed') {
        try {
          console.log('Initializing AudioContext...')
          audioContext.current = new (window.AudioContext || window.webkitAudioContext)({
            sampleRate: 24000,
            latencyHint: 'interactive'
          })
          await audioContext.current.resume()
          console.log('AudioContext initialized successfully:', audioContext.current.state)
        } catch (error) {
          console.error('Failed to create AudioContext:', error)
          throw new Error('Failed to initialize audio system')
        }
      }

      console.log('Requesting microphone access...')
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
        console.error('Microphone access error:', error)
        if (error.name === 'NotAllowedError') {
          throw new Error('Microphone permission denied. Please allow microphone access and try again.')
        } else if (error.name === 'NotFoundError') {
          throw new Error('No microphone found. Please connect a microphone and try again.')
        } else {
          throw new Error('Microphone error: ' + error.message)
        }
      })

      console.log('Microphone access granted, setting up audio processing...')
      const source = audioContext.current.createMediaStreamSource(stream)
      const processor = audioContext.current.createScriptProcessor(4096, 1, 1)
      source.connect(processor)
      processor.connect(audioContext.current.destination)

      processor.onaudioprocess = (e) => {
        if (readyState === 1 && sessionId) {
          try {
            const inputData = e.inputBuffer.getChannelData(0)
            console.log('Processing audio buffer, length:', inputData.length)
            const pcmData = convertToPCM16(inputData)
            const base64Audio = btoa(String.fromCharCode.apply(null, new Uint8Array(pcmData)))

            // Accumulate audio chunks and send less frequently
            if (!mediaRecorder.audioChunks) {
              mediaRecorder.audioChunks = []
            }
            mediaRecorder.audioChunks.push(base64Audio)

            // Send accumulated chunks every ~500ms
            if (mediaRecorder.audioChunks.length >= 12) { // ~12 chunks at 4096 samples
              console.log('Sending accumulated audio chunks for session:', sessionId)

              // Send audio buffer with session ID
              for (const chunk of mediaRecorder.audioChunks) {
                sendMessage(JSON.stringify({
                  type: 'input_audio_buffer.append',
                  session: { id: sessionId },
                  data: chunk,
                  encoding: {
                    type: 'audio/pcm',
                    sample_rate: 24000,
                    bit_depth: 16,
                    channels: 1
                  }
                }))
              }

              // Send commit message after all chunks
              sendMessage(JSON.stringify({
                type: 'input_audio_buffer.commit',
                session: { id: sessionId }
              }))

              mediaRecorder.audioChunks = []
            }
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
      setMediaRecorder({ stream, audioContext: audioContext.current, processor, source })
      setIsRecording(true)
      setIsProcessing(true)
      setCitations([])
      setTranscript('')
      setResponseReceived(false)

      console.log('Recording started successfully')
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
        // Stop all tracks and disconnect nodes
        mediaRecorder.stream.getTracks().forEach(track => track.stop())
        mediaRecorder.source.disconnect()
        mediaRecorder.processor.disconnect()

        // Don't close AudioContext here as it may be needed for playback
        setIsRecording(false)

        // Send final audio buffer commit
        const commitMessage = {
          type: 'input_audio_buffer.commit',
          session: { id: sessionId }
        }
        console.log('Sending final audio buffer commit:', commitMessage)
        sendMessage(JSON.stringify(commitMessage))

        // Send conversation item create message
        const audioMessage = {
          type: 'conversation.item.create',
          session: { id: sessionId },
          content: [{
            type: 'text',
            text: 'Audio message processed',
            role: 'user'
          }]
        }
        console.log('Sending conversation item:', audioMessage)
        sendMessage(JSON.stringify(audioMessage))

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
