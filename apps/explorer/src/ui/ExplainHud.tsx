import { useCallback, useEffect, useRef, type CSSProperties } from 'react'
import type { ExplainSession } from '../types'
import {
  currentExplainStep,
  explainIsPreparing,
  explainNeighbor,
  explainStepDepth,
  explainStepPosition,
} from '../explain'
import { shouldIgnoreShortcut } from '../keyboard'

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
  const idRef = useRef(id)
  const activeItemRef = useRef<HTMLLIElement | null>(null)
  idRef.current = id

  const neighbor = useCallback(
    (delta: number) => explainNeighbor(explain, idRef.current, delta),
    [explain],
  )

  const goTo = useCallback(
    (stepId: string) => {
      if (!explain.steps.some((entry) => entry.index === stepId)) return
      onStep(stepId)
    },
    [explain.steps, onStep],
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
    </div>
  )
}
