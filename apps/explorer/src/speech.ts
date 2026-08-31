import type { KokoroTTS } from 'kokoro-js'

let speakGeneration = 0
let neuralSpeaking = false
let currentSource: AudioBufferSourceNode | null = null
let audioContext: AudioContext | null = null
let kokoroFailed = false
let kokoroLoading: Promise<KokoroTTS | null> | null = null

export const AUTO_STEP_DELAY_MS = 4000
export type SpeakStatus = 'idle' | 'loading' | 'speaking'

const KOKORO_MODEL = 'onnx-community/Kokoro-82M-v1.0-ONNX'
const KOKORO_VOICE = 'af_heart' as const

let speakStatus: SpeakStatus = 'idle'
const statusListeners = new Set<(status: SpeakStatus) => void>()

function setSpeakStatus(next: SpeakStatus) {
  speakStatus = next
  for (const listener of statusListeners) listener(next)
}

export function subscribeSpeakStatus(listener: (status: SpeakStatus) => void) {
  statusListeners.add(listener)
  listener(speakStatus)
  return () => {
    statusListeners.delete(listener)
  }
}

function canUseWebSpeech() {
  return typeof window !== 'undefined' && 'speechSynthesis' in window
}

export function canSpeak() {
  return (
    typeof window !== 'undefined' &&
    ('AudioContext' in window ||
      'webkitAudioContext' in window ||
      canUseWebSpeech())
  )
}

export function isSpeaking() {
  return (
    neuralSpeaking ||
    (canUseWebSpeech() && window.speechSynthesis.speaking)
  )
}

function getAudioContext() {
  const Context =
    window.AudioContext ||
    (window as typeof window & { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext
  if (!Context) return null
  if (!audioContext || audioContext.state === 'closed') {
    audioContext = new Context()
  }
  if (audioContext.state === 'suspended') void audioContext.resume()
  return audioContext
}

function stopPlayback() {
  neuralSpeaking = false
  if (currentSource) {
    try {
      currentSource.stop()
    } catch {
      // Already stopped.
    }
    currentSource = null
  }
  if (canUseWebSpeech()) window.speechSynthesis.cancel()
}

export function stopSpeaking() {
  speakGeneration += 1
  stopPlayback()
  setSpeakStatus('idle')
}

function voiceScore(voice: SpeechSynthesisVoice) {
  const label = `${voice.name} ${voice.voiceURI} ${voice.lang}`.toLowerCase()
  let score = 0
  if (voice.lang.toLowerCase().startsWith('en')) score += 10
  if (/neural|premium|enhanced|natural|online|wavenet|studio/.test(label)) {
    score += 50
  }
  if (/google/.test(label)) score += 30
  if (/microsoft/.test(label)) score += 20
  if (/\b(zoe|evan|nolan|samantha|allison|ava|daniel|karen|moira)\b/.test(label)) {
    score += 15
  }
  if (voice.localService) score += 2
  if (voice.default) score += 1
  return score
}

function preferredWebVoice() {
  const voices = window.speechSynthesis.getVoices()
  if (voices.length === 0) return undefined
  return [...voices].sort((a, b) => voiceScore(b) - voiceScore(a))[0]
}

async function detectWebGpu() {
  const gpu = (
    navigator as Navigator & { gpu?: { requestAdapter: () => Promise<unknown> } }
  ).gpu
  if (!gpu) return false
  try {
    return Boolean(await gpu.requestAdapter())
  } catch {
    return false
  }
}

async function loadKokoro() {
  if (kokoroFailed) return null
  kokoroLoading ??= (async () => {
    try {
      const { KokoroTTS } = await import('kokoro-js')
      const webgpu = await detectWebGpu()
      return await KokoroTTS.from_pretrained(KOKORO_MODEL, webgpu
        ? { dtype: 'fp32', device: 'webgpu' }
        : { dtype: 'q8', device: 'wasm' },
      )
    } catch (error) {
      kokoroFailed = true
      console.warn('Natural voice unavailable, using the browser voice', error)
      return null
    }
  })()
  return kokoroLoading
}

function playRawAudio(
  input: ArrayLike<number>,
  sampleRate: number,
  generation: number,
  onEnded: () => void,
) {
  const context = getAudioContext()
  if (!context) {
    onEnded()
    return
  }
  const samples = new Float32Array(input.length)
  samples.set(input as ArrayLike<number>)
  const buffer = context.createBuffer(1, samples.length, sampleRate)
  buffer.copyToChannel(samples, 0)
  const source = context.createBufferSource()
  source.buffer = buffer
  source.connect(context.destination)
  currentSource = source
  neuralSpeaking = true
  setSpeakStatus('speaking')
  source.onended = () => {
    if (currentSource === source) currentSource = null
    neuralSpeaking = false
    if (generation !== speakGeneration) return
    setSpeakStatus('idle')
    onEnded()
  }
  source.start()
}

function speakWithWebSpeech(text: string, generation: number, onEnded: () => void) {
  if (!canUseWebSpeech()) {
    onEnded()
    return
  }
  const utterance = new SpeechSynthesisUtterance(text)
  utterance.rate = 0.98
  const voice = preferredWebVoice()
  if (voice) utterance.voice = voice
  utterance.onend = () => {
    if (generation !== speakGeneration) return
    setSpeakStatus('idle')
    onEnded()
  }
  utterance.onerror = (event) => {
    if (event.error === 'interrupted' || event.error === 'canceled') return
    if (generation !== speakGeneration) return
    setSpeakStatus('idle')
    onEnded()
  }
  setSpeakStatus('speaking')
  window.speechSynthesis.speak(utterance)
}

export function speakText(text: string, onEnd?: () => void) {
  const generation = ++speakGeneration
  stopPlayback()
  const spoken = text.trim()
  const finish = () => {
    if (generation !== speakGeneration) return
    neuralSpeaking = false
    setSpeakStatus('idle')
    onEnd?.()
  }
  if (!spoken) {
    queueMicrotask(finish)
    return
  }

  // Keep AudioContext in the user-gesture stack so playback can start later.
  getAudioContext()
  setSpeakStatus('loading')

  void (async () => {
    try {
      const tts = await loadKokoro()
      if (generation !== speakGeneration) return
      if (tts) {
        const audio = await tts.generate(spoken, { voice: KOKORO_VOICE, speed: 1 })
        if (generation !== speakGeneration) return
        playRawAudio(audio.audio, audio.sampling_rate, generation, finish)
        return
      }
    } catch (error) {
      console.warn('Natural voice failed, using the browser voice', error)
    }
    if (generation !== speakGeneration) return
    speakWithWebSpeech(spoken, generation, finish)
  })()
}
