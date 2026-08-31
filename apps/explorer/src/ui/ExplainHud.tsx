import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import type { ExplainSession } from '../types'
import {
  currentExplainStep,
  explainIsPreparing,
  explainNeighbor,
  explainSpeechText,
  explainStepDepth,
  explainStepPosition,
} from '../explain'
import { shouldIgnoreShortcut } from '../keyboard'
import {
  AUTO_STEP_DELAY_MS,
  canSpeak,
  isSpeaking,
  speakText,
  stopSpeaking,
  subscribeSpeakStatus,
  type SpeakStatus,
} from '../speech'

export function ExplainHud({
  explain,
  onStep,
  onExit,
}: {
  explain: ExplainSession
  onStep: (step: string) => void
  onExit: () => void
}) {
  const step = currentExplainStep(explain)
  const count = explain.steps.length
  const id = step?.index ?? explain.currentStep
  const position = explainStepPosition(explain, id)
  const hasSteps = count > 0
  const starting = explain.active && !hasSteps
  const askingAbout = explain.pendingQuestion
  const preparingFollowUp = explainIsPreparing(explain) && hasSteps
  const speechAvailable = canSpeak()
  const [telling, setTelling] = useState(false)
  const [autoStep, setAutoStep] = useState(false)
  const [speakStatus, setSpeakStatus] = useState<SpeakStatus>('idle')
  const tellingRef = useRef(false)
  const autoStepRef = useRef(false)
  const autoTimerRef = useRef<number | null>(null)
  const waitTickRef = useRef<number | null>(null)
  const [autoWaitMs, setAutoWaitMs] = useState<number | null>(null)
  const [autoWaitToken, setAutoWaitToken] = useState(0)
  const idRef = useRef(id)
  const goToRef = useRef<(stepId: string) => void>(() => {})
  const neighborRef = useRef<(delta: number) => string | null>(() => null)
  const activeItemRef = useRef<HTMLLIElement | null>(null)
  const [pointerTop, setPointerTop] = useState<number | null>(null)
  idRef.current = id

  const clearAutoTimer = useCallback(() => {
    if (autoTimerRef.current != null) {
      window.clearTimeout(autoTimerRef.current)
      autoTimerRef.current = null
    }
    if (waitTickRef.current != null) {
      window.clearInterval(waitTickRef.current)
      waitTickRef.current = null
    }
    setAutoWaitMs(null)
  }, [])

  const neighbor = useCallback(
    (delta: number) => explainNeighbor(explain, idRef.current, delta),
    [explain],
  )
  neighborRef.current = neighbor

  const scheduleAutoStep = useCallback(() => {
    clearAutoTimer()
    if (!autoStepRef.current || !tellingRef.current) return
    if (!neighborRef.current(1)) return
    const endsAt = Date.now() + AUTO_STEP_DELAY_MS
    setAutoWaitMs(AUTO_STEP_DELAY_MS)
    setAutoWaitToken((token) => token + 1)
    waitTickRef.current = window.setInterval(() => {
      const left = Math.max(0, endsAt - Date.now())
      setAutoWaitMs(left)
      if (left <= 0 && waitTickRef.current != null) {
        window.clearInterval(waitTickRef.current)
        waitTickRef.current = null
      }
    }, 100)
    autoTimerRef.current = window.setTimeout(() => {
      autoTimerRef.current = null
      setAutoWaitMs(null)
      if (!autoStepRef.current || !tellingRef.current) return
      const next = neighborRef.current(1)
      if (!next) return
      goToRef.current(next)
    }, AUTO_STEP_DELAY_MS)
  }, [clearAutoTimer])

  const speakCurrent = useCallback(
    (stepId: string) => {
      const item =
        explain.steps.find((entry) => entry.index === stepId) ?? null
      speakText(explainSpeechText(item), () => {
        if (autoStepRef.current) scheduleAutoStep()
      })
    },
    [explain.steps, scheduleAutoStep],
  )

  const goTo = useCallback(
    (stepId: string) => {
      if (!explain.steps.some((entry) => entry.index === stepId)) return
      clearAutoTimer()
      onStep(stepId)
      if (!tellingRef.current) return
      speakCurrent(stepId)
    },
    [clearAutoTimer, explain.steps, onStep, speakCurrent],
  )
  goToRef.current = goTo

  const stopTelling = useCallback(() => {
    tellingRef.current = false
    autoStepRef.current = false
    setTelling(false)
    setAutoStep(false)
    clearAutoTimer()
    stopSpeaking()
  }, [clearAutoTimer])

  const startTelling = useCallback(
    (withAutoStep: boolean) => {
      if (!speechAvailable) return
      tellingRef.current = true
      autoStepRef.current = withAutoStep
      setTelling(true)
      setAutoStep(withAutoStep)
      speakCurrent(id)
    },
    [id, speakCurrent, speechAvailable],
  )

  const tellAgain = () => {
    if (!speechAvailable) return
    tellingRef.current = true
    setTelling(true)
    clearAutoTimer()
    speakCurrent(id)
  }

  const toggleTell = () => {
    if (!speechAvailable) return
    if (telling) {
      stopTelling()
      return
    }
    startTelling(false)
  }

  const toggleAutoStep = () => {
    if (!speechAvailable) return
    if (autoStep) {
      autoStepRef.current = false
      setAutoStep(false)
      clearAutoTimer()
      return
    }
    if (!telling) {
      startTelling(true)
      return
    }
    autoStepRef.current = true
    setAutoStep(true)
    if (!isSpeaking()) scheduleAutoStep()
  }

  useEffect(() => subscribeSpeakStatus(setSpeakStatus), [])

  useEffect(
    () => () => {
      clearAutoTimer()
      stopSpeaking()
    },
    [clearAutoTimer],
  )

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.repeat) return
      if (shouldIgnoreShortcut(event) && event.code !== 'Escape') return
      if (event.code === 'Escape') {
        event.preventDefault()
        onExit()
        return
      }
      if (shouldIgnoreShortcut(event)) return
      if (!hasSteps) return
      if (event.code === 'ArrowRight' || event.code === 'ArrowDown') {
        event.preventDefault()
        const next = neighbor(1)
        if (next) goTo(next)
        return
      }
      if (event.code === 'ArrowLeft' || event.code === 'ArrowUp') {
        event.preventDefault()
        const previous = neighbor(-1)
        if (previous) goTo(previous)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [goTo, hasSteps, neighbor, onExit])

  useEffect(() => {
    activeItemRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [id])

  useEffect(() => {
    if (!step?.point) {
      setPointerTop(null)
      return
    }
    const frame = window.requestAnimationFrame(() => {
      const item = activeItemRef.current
      const hud = item?.closest('.explain-hud')
      if (!item || !(hud instanceof HTMLElement)) return
      const itemBox = item.getBoundingClientRect()
      const hudBox = hud.getBoundingClientRect()
      setPointerTop(itemBox.top + itemBox.height / 2 - hudBox.top)
    })
    return () => window.cancelAnimationFrame(frame)
  }, [id, step?.point])

  const prevId = neighbor(-1)
  const nextId = neighbor(1)
  const followUpParent = askingAbout?.parent ?? null

  return (
    <div className="hud explain-hud">
      <header className="explain-header">
        <p className="explain-question">
          {explain.question || 'Explanation'}
        </p>
        <button
          className="hud-button explain-exit"
          type="button"
          aria-label="Exit explain mode"
          title="Exit explain mode"
          onClick={onExit}
        >
          <svg
            viewBox="0 0 24 24"
            width="18"
            height="18"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <path d="M6 6l12 12" />
            <path d="M18 6L6 18" />
          </svg>
        </button>
      </header>

      {starting ? (
        <p className="explain-body">Preparing an explanation…</p>
      ) : hasSteps ? (
        <>
          {preparingFollowUp && askingAbout ? (
            <p className="explain-preparing" role="status">
              Preparing an answer for step {askingAbout.from || askingAbout.parent}: {askingAbout.question}
            </p>
          ) : preparingFollowUp ? (
            <p className="explain-preparing" role="status">
              Preparing a closer look at this step…
            </p>
          ) : null}
          <ol className="explain-steps" aria-label="Explanation steps">
            {explain.steps.map((item) => {
              const active = item.index === id
              const depth = explainStepDepth(item.index)
              const waitingHere =
                followUpParent === item.index && preparingFollowUp
              return (
                <li
                  key={item.index}
                  ref={active ? activeItemRef : undefined}
                  data-active={active}
                  data-past={position >= 0 && explainStepPosition(explain, item.index) < position}
                  style={{ '--explain-depth': depth } as CSSProperties}
                >
                  <button
                    className="hud-button explain-step"
                    type="button"
                    data-active={active}
                    aria-current={active ? 'step' : undefined}
                    onClick={() => goTo(item.index)}
                  >
                    <span className="explain-step-index">{item.index}</span>
                    <span className="explain-step-title">{item.title}</span>
                  </button>
                  {item.asked ? (
                    <p className="explain-asked">Asked: {item.asked}</p>
                  ) : null}
                  {active && item.body ? (
                    <p className="explain-body">{item.body}</p>
                  ) : null}
                  {waitingHere ? (
                    <p className="explain-preparing-step">Preparing sub-steps…</p>
                  ) : null}
                  {active && !preparingFollowUp ? (
                    <p className="explain-ask-hint">
                      Type /explain your question in the Cursor chat.
                    </p>
                  ) : null}
                </li>
              )
            })}
          </ol>
          <div className="explain-footer">
            {telling && speakStatus === 'loading' ? (
              <p className="explain-voice-status">Loading a natural voice…</p>
            ) : null}
            <div className="explain-tell-controls">
              <button
                className="hud-button explain-tell"
                type="button"
                data-active={telling}
                aria-pressed={telling}
                aria-label={telling ? 'Stop telling' : 'Tell me'}
                title={
                  speechAvailable
                    ? telling
                      ? 'Stop reading this explanation'
                      : 'Read this explanation aloud'
                    : 'Speech is not available in this browser'
                }
                disabled={!speechAvailable}
                onClick={toggleTell}
              >
                {telling ? 'Stop' : 'Tell me'}
              </button>
              <button
                className="hud-button explain-tell-again"
                type="button"
                aria-label="Tell again"
                title={
                  speechAvailable
                    ? 'Read this step aloud again'
                    : 'Speech is not available in this browser'
                }
                disabled={!speechAvailable}
                onClick={tellAgain}
              >
                Tell again
              </button>
              <button
                className="hud-button explain-auto-step"
                type="button"
                data-active={autoStep}
                aria-pressed={autoStep}
                aria-label={
                  autoStep ? 'Turn off auto step' : 'Auto step after dictation'
                }
                title={
                  speechAvailable
                    ? autoStep
                      ? 'Stop advancing automatically'
                      : 'Advance to the next step 4 seconds after each dictation'
                    : 'Speech is not available in this browser'
                }
                disabled={!speechAvailable}
                onClick={toggleAutoStep}
              >
                Auto step
              </button>
            </div>
            {autoStep && autoWaitMs != null && nextId ? (
              <div
                className="explain-auto-wait"
                role="status"
                aria-live="polite"
                aria-label={`Next step in ${Math.max(1, Math.ceil(autoWaitMs / 1000))} seconds`}
              >
                <div className="explain-auto-wait-track" aria-hidden="true">
                  <div
                    key={autoWaitToken}
                    className="explain-auto-wait-fill"
                    style={{ animationDuration: `${AUTO_STEP_DELAY_MS}ms` }}
                  />
                </div>
                <p className="explain-auto-wait-label">
                  {autoWaitMs <= 0
                    ? 'Next…'
                    : `Next in ${Math.ceil(autoWaitMs / 1000)}s`}
                </p>
              </div>
            ) : null}
            <div className="explain-nav-controls">
              <button
                className="hud-button"
                type="button"
                aria-label="Previous step"
                disabled={!prevId}
                onClick={() => prevId && goTo(prevId)}
              >
                Prev
              </button>
              <span className="explain-nav-position">
                {id}
                {count > 0 ? ` · ${position + 1}/${count}` : ''}
              </span>
              <button
                className="hud-button"
                type="button"
                aria-label="Next step"
                disabled={!nextId}
                onClick={() => nextId && goTo(nextId)}
              >
                Next
              </button>
            </div>
          </div>
        </>
      ) : null}
      {step?.point && pointerTop != null ? (
        <span
          className="explain-pointer-origin"
          data-explain-pointer-origin=""
          aria-hidden="true"
          style={{ top: pointerTop }}
        />
      ) : null}
    </div>
  )
}
