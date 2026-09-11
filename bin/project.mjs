import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import {
  loadInbaseConfig,
  rememberInbaseConfig,
  resolveConfigPath,
} from './inbase-config.mjs'

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

export function globalInbaseDir() {
  const override = process.env.INBASE_HOME?.trim()
  if (override) return path.resolve(override)
  return path.join(os.homedir(), '.inbase')
}

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

export function writeRunningInstance({
  dataDir,
  targetRoot,
  port = null,
  pid = process.pid,
  extraDirs = [],
}) {
  const instance = {
    dataDir: path.resolve(dataDir),
    targetRoot: path.resolve(targetRoot),
    port: port ?? null,
    pid,
    updatedAt: new Date().toISOString(),
  }
  const dirs = [path.resolve(dataDir), ...extraDirs]
  const seen = new Set()
  for (const dir of dirs) {
    const resolved = path.resolve(dir)
    if (seen.has(resolved)) continue
    seen.add(resolved)
    fs.mkdirSync(resolved, { recursive: true })
    fs.writeFileSync(instanceFile(resolved), `${JSON.stringify(instance, null, 2)}\n`)
  }
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
    path.join(globalInbaseDir(), INSTANCE_FILE),
    path.join(packageRoot, 'inbase-dev', INSTANCE_FILE),
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

export function visualizerOrigin(port) {
  return `http://127.0.0.1:${Number(port) || 5173}`
}

export async function probeVisualizer(port, timeoutMs = 800) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(`${visualizerOrigin(port)}/api/dev-targets`, {
      signal: controller.signal,
    })
    return response.ok
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}

export async function findLiveVisualizer(cwd = process.cwd(), portHint = null) {
  const running = readRunningInstance(cwd)
  const ports = []
  const hinted = Number(portHint)
  if (running?.port) ports.push(running.port)
  if (Number.isInteger(hinted) && hinted > 0 && !ports.includes(hinted)) {
    ports.push(hinted)
  }
  for (const port of ports) {
    if (!(await probeVisualizer(port))) continue
    return {
      dataDir: running?.dataDir ?? null,
      targetRoot: running?.targetRoot ?? null,
      pid: running?.pid ?? null,
      port,
    }
  }
  return null
}

export function applyHostEnv({
  cwd = process.cwd(),
  target = process.env.VISUAL_CODER_TARGET,
  dataDir = process.env.INBASE_DATA_DIR,
} = {}) {
  const config = rememberInbaseConfig(loadInbaseConfig(cwd))
  const explicitTarget = typeof target === 'string' && target.trim() ? target.trim() : ''
  const discovered = !explicitTarget && !dataDir ? readRunningInstance(cwd) : null
  const configTargetRoot =
    config.target && config.dir ? resolveConfigPath(config.target, config.dir) : null
  const localInstance = readInstanceFile(path.join(path.resolve(cwd), '.inbase', INSTANCE_FILE))
  const discoveredIsLocal =
    Boolean(discovered && localInstance) &&
    path.resolve(localInstance.dataDir) === path.resolve(discovered.dataDir)
  // Prefer a cwd/.inbase map, or a global map that matches this inbase.json.
  // A live map for another project must not override this kickoff's config.
  const running =
    discovered &&
    (discoveredIsLocal ||
      !configTargetRoot ||
      path.resolve(discovered.targetRoot) === path.resolve(configTargetRoot))
      ? discovered
      : null
  const targetRoot = resolveOptionalPath(
    explicitTarget || null,
    running?.targetRoot ?? configTargetRoot ?? cwd,
  )
  const kickoffDir = config.dir ?? path.resolve(cwd)
  const defaultDataDir = explicitTarget
    ? path.join(targetRoot, '.inbase')
    : path.join(kickoffDir, '.inbase')
  const resolvedDataDir = resolveOptionalPath(
    dataDir,
    running?.dataDir ?? defaultDataDir,
  )
  process.env.VISUAL_CODER_TARGET = targetRoot
  process.env.INBASE_DATA_DIR = resolvedDataDir
  return { cwd, targetRoot, dataDir: resolvedDataDir, instance: running, config }
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
  let current = ''
  try {
    current = fs.readFileSync(gitignore, 'utf8')
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
    // Append creates the file and never truncates an existing one.
    fs.appendFileSync(gitignore, line)
    return true
  }
  const hasEntry = current
    .split(/\r?\n/)
    .some((row) => row.trim() === entry || row.trim() === entry.replace(/\/$/, ''))
  if (hasEntry) return false
  const prefix = current.endsWith('\n') || current === '' ? '' : '\n'
  fs.appendFileSync(gitignore, `${prefix}${line}`)
  return true
}

export function removeGitignoreEntry(projectRoot, entry = '.inbase/') {
  const gitignore = path.join(projectRoot, '.gitignore')
  if (!fs.existsSync(gitignore)) return false
  const aliases = new Set([entry, entry.replace(/\/$/, '')].filter(Boolean))
  const lines = fs.readFileSync(gitignore, 'utf8').split(/\r?\n/)
  const kept = lines.filter((row) => !aliases.has(row.trim()))
  if (kept.length === lines.length) return false
  while (kept.length > 0 && kept.at(-1) === '') kept.pop()
  if (kept.length === 0) {
    fs.unlinkSync(gitignore)
    return true
  }
  fs.writeFileSync(gitignore, `${kept.join('\n')}\n`)
  return true
}

/** Remove empty directories from `startDir` up to, but not including, `stopDir`. */
export function removeEmptyParents(startDir, stopDir) {
  const stop = path.resolve(stopDir)
  let dir = path.resolve(startDir)
  while (dir !== stop && dir.startsWith(`${stop}${path.sep}`)) {
    if (!fs.existsSync(dir)) {
      dir = path.dirname(dir)
      continue
    }
    if (fs.readdirSync(dir).length > 0) break
    fs.rmdirSync(dir)
    dir = path.dirname(dir)
  }
}
