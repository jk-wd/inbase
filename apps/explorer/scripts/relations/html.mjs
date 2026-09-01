export const id = 'html'

export const extensions = new Set(['.html', '.htm'])

const SCRIPT_SRC =
  /<script\b[^>]*\bsrc\s*=\s*['"]([^'"]+)['"][^>]*>/gi

export function collectSpecifiers(source) {
  const specifiers = []
  for (const match of source.matchAll(SCRIPT_SRC)) {
    specifiers.push(match[1])
  }
  return specifiers
}

export function extractBindings(source) {
  return collectSpecifiers(source).map((from) => ({ name: from, from }))
}
