import { useState } from 'react'

function randomHexColor() {
  const value = Math.floor(Math.random() * 0xffffff)
  return `#${value.toString(16).padStart(6, '0')}`
}

export default function ColorGenerator() {
  const [color, setColor] = useState(randomHexColor)

  return (
    <section
      style={{
        backgroundColor: color,
        minHeight: '40vh',
        display: 'grid',
        placeItems: 'center',
        gap: '1rem',
        padding: '2rem',
        borderRadius: '1rem',
      }}
    >
      <p style={{ margin: 0, fontSize: '1.25rem' }}>{color}</p>
      <button type="button" onClick={() => setColor(randomHexColor())}>
        Generate random background
      </button>
    </section>
  )
}
