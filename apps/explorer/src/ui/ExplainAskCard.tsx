import { useEffect } from 'react'
import type { ExplainSession } from '../types'
import { explainCardCopy, explainTargetLabel } from '../explain'
import { shouldIgnoreShortcut } from '../keyboard'

export function ExplainAskCard({
  explain,
  onClose,
}: {
  explain: ExplainSession
  onClose: () => void
}) {
  const copy = explainCardCopy(explain)
  const pending = explain.pendingStart
  const subtitle = pending
    ? explainTargetLabel(pending)
    : explain.question || 'Explanation'

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.repeat) return
      if (event.code !== 'Escape') return
      if (shouldIgnoreShortcut(event) && event.code !== 'Escape') return
      event.preventDefault()
      onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="hud-note-overlay explain-ask-overlay" onClick={onClose}>
      <div
        className="explain-ask-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="explain-ask-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="explain-ask-card-header">
          <div className="explain-ask-card-heading">
            <h1 id="explain-ask-title">{copy.title}</h1>
            <p className="explain-ask-card-subtitle">{subtitle}</p>
          </div>
          <button
            className="hud-button explain-exit"
            type="button"
            aria-label="Close explanation"
            title="Close explanation"
            onClick={onClose}
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
        </div>
        {copy.ready ? (
          <p className="explain-body explain-ask-card-body">{copy.body}</p>
        ) : (
          <p className="explain-preparing" role="status">
            Preparing an explanation… Type /explain in the Cursor chat.
          </p>
        )}
      </div>
    </div>
  )
}
