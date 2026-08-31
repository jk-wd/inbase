import { useLayoutEffect, useState } from 'react'

type Arrow = {
  x1: number
  y1: number
  x2: number
  y2: number
  head: string
  primary: boolean
}

const SHAFT = 48
const HEAD = 10

function arrowHead(x: number, y: number) {
  return `M ${x} ${y} L ${x - HEAD} ${y - HEAD * 0.58} L ${x - HEAD} ${y + HEAD * 0.58} Z`
}

function measureArrows(): Arrow[] {
  const nodes = document.querySelectorAll(
    '[data-explain-target="true"], [data-explain-highlight="true"]',
  )
  const arrows: Arrow[] = []
  const seen = new Set<HTMLElement>()
  for (const node of nodes) {
    if (!(node instanceof HTMLElement) || seen.has(node)) continue
    seen.add(node)
    const box = node.getBoundingClientRect()
    if (box.width === 0 || box.height === 0) continue
    const panel = node.closest('.hud-panel-info')
    if (panel instanceof HTMLElement) {
      const panelBox = panel.getBoundingClientRect()
      const midY = box.top + box.height / 2
      if (midY < panelBox.top + 2 || midY > panelBox.bottom - 2) continue
    }
    const x2 = box.left - 4
    const y2 = box.top + box.height / 2
    arrows.push({
      x1: x2 - SHAFT,
      y1: y2,
      x2,
      y2,
      head: arrowHead(x2, y2),
      primary: node.getAttribute('data-explain-target') === 'true',
    })
  }
  return arrows
}

function sameArrows(a: Arrow[], b: Arrow[]) {
  if (a.length !== b.length) return false
  return a.every((arrow, index) => {
    const other = b[index]
    return (
      arrow.x1 === other.x1 &&
      arrow.y1 === other.y1 &&
      arrow.x2 === other.x2 &&
      arrow.y2 === other.y2 &&
      arrow.head === other.head &&
      arrow.primary === other.primary
    )
  })
}

export function ExplainPointer({ stepKey }: { stepKey: string }) {
  const [arrows, setArrows] = useState<Arrow[]>([])

  useLayoutEffect(() => {
    let frame = 0
    const tick = () => {
      const next = measureArrows()
      setArrows((current) => (sameArrows(current, next) ? current : next))
      frame = window.requestAnimationFrame(tick)
    }
    frame = window.requestAnimationFrame(tick)
    return () => window.cancelAnimationFrame(frame)
  }, [stepKey])

  if (arrows.length === 0) return null

  return (
    <svg
      className="explain-pointer"
      aria-hidden="true"
      width="100%"
      height="100%"
    >
      <defs>
        {arrows.map((arrow, index) => (
          <linearGradient
            key={`${stepKey}-fade-${index}`}
            id={`explain-pointer-fade-${index}`}
            gradientUnits="userSpaceOnUse"
            x1={arrow.x1}
            y1={arrow.y1}
            x2={arrow.x2}
            y2={arrow.y2}
          >
            <stop offset="0" stopColor="#9ad8ff" stopOpacity="0" />
            <stop
              offset="0.7"
              stopColor="#9ad8ff"
              stopOpacity={arrow.primary ? 1 : 0.55}
            />
          </linearGradient>
        ))}
      </defs>
      {arrows.map((arrow, index) => (
        <g key={`${stepKey}-arrow-${index}`}>
          <line
            className="explain-pointer-line"
            x1={arrow.x1}
            y1={arrow.y1}
            x2={arrow.x2}
            y2={arrow.y2}
            stroke={`url(#explain-pointer-fade-${index})`}
          />
          <path
            className={
              arrow.primary
                ? 'explain-pointer-head'
                : 'explain-pointer-head explain-pointer-head-secondary'
            }
            d={arrow.head}
          />
        </g>
      ))}
    </svg>
  )
}
