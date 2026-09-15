import { useState } from 'react'

function randomHexColor(): string {
  return `#${Math.floor(Math.random() * 0xffffff)
    .toString(16)
    .padStart(6, '0')}`
}

export function ColorGenerator() {
  const [color, setColor] = useState(randomHexColor)

  return (
    <section className="color-generator">
      <div
        className="color-generator-swatch"
        style={{ backgroundColor: color }}
        aria-hidden="true"
      />
      <p className="color-generator-value">{color}</p>
      <button type="button" onClick={() => setColor(randomHexColor())}>
        Generate color
      </button>
    </section>
  )
}
