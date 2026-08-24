import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const command = path.basename(process.argv[1], '.mjs')
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..')
const result = spawnSync(
  process.execPath,
  [path.join(repoRoot, 'bin/inbase.mjs'), command, ...process.argv.slice(2)],
  { stdio: 'inherit' },
)
process.exit(result.status ?? 1)
