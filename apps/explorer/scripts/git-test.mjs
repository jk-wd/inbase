import fs from 'node:fs'
import path from 'node:path'

/** Create a git repo without `.git/hooks`, which some sandboxes block. */
export function initGitRepo(dir) {
  const gitDir = path.join(dir, '.git')
  fs.mkdirSync(path.join(gitDir, 'objects', 'info'), { recursive: true })
  fs.mkdirSync(path.join(gitDir, 'refs', 'heads'), { recursive: true })
  fs.writeFileSync(path.join(gitDir, 'HEAD'), 'ref: refs/heads/main\n')
  fs.writeFileSync(
    path.join(gitDir, 'config'),
    `[core]
	repositoryformatversion = 0
	filemode = true
	bare = false
	logallrefupdates = true
	hooksPath = /dev/null
[user]
	name = Visualizer Test
	email = visualizer-test@example.com
[commit]
	gpgsign = false
`,
  )
}
