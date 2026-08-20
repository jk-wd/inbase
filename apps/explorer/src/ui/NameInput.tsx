import { useEffect, useRef } from 'react'

type NameInputProps = {
  placeholder: string
  onCommit: (name: string) => void
  onCancel: () => void
}

export function NameInput({ placeholder, onCommit, onCancel }: NameInputProps) {
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const timer = window.setTimeout(() => input.current?.focus(), 40)
    return () => window.clearTimeout(timer)
  }, [])

  return (
    <form
      className="block-name-form"
      onPointerDown={(event) => event.stopPropagation()}
      onSubmit={(event) => {
        event.preventDefault()
        const value = input.current?.value ?? ''
        if (!value.trim()) return
        onCommit(value)
      }}
    >
      <input
        ref={input}
        className="block-name-input"
        placeholder={placeholder}
        aria-label={placeholder}
        autoComplete="off"
        spellCheck={false}
        onKeyDown={(event) => {
          event.stopPropagation()
          if (event.code === 'Escape') {
            event.preventDefault()
            onCancel()
          }
        }}
      />
    </form>
  )
}
