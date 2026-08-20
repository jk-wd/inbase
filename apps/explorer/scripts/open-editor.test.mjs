import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  cursorUserDataDirForFile,
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
