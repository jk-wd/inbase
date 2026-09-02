import fs from 'node:fs'
import path from 'node:path'

export const CONFIG_FILE_NAME = 'inbase.json'

export const DEFAULT_PORT = 5173

export const INIT_INBASE_CONFIG = {
  target: '.',
  port: DEFAULT_PORT,
  ignore: [],
  stepByStep: false,
}

const KNOWN_KEYS = new Set(['target', 'port', 'ignore', 'stepByStep'])

function emptyConfig(dir = null, file = null) {
  return {
    file,
    dir,
    target: null,
    port: null,
    ignore: [],
    stepByStep: null,
  }
}

function isFile(file) {
  try {
    return fs.statSync(file).isFile()
  } catch {
    return false
  }
}

function hasGit(dir) {
  try {
    return fs.existsSync(path.join(dir, '.git'))
  } catch {
    return false
  }
}

/** Absolute path of `inbase.json`, walking up to the git root (inclusive). */
export function findInbaseConfigFile(startDir = process.cwd()) {
  let dir = path.resolve(startDir)
  for (;;) {
    const candidate = path.join(dir, CONFIG_FILE_NAME)
    if (isFile(candidate)) return candidate
    if (hasGit(dir)) return null
    const parent = path.dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
}

export function resolveConfigPath(value, configDir) {
  const raw = typeof value === 'string' ? value.trim() : ''
  if (!raw) return null
  return path.isAbsolute(raw) ? path.normalize(raw) : path.resolve(configDir, raw)
}

function configError(file, message) {
  return new Error(`${CONFIG_FILE_NAME}${file ? ` (${file})` : ''}: ${message}`)
}

export function parseInbaseConfig(raw, file = null) {
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw configError(file, 'is not valid JSON')
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw configError(file, 'must be a JSON object')
  }

  for (const key of Object.keys(parsed)) {
    if (!KNOWN_KEYS.has(key)) {
      console.warn(`${CONFIG_FILE_NAME}${file ? ` (${file})` : ''}: ignoring unknown setting "${key}"`)
    }
  }

  const config = emptyConfig(file ? path.dirname(path.resolve(file)) : null, file)

  if (parsed.target != null) {
    if (typeof parsed.target !== 'string' || !parsed.target.trim()) {
      throw configError(file, '"target" must be a non-empty string')
    }
    config.target = parsed.target.trim()
  }

  if (parsed.port != null) {
    if (!Number.isInteger(parsed.port)) {
      throw configError(file, '"port" must be an integer')
    }
    config.port = parsed.port
  }

  if (parsed.ignore != null) {
    if (
      !Array.isArray(parsed.ignore) ||
      parsed.ignore.some((pattern) => typeof pattern !== 'string')
    ) {
      throw configError(file, '"ignore" must be an array of strings')
    }
    config.ignore = parsed.ignore.map((pattern) => pattern.trim()).filter(Boolean)
  }

  if (parsed.stepByStep != null) {
    if (typeof parsed.stepByStep !== 'boolean') {
      throw configError(file, '"stepByStep" must be a boolean')
    }
    config.stepByStep = parsed.stepByStep
  }

  return config
}

export function parseInbaseConfigFile(file) {
  const resolved = path.resolve(file)
  return parseInbaseConfig(fs.readFileSync(resolved, 'utf8'), resolved)
}

export function loadInbaseConfig(startDir) {
  if (startDir === undefined) {
    const fromEnv = process.env.INBASE_CONFIG?.trim()
    if (fromEnv) {
      if (!isFile(fromEnv)) {
        throw configError(fromEnv, 'file from INBASE_CONFIG was not found')
      }
      return parseInbaseConfigFile(fromEnv)
    }
  }
  const from = startDir ?? process.cwd()
  const file = findInbaseConfigFile(from)
  if (!file) return emptyConfig(path.resolve(from))
  return parseInbaseConfigFile(file)
}

/** Pin this config file for scan and session child processes. */
export function rememberInbaseConfig(config) {
  if (config?.file) process.env.INBASE_CONFIG = config.file
  return config
}

export function resolvePort(cliValue, config = emptyConfig()) {
  if (cliValue != null && cliValue !== '') {
    const port = Number(cliValue)
    if (!Number.isInteger(port)) {
      throw new Error('inbase run --port must be an integer')
    }
    return port
  }
  return config.port ?? DEFAULT_PORT
}

export function writeInbaseConfig(projectRoot, values = INIT_INBASE_CONFIG) {
  const dest = path.join(path.resolve(projectRoot), CONFIG_FILE_NAME)
  if (fs.existsSync(dest)) return false
  fs.writeFileSync(dest, `${JSON.stringify(values, null, 2)}\n`)
  return true
}
