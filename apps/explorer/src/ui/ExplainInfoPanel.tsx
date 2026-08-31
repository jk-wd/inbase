import { useEffect, useRef } from 'react'
import {
  explainHitsSymbol,
  explainMatchesSymbol,
} from '../explain'
import type { ExplainSymbolRef, FileNode } from '../types'

function kindLabel(kind: FileNode['symbols'][number]['kind']) {
  if (kind === 'variable') return 'Vars'
  if (kind === 'class') return 'Classes'
  return 'Functions'
}

function SymbolList({
  title,
  kind,
  names,
  highlights,
  point,
}: {
  title: string
  kind: FileNode['symbols'][number]['kind']
  names: string[]
  highlights: ExplainSymbolRef[]
  point: ExplainSymbolRef | null
}) {
  const dimOthers = highlights.length > 0 || Boolean(point)
  return (
    <>
      <div className="hud-section-title">{title}</div>
      {names.length === 0 ? (
        <p>No {title.toLowerCase()}</p>
      ) : (
        <ul>
          {names.map((name) => {
            const pointed = explainMatchesSymbol(point, kind, name)
            const highlighted =
              pointed || explainHitsSymbol(highlights, kind, name)
            return (
              <li
                key={`${kind}-${name}`}
                data-explain-target={pointed ? 'true' : undefined}
                data-explain-highlight={highlighted ? 'true' : undefined}
                data-explain-dim={dimOthers && !highlighted ? 'true' : undefined}
              >
                <span>{name}</span>
              </li>
            )
          })}
        </ul>
      )}
    </>
  )
}

export function ExplainInfoPanel({
  file,
  highlights,
  point,
}: {
  file: FileNode
  highlights: ExplainSymbolRef[]
  point: ExplainSymbolRef | null
}) {
  const bodyRef = useRef<HTMLDivElement | null>(null)
  const classes = file.symbols
    .filter((symbol) => symbol.kind === 'class')
    .map((symbol) => symbol.name)
  const functions = file.symbols
    .filter((symbol) => symbol.kind === 'function')
    .map((symbol) => symbol.name)
  const variables = file.symbols
    .filter((symbol) => symbol.kind === 'variable')
    .map((symbol) => symbol.name)
  const pointFile = explainMatchesSymbol(point, 'file', file.id)

  useEffect(() => {
    const target = bodyRef.current?.querySelector('[data-explain-target="true"]')
    if (!(target instanceof HTMLElement)) return
    target.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [file.id, point?.kind, point?.name])

  return (
    <div className="hud explain-info-stack">
      <aside className="hud-panel hud-panel-info explain-info-panel">
        <div className="hud-panel-chrome">
          <div className="hud-panel-chrome-heading">
            <div className="hud-panel-chrome-title-row">
              <div
                className="hud-panel-chrome-title"
                data-explain-target={pointFile ? 'true' : undefined}
                data-explain-highlight={
                  pointFile || explainHitsSymbol(highlights, 'file', file.id)
                    ? 'true'
                    : undefined
                }
              >
                {file.name}
              </div>
            </div>
          </div>
        </div>
        <div ref={bodyRef} className="hud-panel-body">
          <p className="path">{file.path}</p>
          <p>
            {file.lines} lines · {file.language}
          </p>
          {classes.length > 0 && (
            <SymbolList
              title={kindLabel('class')}
              kind="class"
              names={classes}
              highlights={highlights}
              point={point}
            />
          )}
          <SymbolList
            title={kindLabel('function')}
            kind="function"
            names={functions}
            highlights={highlights}
            point={point}
          />
          <SymbolList
            title={kindLabel('variable')}
            kind="variable"
            names={variables}
            highlights={highlights}
            point={point}
          />
        </div>
      </aside>
    </div>
  )
}
