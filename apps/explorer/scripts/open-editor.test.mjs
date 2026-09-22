import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  configuredEditorId,
  cursorUserDataDirForFile,
  editorFileUri,
  openFoldersFromStorage,
} from './open-editor.mjs'
import { pathToFileURL } from 'node:url'

test('reads currently opened folders from Cursor window state', () => {
  const folders = openFoldersFromStorage({
    windowsState: {
      lastActiveWindow: { folder: pathToFileURL('/Users/me/Projects/inbase').href },
      openedWindows: [
        { folder: pathToFileURL('/Users/me/Projects/other').href },
        { folder: pathToFileURL('/Users/me/Projects/inbase').href },
      ],
    },
  })
  assert.deepEqual(folders, [
    '/Users/me/Projects/inbase',
    '/Users/me/Projects/other',
    '/Users/me/Projects/inbase',
  ])
})

test('picks the Cursor profile that currently has the file workspace open', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cursor-profile-'))
  const workspace = path.join(root, 'inbase')
  const filePath = path.join(workspace, 'apps/example-target/src/a.ts')
  const profileDir = path.join(root, 'cursor-profile-2')
  fs.mkdirSync(path.join(profileDir, 'User/globalStorage'), { recursive: true })
  fs.writeFileSync(
    path.join(profileDir, 'User/globalStorage/storage.json'),
    JSON.stringify({
      windowsState: {
        lastActiveWindow: { folder: pathToFileURL(workspace).href },
        openedWindows: [{ folder: pathToFileURL(workspace).href }],
      },
    }),
  )

  const previousHome = process.env.HOME
  const previousOverride = process.env.INBASE_CURSOR_USER_DATA_DIR
  const previousHook = process.env.VSCODE_IPC_HOOK
  try {
    process.env.HOME = root
    delete process.env.INBASE_CURSOR_USER_DATA_DIR
    delete process.env.VSCODE_IPC_HOOK
    const chosen = cursorUserDataDirForFile(filePath)
    assert.equal(chosen, profileDir)
  } finally {
    if (previousHome === undefined) delete process.env.HOME
    else process.env.HOME = previousHome
    if (previousOverride === undefined) delete process.env.INBASE_CURSOR_USER_DATA_DIR
    else process.env.INBASE_CURSOR_USER_DATA_DIR = previousOverride
    if (previousHook === undefined) delete process.env.VSCODE_IPC_HOOK
    else process.env.VSCODE_IPC_HOOK = previousHook
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('file URIs follow the configured editor', () => {
  const filePath = '/Users/me/Projects/inbase/src/a.ts'
  assert.equal(editorFileUri(filePath, 'cursor'), `vscode://file${encodeURI(filePath)}`)
  assert.equal(editorFileUri(filePath, 'zed'), `zed://file${encodeURI(filePath)}`)
  assert.equal(editorFileUri(filePath, 'copilot'), `vscode://file${encodeURI(filePath)}`)
  assert.equal(editorFileUri(filePath, 'cline'), `vscode://file${encodeURI(filePath)}`)
})

test('INBASE_EDITOR selects the open-file editor', () => {
  const previous = process.env.INBASE_EDITOR
  try {
    process.env.INBASE_EDITOR = 'zed'
    assert.equal(configuredEditorId(), 'zed')
    process.env.INBASE_EDITOR = 'github-copilot'
    assert.equal(configuredEditorId(), 'copilot')
    assert.equal(configuredEditorId('cline'), 'cline')
  } finally {
    if (previous === undefined) delete process.env.INBASE_EDITOR
    else process.env.INBASE_EDITOR = previous
  }
})
