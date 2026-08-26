import path from 'node:path'

export const IGNORE_DIR_NAMES = new Set([
  'node_modules',
  'dist',
  'build',
  'out',
  'coverage',
  '.git',
  '.inbase',
])

export const IGNORE_FILE_NAMES = new Set(['package-lock.json'])

export function toPosix(filePath) {
  return filePath.split(path.sep).join('/')
}

/** True when any path segment is ignored, e.g. apps/web/node_modules/pkg/index.js. */
export function shouldIgnoreRelativePath(relative) {
  const parts = toPosix(relative).split('/').filter(Boolean)
  if (
    parts.some(
      (part) =>
        IGNORE_DIR_NAMES.has(part) ||
        (part.startsWith('.') && part !== '.' && part !== '..'),
    )
  ) {
    return true
  }
  return IGNORE_FILE_NAMES.has(parts.at(-1) ?? '')
}

export function gitExcludeArgs() {
  const args = []
  for (const dir of IGNORE_DIR_NAMES) {
    args.push(`--exclude=${dir}/`, `--exclude=**/${dir}/`)
  }
  for (const file of IGNORE_FILE_NAMES) {
    args.push(`--exclude=${file}`, `--exclude=**/${file}`)
  }
  return args
}
