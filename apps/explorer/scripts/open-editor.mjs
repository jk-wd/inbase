import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadInbaseConfig } from '../../../bin/inbase-config.mjs'
import {
  canonicalEditorId,
  editorOpenFileKind,
} from '../../../bin/editors/index.mjs'

export function configuredEditorId(editorId) {
  if (editorId != null && String(editorId).trim()) {
    return canonicalEditorId(editorId) ?? String(editorId).trim().toLowerCase()
  }
  const fromEnv = process.env.INBASE_EDITOR?.trim()
  if (fromEnv) return canonicalEditorId(fromEnv) ?? fromEnv.toLowerCase()
  try {
    return loadInbaseConfig().editor
  } catch {
    return null
  }
}

export function editorFileUri(filePath, editorId) {
  const kind = editorOpenFileKind(configuredEditorId(editorId))
  if (kind === 'zed') return `zed://file${encodeURI(filePath)}`
  return `vscode://file${encodeURI(filePath)}`
}

function which(command) {
  const result = spawnSync('which', [command], { encoding: 'utf8' })
  if (result.error || result.status !== 0) return null
  return result.stdout.trim().split('\n')[0] || null
}

export function defaultCursorUserDataDir() {
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library/Application Support/Cursor')
  }
  if (process.platform === 'win32') {
    return path.join(os.homedir(), 'AppData/Roaming/Cursor')
  }
  return path.join(os.homedir(), '.config/Cursor')
}

function expandUser(value) {
  if (!value) return null
  const trimmed = String(value).trim().replace(/^['"]|['"]$/g, '')
  if (!trimmed) return null
  if (trimmed.startsWith('~')) {
    return path.resolve(os.homedir() + trimmed.slice(1))
  }
  return path.resolve(trimmed)
}

function isCursorUserDataDir(dir) {
  try {
    if (fs.existsSync(path.join(dir, 'User/globalStorage/storage.json'))) return true
    return fs.readdirSync(dir).some((name) => name.endsWith('-main.sock'))
  } catch {
    return false
  }
}

function userDataDirFromHook(hook = process.env.VSCODE_IPC_HOOK) {
  if (!hook || !hook.endsWith('.sock')) return null
  const dir = path.dirname(hook)
  return isCursorUserDataDir(dir) ? dir : null
}

function userDataDirsFromProcessList() {
  const result = spawnSync('ps', ['-ax', '-o', 'command='], { encoding: 'utf8' })
  if (result.error || result.status !== 0) return []
  const dirs = []
  for (const line of result.stdout.split('\n')) {
    const match = line.match(/--user-data-dir(?:=|\s+)(\S+)/)
    if (!match) continue
    const dir = expandUser(match[1])
    if (dir && isCursorUserDataDir(dir)) dirs.push(dir)
  }
  return dirs
}

function profileDirsInHome() {
  let names = []
  try {
    names = fs.readdirSync(os.homedir())
  } catch {
    return []
  }
  return names
    .filter((name) => name.startsWith('cursor-profile'))
    .map((name) => path.join(os.homedir(), name))
    .filter(isCursorUserDataDir)
}

export function discoverCursorUserDataDirs() {
  const dirs = new Set()
  const explicit = expandUser(
    process.env.INBASE_CURSOR_USER_DATA_DIR || process.env.CURSOR_USER_DATA_DIR,
  )
  if (explicit && isCursorUserDataDir(explicit)) dirs.add(explicit)
  const hookDir = userDataDirFromHook()
  if (hookDir) dirs.add(hookDir)
  const def = defaultCursorUserDataDir()
  if (isCursorUserDataDir(def)) dirs.add(def)
  for (const dir of profileDirsInHome()) dirs.add(dir)
  for (const dir of userDataDirsFromProcessList()) dirs.add(dir)
  return [...dirs]
}

function folderPathFromUri(value) {
  if (typeof value !== 'string' || !value) return null
  try {
    return value.startsWith('file:') ? fileURLToPath(value) : path.resolve(value)
  } catch {
    return null
  }
}

function fileIsInside(folder, filePath) {
  const root = path.resolve(folder)
  const file = path.resolve(filePath)
  return file === root || file.startsWith(`${root}${path.sep}`)
}

export function openFoldersFromStorage(storage) {
  const state = storage?.windowsState
  if (!state || typeof state !== 'object') return []
  const windows = [
    state.lastActiveWindow,
    ...(Array.isArray(state.openedWindows) ? state.openedWindows : []),
  ]
  const folders = []
  for (const window of windows) {
    const folder = folderPathFromUri(window?.folder)
    if (folder) folders.push(folder)
  }
  return folders
}

function readOpenFolders(userDataDir) {
  const file = path.join(userDataDir, 'User/globalStorage/storage.json')
  try {
    return openFoldersFromStorage(JSON.parse(fs.readFileSync(file, 'utf8')))
  } catch {
    return []
  }
}

function lastActiveFolder(userDataDir) {
  const file = path.join(userDataDir, 'User/globalStorage/storage.json')
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'))
    return folderPathFromUri(parsed?.windowsState?.lastActiveWindow?.folder)
  } catch {
    return null
  }
}

export function cursorUserDataDirForFile(filePath) {
  const explicit = expandUser(
    process.env.INBASE_CURSOR_USER_DATA_DIR || process.env.CURSOR_USER_DATA_DIR,
  )
  if (explicit && isCursorUserDataDir(explicit)) return explicit

  const hookDir = userDataDirFromHook()
  let best = null
  let bestScore = 0
  for (const dir of discoverCursorUserDataDirs()) {
    const folders = readOpenFolders(dir)
    if (!folders.some((folder) => fileIsInside(folder, filePath))) continue
    let score = 1
    if (hookDir && path.resolve(hookDir) === path.resolve(dir)) score += 2
    const last = lastActiveFolder(dir)
    if (last && fileIsInside(last, filePath)) score += 2
    if (score > bestScore) {
      best = dir
      bestScore = score
    }
  }
  return best ?? hookDir
}

function uniqueCommands(candidates) {
  return candidates.filter((candidate, index, list) => {
    if (!candidate || typeof candidate !== 'string') return false
    return list.indexOf(candidate) === index
  })
}

function cursorCliPaths() {
  const home = os.homedir()
  const fromEnv =
    process.env.CURSOR_CLI && fs.existsSync(process.env.CURSOR_CLI)
      ? process.env.CURSOR_CLI
      : null
  return uniqueCommands([
    fromEnv,
    which('cursor'),
    '/Applications/Cursor.app/Contents/Resources/app/bin/cursor',
    path.join(home, '.local/bin/cursor'),
    '/usr/local/bin/cursor',
    '/opt/homebrew/bin/cursor',
  ])
}

function zedCliPaths() {
  const home = os.homedir()
  const fromEnv =
    process.env.ZED_CLI && fs.existsSync(process.env.ZED_CLI)
      ? process.env.ZED_CLI
      : null
  return uniqueCommands([
    fromEnv,
    which('zed'),
    '/Applications/Zed.app/Contents/MacOS/cli',
    path.join(home, '.local/bin/zed'),
    '/usr/local/bin/zed',
    '/opt/homebrew/bin/zed',
  ])
}

function vscodeCliPaths() {
  const home = os.homedir()
  const fromEnv =
    process.env.CODE_CLI && fs.existsSync(process.env.CODE_CLI)
      ? process.env.CODE_CLI
      : null
  return uniqueCommands([
    fromEnv,
    which('code'),
    which('code-insiders'),
    '/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code',
    '/Applications/Visual Studio Code - Insiders.app/Contents/Resources/app/bin/code',
    path.join(home, '.local/bin/code'),
    '/usr/local/bin/code',
    '/opt/homebrew/bin/code',
  ])
}

function editorEnv() {
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  delete env.ELECTRON_NO_ASAR
  delete env.CURSOR_AGENT
  // A second Cursor instance uses its own sockets. Inherited hooks from
  // another profile would send --goto to the wrong window.
  delete env.VSCODE_IPC_HOOK
  delete env.VSCODE_IPC_HOOK_CLI
  return env
}

function runEditor(command, args) {
  if (command.includes(path.sep) && !fs.existsSync(command)) return false
  const result = spawnSync(command, args, {
    stdio: 'ignore',
    env: editorEnv(),
  })
  return !result.error && result.status === 0
}

function openInCursor(filePath) {
  const userDataDir = cursorUserDataDirForFile(filePath)
  const goto = ['--goto', `${filePath}:1`]
  if (userDataDir) {
    goto.unshift('--user-data-dir', userDataDir)
  }
  for (const command of cursorCliPaths()) {
    if (runEditor(command, goto)) return true
  }
  return openInVsCode(filePath)
}

function openInZed(filePath) {
  const location = `${filePath}:1:1`
  for (const command of zedCliPaths()) {
    if (runEditor(command, ['-a', location])) return true
  }
  for (const command of zedCliPaths()) {
    if (runEditor(command, [location])) return true
  }
  if (process.platform === 'darwin' && runEditor('open', ['-a', 'Zed', filePath])) {
    return true
  }
  return false
}

function openInVsCode(filePath) {
  const goto = ['--goto', `${filePath}:1`]
  for (const command of vscodeCliPaths()) {
    if (runEditor(command, goto)) return true
  }
  return false
}

export function openInEditor(filePath, editorId) {
  const id = configuredEditorId(editorId)
  const kind = editorOpenFileKind(id)
  if (kind === 'zed') return openInZed(filePath)
  if (kind === 'vscode') return openInVsCode(filePath)
  if (kind === 'cursor') return openInCursor(filePath)
  if (!id) return openInCursor(filePath)
  return false
}
