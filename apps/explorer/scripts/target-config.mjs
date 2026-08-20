import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const explorerRoot = path.resolve(here, '..')
const repoRoot = path.resolve(explorerRoot, '../..')
const defaultTargetRoot = path.resolve(explorerRoot, '../example-target')
const defaultDataDir = path.resolve(explorerRoot, 'src/data')

export function resolvePathValue(value, fallback) {
  const raw = value?.trim()
  if (!raw) return fallback
  return path.isAbsolute(raw) ? path.normalize(raw) : path.resolve(process.cwd(), raw)
}

export function resolveTargetRoot(value = process.env.VISUAL_CODER_TARGET) {
  return resolvePathValue(value, defaultTargetRoot)
}

export function resolveDataDir(value = process.env.INBASE_DATA_DIR) {
  return resolvePathValue(value, defaultDataDir)
}

export const targetRoot = resolveTargetRoot()
export const dataDir = resolveDataDir()
export const targetName = path.basename(targetRoot)

/**
 * Agents write diffs against repo-relative paths, so a target that lives inside
 * this repo carries a prefix that has to be stripped to reach a scan file id.
 * Targets outside the repo have no such prefix.
 */
export function resolveTargetPathPrefix(root = targetRoot) {
  const override = process.env.VISUAL_CODER_TARGET_PREFIX?.trim()
  if (override) return override.endsWith('/') ? override : `${override}/`

  const relative = path.relative(repoRoot, root)
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return null
  return `${relative.split(path.sep).join('/')}/`
}

export const targetPathPrefix = resolveTargetPathPrefix()
