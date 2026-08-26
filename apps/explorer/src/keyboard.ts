let isolation = 0

export function beginKeyboardIsolation() {
  isolation += 1
  return () => {
    isolation = Math.max(0, isolation - 1)
  }
}

export function isKeyboardIsolated() {
  return isolation > 0
}

export function isTypingInField(target: EventTarget | null) {
  return (
    target instanceof HTMLElement &&
    (target.tagName === 'TEXTAREA' ||
      target.tagName === 'INPUT' ||
      target.tagName === 'SELECT' ||
      target.isContentEditable)
  )
}

export function shouldIgnoreShortcut(event: KeyboardEvent) {
  return isKeyboardIsolated() || isTypingInField(event.target)
}
