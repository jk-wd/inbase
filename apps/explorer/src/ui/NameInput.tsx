import { useEffect, useRef, useState } from 'react'
import { beginKeyboardIsolation } from '../keyboard'

type NameInputProps = {
  placeholder: string
  fallbackName?: string
  commitOnOutside?: boolean
  onCommit: (name: string) => void
  onCancel: () => void
}

export function NameInput({
  placeholder,
  fallbackName,
  commitOnOutside = true,
  onCommit,
  onCancel,
}: NameInputProps) {
  const input = useRef<HTMLInputElement>(null)
  const form = useRef<HTMLFormElement>(null)
  const onCommitRef = useRef(onCommit)
  const fallbackRef = useRef(fallbackName)
  onCommitRef.current = onCommit
  fallbackRef.current = fallbackName

  useEffect(() => {
    const timer = window.setTimeout(() => input.current?.focus(), 40)
    return () => window.clearTimeout(timer)
  }, [])

  useEffect(() => beginKeyboardIsolation(), [])

  const commit = (allowFallback: boolean) => {
    const typed = input.current?.value ?? ''
    const value = typed.trim()
      ? typed
      : allowFallback
        ? (fallbackRef.current ?? '')
        : ''
    if (!value.trim()) return
    onCommitRef.current(value)
  }

  useEffect(() => {
    if (!commitOnOutside) return
    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return
      const target = event.target
      if (!(target instanceof Element)) return
      if (form.current?.contains(target)) return
      if (!target.closest('.stage')) return
      commit(true)
    }
    window.addEventListener('pointerdown', onPointerDown, true)
    return () => window.removeEventListener('pointerdown', onPointerDown, true)
  }, [commitOnOutside])

  return (
    <form
      ref={form}
      className="block-name-form"
      onPointerDown={(event) => event.stopPropagation()}
      onSubmit={(event) => {
        event.preventDefault()
        commit(false)
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

export function InfoNameField({
  name,
  onRename,
}: {
  name: string
  onRename: (name: string) => boolean
}) {
  const [value, setValue] = useState(name)
  const [focused, setFocused] = useState(false)
  const nameRef = useRef(name)
  const skipCommit = useRef(false)
  nameRef.current = name

  useEffect(() => {
    setValue(name)
  }, [name])

  useEffect(() => {
    if (!focused) return
    return beginKeyboardIsolation()
  }, [focused])

  const commit = () => {
    const trimmed = value.trim()
    if (!trimmed) {
      setValue(nameRef.current)
      return
    }
    if (trimmed === nameRef.current) return
    if (!onRename(trimmed)) setValue(nameRef.current)
  }

  return (
    <input
      className="hud-info-name"
      value={value}
      aria-label="File name"
      title="Rename file"
      autoComplete="off"
      spellCheck={false}
      onChange={(event) => setValue(event.target.value)}
      onFocus={(event) => {
        setFocused(true)
        const field = event.currentTarget
        window.requestAnimationFrame(() => field.select())
      }}
      onBlur={() => {
        setFocused(false)
        if (skipCommit.current) {
          skipCommit.current = false
          return
        }
        commit()
      }}
      onPointerDown={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        event.stopPropagation()
        if (event.code === 'Enter') {
          event.preventDefault()
          commit()
          skipCommit.current = true
          event.currentTarget.blur()
        }
        if (event.code === 'Escape') {
          event.preventDefault()
          skipCommit.current = true
          setValue(nameRef.current)
          event.currentTarget.blur()
        }
      }}
    />
  )
}
