import { useEffect, useRef } from 'react'
import {
  explainHitsSymbol,
  explainMatchesSymbol,
} from '../explain'
import type { ExplainSymbolRef, FileNode } from '../types'
import { FileIcon } from './EyeIcon'

function fileBase(id: string) {
  return id.split('/').pop() ?? id
}

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
  empty,
}: {
  title: string
  kind: FileNode['symbols'][number]['kind']
  names: string[]
  highlights: ExplainSymbolRef[]
  point: ExplainSymbolRef | null
  empty: string
}) {
  return (
    <>
      <div className="hud-section-title">{title}</div>
      {names.length === 0 ? (
        <p>{empty}</p>
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
                data-explain-highlight={
                  highlighted && !pointed ? 'true' : undefined
                }
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
  const highlightFile =
    pointFile || explainHitsSymbol(highlights, 'file', file.id)

  const highlightKey = highlights
    .map((item) => `${item.kind}:${item.name}`)
    .join('|')

  useEffect(() => {
    const target = bodyRef.current?.querySelector(
      '[data-explain-target="true"], [data-explain-highlight="true"]',
    )
    if (!(target instanceof HTMLElement)) return
    target.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [file.id, point?.kind, point?.name, highlightKey])

  return (
    <div className="hud">
      <div className="hud-right-stack">
        <aside className="hud-panel hud-panel-info explain-info-panel">
          <div className="hud-panel-chrome">
            <div className="hud-panel-chrome-heading">
              <div className="hud-panel-chrome-title-row">
                <div
                  className="hud-panel-chrome-title"
                  data-explain-target={pointFile ? 'true' : undefined}
                  data-explain-highlight={
                    highlightFile && !pointFile ? 'true' : undefined
                  }
                >
                  <span className="hud-info-kind-title">
                    <FileIcon />
                    {file.name}
                  </span>
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
                empty="No classes"
              />
            )}
            <SymbolList
              title={kindLabel('function')}
              kind="function"
              names={functions}
              highlights={highlights}
              point={point}
              empty="No functions"
            />
            <SymbolList
              title={kindLabel('variable')}
              kind="variable"
              names={variables}
              highlights={highlights}
              point={point}
              empty="No vars"
            />
            <div className="hud-section-title">Imports</div>
            {file.imports.length === 0 ? (
              <p>No local imports</p>
            ) : (
              <ul>
                {file.imports.map((id) => (
                  <li key={id} title={id}>
                    <span>{fileBase(id)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </aside>
      </div>
    </div>
  )
}
