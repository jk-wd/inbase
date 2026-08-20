import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
export const packageRoot = path.resolve(here, '..')
export const explorerRoot = path.join(packageRoot, 'apps/explorer')
export const skillTemplateDir = path.join(packageRoot, 'skill/inbase')

export function resolveOptionalPath(value, fallback) {
  const raw = value?.trim()
  if (!raw) return fallback
  return path.isAbsolute(raw) ? path.normalize(raw) : path.resolve(process.cwd(), raw)
}

export function applyHostEnv({
  cwd = process.cwd(),
  target = process.env.VISUAL_CODER_TARGET,
  dataDir = process.env.INBASE_DATA_DIR,
} = {}) {
  const targetRoot = resolveOptionalPath(target, cwd)
  const resolvedDataDir = resolveOptionalPath(
    dataDir,
    path.join(targetRoot, '.inbase'),
  )
  process.env.VISUAL_CODER_TARGET = targetRoot
  process.env.INBASE_DATA_DIR = resolvedDataDir
  return { cwd, targetRoot, dataDir: resolvedDataDir }
}

export function ensureDataDir(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true })
  const userContextFile = path.join(dataDir, 'user-context.json')
  if (!fs.existsSync(userContextFile)) {
    fs.writeFileSync(
      userContextFile,
      `${JSON.stringify({ followLook: false }, null, 2)}\n`,
    )
  }
  return dataDir
}

export function takeFlagValue(args, flag) {
  const index = args.indexOf(flag)
  return index >= 0 ? args[index + 1] : null
}

export function takeFlagValues(args, flag) {
  const values = []
  const rest = []
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === flag && args[index + 1]) {
      values.push(args[index + 1])
      index += 1
    } else {
      rest.push(args[index])
    }
  }
  return { values, rest }
}

export function withoutFlag(args, flag) {
  return args.filter((arg) => arg !== flag)
}

export function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true })
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const source = path.join(from, entry.name)
    const dest = path.join(to, entry.name)
    if (entry.isDirectory()) {
      copyDir(source, dest)
      continue
    }
    fs.copyFileSync(source, dest)
  }
}

export function ensureGitignoreEntry(projectRoot, entry = '.inbase/') {
  const gitignore = path.join(projectRoot, '.gitignore')
  const line = entry.endsWith('\n') ? entry : `${entry}\n`
  if (!fs.existsSync(gitignore)) {
    fs.writeFileSync(gitignore, line)
    return true
  }
  const current = fs.readFileSync(gitignore, 'utf8')
  const hasEntry = current
    .split(/\r?\n/)
    .some((row) => row.trim() === entry || row.trim() === entry.replace(/\/$/, ''))
  if (hasEntry) return false
  const prefix = current.endsWith('\n') || current === '' ? '' : '\n'
  fs.appendFileSync(gitignore, `${prefix}${line}`)
  return true
}
