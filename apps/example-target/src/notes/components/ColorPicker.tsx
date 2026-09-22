import { NOTE_COLORS } from '../constants'

type ColorPickerProps = {
  value: string
  onChange: (color: string) => void
}

export function ColorPicker({ value, onChange }: ColorPickerProps) {
  return (
    <div className="note-color-picker" role="radiogroup" aria-label="Note color">
      {NOTE_COLORS.map((color) => {
        const selected = color === value
        return (
          <button
            key={color}
            type="button"
            role="radio"
            aria-checked={selected}
            className="note-color-swatch"
            style={{ backgroundColor: color }}
            onClick={() => onChange(color)}
          >
            <span className="sr-only">{color}</span>
          </button>
        )
      })}
    </div>
  )
}
