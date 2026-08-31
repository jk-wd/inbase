import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
export const packageRoot = path.resolve(here, '..')
export const explorerRoot = path.join(packageRoot, 'apps/explorer')
export const skillTemplateDir = path.join(packageRoot, 'skill/inbase')
export const commandTemplateDir = path.join(packageRoot, 'skill/commands')

const requireFromPackage = createRequire(path.join(packageRoot, 'package.json'))

export function resolveFromPackage(specifier) {
  return requireFromPackage.resolve(specifier)
}

export function packageDirFromPackage(name) {
  let dir = path.dirname(resolveFromPackage(name))
  while (dir !== path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, 'package.json'))) return dir
    dir = path.dirname(dir)
  }
  return dir
}

/** Vite config that never uses the host project's cache, deps, or browser targets. */
export function isolatedViteConfig(dataDir) {
  return {
    root: explorerRoot,
    envDir: explorerRoot,
    cacheDir: path.join(dataDir, 'vite'),
    publicDir: false,
    appType: 'spa',
    build: { target: 'esnext' },
    esbuild: { target: 'esnext' },
    optimizeDeps: {
      entries: [path.join(explorerRoot, 'index.html')],
      esbuildOptions: { target: 'esnext' },
    },
    server: {
      fs: {
        strict: true,
        allow: [explorerRoot, packageRoot, dataDir],
      },
    },
  }
}

export function resolveOptionalPath(value, fallback) {
  const raw = value?.trim()
  if (!raw) return fallback
  return path.isAbsolute(raw) ? path.normalize(raw) : path.resolve(process.cwd(), raw)
}

export const INSTANCE_FILE = 'instance.json'

export function isPidAlive(pid) {
  if (!Number.isInteger(pid)) return true
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    // Cursor's agent sandbox cannot signal other processes (EPERM) even when
    // they are alive. POSIX EPERM means the pid exists; only ESRCH is gone.
    return error?.code === 'EPERM'
  }
}

export function instanceFile(dataDir) {
  return path.join(dataDir, INSTANCE_FILE)
}

export function writeRunningInstance({ dataDir, targetRoot, port = null }) {
  fs.mkdirSync(dataDir, { recursive: true })
  const instance = {
    dataDir: path.resolve(dataDir),
    targetRoot: path.resolve(targetRoot),
    port: port ?? null,
    pid: process.pid,
    updatedAt: new Date().toISOString(),
  }
  fs.writeFileSync(instanceFile(dataDir), `${JSON.stringify(instance, null, 2)}\n`)
  return instance
}

export function readInstanceFile(file) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (!parsed?.dataDir || !parsed?.targetRoot) return null
    if (!isPidAlive(parsed.pid)) return null
    return parsed
  } catch {
    return null
  }
}

export function readRunningInstance(cwd = process.cwd()) {
  const files = [
    path.join(cwd, '.inbase', INSTANCE_FILE),
    path.join(explorerRoot, 'src/data', INSTANCE_FILE),
  ]
  const seen = new Set()
  for (const file of files) {
    const resolved = path.resolve(file)
    if (seen.has(resolved) || !fs.existsSync(resolved)) continue
    seen.add(resolved)
    const instance = readInstanceFile(resolved)
    if (instance) return instance
  }
  return null
}

export function applyHostEnv({
  cwd = process.cwd(),
  target = process.env.VISUAL_CODER_TARGET,
  dataDir = process.env.INBASE_DATA_DIR,
} = {}) {
  const running = !target && !dataDir ? readRunningInstance(cwd) : null
  const targetRoot = resolveOptionalPath(target, running?.targetRoot ?? cwd)
  const resolvedDataDir = resolveOptionalPath(
    dataDir,
    running?.dataDir ?? path.join(targetRoot, '.inbase'),
  )
  process.env.VISUAL_CODER_TARGET = targetRoot
  process.env.INBASE_DATA_DIR = resolvedDataDir
  return { cwd, targetRoot, dataDir: resolvedDataDir, instance: running }
}

export function ensureDataDir(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true })
  const userContextFile = path.join(dataDir, 'user-context.json')
  if (!fs.existsSync(userContextFile)) {
    fs.writeFileSync(
      userContextFile,
      `${JSON.stringify({ showBranchChanges: false }, null, 2)}\n`,
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
