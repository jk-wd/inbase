import { useLayoutEffect, useState } from 'react'

type Arrow = {
  d: string
  head: string
}

function measureArrow(): Arrow | null {
  const from = document.querySelector('[data-explain-pointer-origin]')
  const to = document.querySelector('[data-explain-target="true"]')
  if (!(from instanceof HTMLElement) || !(to instanceof HTMLElement)) return null
  const start = from.getBoundingClientRect()
  const end = to.getBoundingClientRect()
  if (start.width === 0 || end.width === 0) return null
  const x1 = start.right
  const y1 = start.top + start.height / 2
  const x2 = end.left - 2
  const y2 = end.top + end.height / 2
  const span = Math.max(72, Math.abs(x2 - x1) * 0.42)
  const c1x = x1 + span
  const c1y = y1
  const c2x = x2 - span
  const c2y = y2
  const angle = Math.atan2(y2 - c2y, x2 - c2x)
  const size = 11
  const hx = x2
  const hy = y2
  const left = [
    hx - size * Math.cos(angle - 0.42),
    hy - size * Math.sin(angle - 0.42),
  ]
  const right = [
    hx - size * Math.cos(angle + 0.42),
    hy - size * Math.sin(angle + 0.42),
  ]
  return {
    d: `M ${x1} ${y1} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${x2} ${y2}`,
    head: `M ${hx} ${hy} L ${left[0]} ${left[1]} L ${right[0]} ${right[1]} Z`,
  }
}

export function ExplainPointer({ stepKey }: { stepKey: string }) {
  const [arrow, setArrow] = useState<Arrow | null>(null)

  useLayoutEffect(() => {
    let frame = 0
    const tick = () => {
      const next = measureArrow()
      setArrow((current) => {
        if (current?.d === next?.d && current?.head === next?.head) return current
        return next
      })
      frame = window.requestAnimationFrame(tick)
    }
    frame = window.requestAnimationFrame(tick)
    return () => window.cancelAnimationFrame(frame)
  }, [stepKey])

  if (!arrow) return null

  return (
    <svg
      className="explain-pointer"
      aria-hidden="true"
      width="100%"
      height="100%"
    >
      <path className="explain-pointer-glow" d={arrow.d} fill="none" />
      <path className="explain-pointer-line" d={arrow.d} fill="none" />
      <path className="explain-pointer-head" d={arrow.head} />
    </svg>
  )
}
