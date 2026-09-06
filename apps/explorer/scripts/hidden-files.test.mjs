import assert from 'node:assert/strict'
import test from 'node:test'
import {
  filterGraphHiddenFiles,
  isHiddenPath,
} from '../src/hidden-files.ts'

test('treats dotfiles and hidden directories as hidden', () => {
  assert.equal(isHiddenPath('.env'), true)
  assert.equal(isHiddenPath('.github/workflows/ci.yml'), true)
  assert.equal(isHiddenPath('src/.gitignore'), true)
  assert.equal(isHiddenPath('src/app.ts'), false)
  assert.equal(isHiddenPath('.'), false)
})

test('hides hidden files and empty hidden folders, keeps user-created items', () => {
  const graph = {
    root: '/tmp/app',
    targetName: 'app',
    files: [
      {
        id: 'src/app.ts',
        name: 'app.ts',
        path: 'src/app.ts',
        folder: 'src',
        lines: 2,
        language: 'ts',
        symbols: [],
        imports: [],
      },
      {
        id: '.env',
        name: '.env',
        path: '.env',
        folder: '.',
        lines: 1,
        language: 'txt',
        symbols: [],
        imports: [],
      },
      {
        id: '.github/workflows/ci.yml',
        name: 'ci.yml',
        path: '.github/workflows/ci.yml',
        folder: '.github/workflows',
        lines: 1,
        language: 'yml',
        symbols: [],
        imports: [],
      },
      {
        id: 'src/.gitignore',
        name: '.gitignore',
        path: 'src/.gitignore',
        folder: 'src',
        lines: 1,
        language: 'txt',
        symbols: [],
        imports: [],
      },
      {
        id: '.env.local',
        name: '.env.local',
        path: '.env.local',
        folder: '.',
        lines: 1,
        language: 'txt',
        symbols: [],
        imports: [],
        userCreated: true,
      },
    ],
    folders: [
      {
        path: '.',
        name: 'app',
        parent: null,
        files: ['.env', '.env.local'],
        children: ['.github', '.secret', 'src'],
      },
      {
        path: 'src',
        name: 'src',
        parent: '.',
        files: ['src/app.ts', 'src/.gitignore'],
        children: [],
      },
      {
        path: '.github',
        name: '.github',
        parent: '.',
        files: [],
        children: ['.github/workflows'],
      },
      {
        path: '.github/workflows',
        name: 'workflows',
        parent: '.github',
        files: ['.github/workflows/ci.yml'],
        children: [],
      },
      {
        path: '.secret',
        name: '.secret',
        parent: '.',
        files: [],
        children: [],
        userCreated: true,
      },
    ],
  }

  const visible = filterGraphHiddenFiles(graph)
  assert.deepEqual(
    visible.files.map((file) => file.id).sort(),
    ['.env.local', 'src/app.ts'],
  )
  assert.deepEqual(
    visible.folders.map((folder) => folder.path).sort(),
    ['.', '.secret', 'src'],
  )
  const root = visible.folders.find((folder) => folder.path === '.')
  assert.deepEqual(root.files.sort(), ['.env.local'])
  assert.deepEqual(root.children.sort(), ['.secret', 'src'])
  const src = visible.folders.find((folder) => folder.path === 'src')
  assert.deepEqual(src.files, ['src/app.ts'])
})
