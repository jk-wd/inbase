import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const GIT_IDENTITY = [
  '-c',
  'core.hooksPath=/dev/null',
  '-c',
  'commit.gpgsign=false',
  '-c',
  'user.name=Visualizer Test',
  '-c',
  'user.email=visualizer-test@example.com',
]

/** Create a git repo without `.git/hooks` or `.git/config`, which some sandboxes block. */
export function initGitRepo(dir) {
  const gitDir = path.join(dir, '.git')
  fs.mkdirSync(path.join(gitDir, 'objects', 'info'), { recursive: true })
  fs.mkdirSync(path.join(gitDir, 'objects', 'pack'), { recursive: true })
  fs.mkdirSync(path.join(gitDir, 'refs', 'heads'), { recursive: true })
  fs.mkdirSync(path.join(gitDir, 'refs', 'tags'), { recursive: true })
  fs.writeFileSync(path.join(gitDir, 'HEAD'), 'ref: refs/heads/main\n')
}

export function gitTestEnv() {
  return {
    ...process.env,
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_SYSTEM: '/dev/null',
    GIT_AUTHOR_NAME: 'Visualizer Test',
    GIT_AUTHOR_EMAIL: 'visualizer-test@example.com',
    GIT_COMMITTER_NAME: 'Visualizer Test',
    GIT_COMMITTER_EMAIL: 'visualizer-test@example.com',
  }
}

export function runGit(cwd, args) {
  const result = spawnSync('git', [...GIT_IDENTITY, ...args], {
    cwd,
    encoding: 'utf8',
    env: gitTestEnv(),
  })
  assert.equal(result.status, 0, result.stderr || result.stdout)
  return result
}
