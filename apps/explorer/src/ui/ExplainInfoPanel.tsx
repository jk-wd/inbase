import { useEffect, useRef } from 'react'
import {
  explainHitsSymbol,
  explainMatchesSymbol,
} from '../explain'
import { fileInfoMeta } from '../layout'
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
  onOpenFile,
}: {
  file: FileNode
  highlights: ExplainSymbolRef[]
  point: ExplainSymbolRef | null
  onOpenFile?: (fileId: string) => void
}) {
  const bodyRef = useRef<HTMLDivElement | null>(null)
  const classes = file.symbols.filter((symbol) => symbol.kind === 'class')
  const classNames = new Set(classes.map((symbol) => symbol.name))
  const memberFunctions = file.symbols.filter(
    (symbol) =>
      symbol.kind === 'function' && symbol.class && classNames.has(symbol.class),
  )
  const memberVariables = file.symbols.filter(
    (symbol) =>
      symbol.kind === 'variable' && symbol.class && classNames.has(symbol.class),
  )
  const functions = file.symbols
    .filter(
      (symbol) =>
        symbol.kind === 'function' &&
        (!symbol.class || !classNames.has(symbol.class)),
    )
    .map((symbol) => symbol.name)
  const variables = file.symbols
    .filter(
      (symbol) =>
        symbol.kind === 'variable' &&
        (!symbol.class || !classNames.has(symbol.class)),
    )
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
                  {onOpenFile && !file.id.startsWith('draft:') ? (
                    <button
                      type="button"
                      className="hud-info-kind-title hud-info-open-title"
                      onClick={() => onOpenFile(file.id)}
                      title={`Open ${file.name}`}
                      aria-label={`Open ${file.name}`}
                    >
                      <FileIcon />
                      {file.name}
                    </button>
                  ) : (
                    <span className="hud-info-kind-title">
                      <FileIcon />
                      {file.name}
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>
          <div ref={bodyRef} className="hud-panel-body">
            <p className="path">{file.path}</p>
            <p>{fileInfoMeta(file)}</p>
            {!file.binary && (
              <>
                {classes.length > 0 && (
                  <>
                    <div className="hud-section-title">{kindLabel('class')}</div>
                    <ul>
                      {classes.map((symbol) => {
                        const functionsForClass = memberFunctions.filter(
                          (item) => item.class === symbol.name,
                        )
                        const variablesForClass = memberVariables.filter(
                          (item) => item.class === symbol.name,
                        )
                        const pointed = explainMatchesSymbol(point, 'class', symbol.name)
                        const highlighted =
                          pointed || explainHitsSymbol(highlights, 'class', symbol.name)
                        return (
                          <li
                            key={`class-${symbol.name}`}
                            className={
                              functionsForClass.length > 0 || variablesForClass.length > 0
                                ? 'hud-class-block'
                                : undefined
                            }
                            data-explain-target={pointed ? 'true' : undefined}
                            data-explain-highlight={
                              highlighted && !pointed ? 'true' : undefined
                            }
                          >
                            <span className="hud-class-name">{symbol.name}</span>
                            {functionsForClass.length > 0 || variablesForClass.length > 0 ? (
                              <ul className="hud-class-members">
                                {functionsForClass.length > 0 && (
                                  <>
                                    <li className="hud-class-kind">Functions</li>
                                    {functionsForClass.map((item) => {
                                      const itemPointed = explainMatchesSymbol(
                                        point,
                                        'function',
                                        item.name,
                                      )
                                      const itemHighlighted =
                                        itemPointed ||
                                        explainHitsSymbol(highlights, 'function', item.name)
                                      return (
                                        <li
                                          key={`fn-${item.name}`}
                                          data-explain-target={itemPointed ? 'true' : undefined}
                                          data-explain-highlight={
                                            itemHighlighted && !itemPointed ? 'true' : undefined
                                          }
                                        >
                                          <span>{item.name}</span>
                                        </li>
                                      )
                                    })}
                                  </>
                                )}
                                {variablesForClass.length > 0 && (
                                  <>
                                    <li className="hud-class-kind">Vars</li>
                                    {variablesForClass.map((item) => {
                                      const itemPointed = explainMatchesSymbol(
                                        point,
                                        'variable',
                                        item.name,
                                      )
                                      const itemHighlighted =
                                        itemPointed ||
                                        explainHitsSymbol(highlights, 'variable', item.name)
                                      return (
                                        <li
                                          key={`var-${item.name}`}
                                          data-explain-target={itemPointed ? 'true' : undefined}
                                          data-explain-highlight={
                                            itemHighlighted && !itemPointed ? 'true' : undefined
                                          }
                                        >
                                          <span>{item.name}</span>
                                        </li>
                                      )
                                    })}
                                  </>
                                )}
                              </ul>
                            ) : null}
                          </li>
                        )
                      })}
                    </ul>
                  </>
                )}
                {(functions.length > 0 || classes.length === 0) && (
                  <SymbolList
                    title={kindLabel('function')}
                    kind="function"
                    names={functions}
                    highlights={highlights}
                    point={point}
                    empty="No functions"
                  />
                )}
                {(variables.length > 0 || classes.length === 0) && (
                  <SymbolList
                    title={kindLabel('variable')}
                    kind="variable"
                    names={variables}
                    highlights={highlights}
                    point={point}
                    empty="No vars"
                  />
                )}
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
              </>
            )}
          </div>
        </aside>
      </div>
    </div>
  )
}
