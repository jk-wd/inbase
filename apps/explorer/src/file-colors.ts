/** Fallback for extensions that are not in FILE_COLORS. */
export const DEFAULT_FILE_COLOR = '#2e333d'

/**
 * Map file extensions (no leading dot) to block colors.
 * Add an entry here when a language should have its own color on the map.
 */
export const FILE_COLORS: Record<string, string> = {
  tsx: '#3f6f9a',
  ts: '#2f6d68',
  jsx: '#7d6aa3',
  js: '#6a5f8f',
  mjs: '#6a5f8f',
  cjs: '#6a5f8f',
  css: '#8a5b33',
  scss: '#8a5b33',
  json: '#7a6a38',
  html: '#6d4e38',
  htm: '#6d4e38',
}

export function fileColor(language: string) {
  const key = language.replace(/^\./, '').toLowerCase()
  return FILE_COLORS[key] ?? DEFAULT_FILE_COLOR
}
