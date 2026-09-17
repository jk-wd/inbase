import fs from 'node:fs'
import path from 'node:path'
import { removeEmptyParents } from '../project.mjs'
import { stripYamlFrontmatter } from './cline.mjs'
import {
  copySkillAndCommands,
  looksLikeInbaseFile,
  removeManagedFile,
  removeSkillAndCommands,
} from './layout.mjs'

export const id = 'opencode'
export const label = 'OpenCode'

const LAYOUT = {
  id,
  skillRel: '.opencode/skills/inbase',
  commandRel: '.opencode/commands',
}

/** Auto-approve Inbase CLI in OpenCode's bash tool. */
export const OPENCODE_INBASE_BASH_PATTERN = 'npx inbase*'

/** Auto-approve loading the Inbase skill. */
export const OPENCODE_INBASE_SKILL = 'inbase'

export const OPENCODE_INSTRUCTION_REL = '.opencode/instructions/inbase.md'

const OPENCODE_SCHEMA = 'https://opencode.ai/config.json'

const OPENCODE_PREAMBLE = `# Inbase visual edits (OpenCode)

This rule is **mandatory** for source-file changes inside the mapped target
from \`inbase.json\` (\`target\`; default \`.\`). Skip it for files outside that
folder, git, lockfiles, \`.inbase\`, editor skill folders, questions with no
code changes, or \`/extract-blueprint\`.

OpenCode must **load the \`inbase\` skill** and **run** \`npx inbase\` with the
bash tool. Do not paste \`npx inbase\` commands as chat text. Do not explore
the repo first.

On a new file-change request inside \`target\`, in this order:
1. Run \`npx inbase attach\` (or \`npx inbase attach --color COLOR\` if the user
   named a color). Stop if the output is \`VISUAL_CODER_NOT_RUNNING\`. If the
   files are outside \`target\`, do not attach; edit them as a normal task.
2. Reply: \`Connecting to the <color> session.\`
3. Run \`npx inbase read-blueprint --session COLOR\`
4. Reply: \`I see on the blueprint ...\` (name files, folders, symbols, notes)
5. MUST run \`npx inbase report-plan --session COLOR --feature "..." --steps "..."\`
   before any file edit. Listing steps in chat is not the plan.
6. Edit files only after \`VISUAL_CODER_EXECUTE\`. Never edit before
   \`report-plan\`. Then run
   \`npx inbase propose-patch --session COLOR\` with \`--note "path: one-line goal"\`
   for each changed file and folder. No patch file. If the
   next step is invoked, implement it now in the same turn. After the last
   recorded step, stop. The user clicks Done in the session window to keep
   the files and free the color.

If this chat already printed \`VISUAL_CODER_SESSION\`, skip attach. Stay in
that session. \`/stop\` runs \`npx inbase stop --session COLOR\`.

Slash commands \`/coral\`, \`/amber\`, \`/lime\`, \`/orange\`, \`/violet\`,
\`/teal\`, \`/crimson\`, \`/forest\`, \`/grey\`, \`/white\` (and aliases),
\`/explainit\`, \`/extract-blueprint\`, and \`/stop\` are project commands.
Follow them when the user invokes one.

COLOR is this chat's color from \`VISUAL_CODER_SESSION\` (\`coral\`, \`amber\`, …).

Follow the rest of this rule exactly.
`

export function install(projectRoot) {
  const installed = copySkillAndCommands(projectRoot, LAYOUT)
  const skillFile = path.join(installed.skillDir, 'SKILL.md')
  const skillMarkdown = fs.existsSync(skillFile)
    ? fs.readFileSync(skillFile, 'utf8')
    : ''
  writeOpencodeInstructions(projectRoot, skillMarkdown)
  installOpencodeConfig(projectRoot)
  return { ...installed, label }
}

export function uninstall(projectRoot) {
  const result = removeSkillAndCommands(projectRoot, LAYOUT)
  let removed = result.removed
  if (removeOpencodeInstructions(projectRoot)) removed = true
  if (uninstallOpencodeConfig(projectRoot)) removed = true
  removeEmptyParents(path.join(projectRoot, '.opencode/instructions'), projectRoot)
  removeEmptyParents(path.join(projectRoot, '.opencode'), projectRoot)
  return { ...result, removed, label }
}

function instructionFile(projectRoot) {
  return path.join(projectRoot, OPENCODE_INSTRUCTION_REL)
}

function writeOpencodeInstructions(projectRoot, skillMarkdown) {
  const body = stripYamlFrontmatter(skillMarkdown).trim()
  const text = `${OPENCODE_PREAMBLE.trim()}\n\n${body}\n`
  const file = instructionFile(projectRoot)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, text)
}

function removeOpencodeInstructions(projectRoot) {
  return removeManagedFile(instructionFile(projectRoot))
}

function opencodeConfigCandidates(projectRoot) {
  return [
    path.join(projectRoot, 'opencode.jsonc'),
    path.join(projectRoot, 'opencode.json'),
  ]
}

function existingOpencodeConfigFiles(projectRoot) {
  return opencodeConfigCandidates(projectRoot).filter((file) => fs.existsSync(file))
}

function parseJsoncFile(file) {
  if (!fs.existsSync(file)) return null
  const text = fs.readFileSync(file, 'utf8')
  try {
    return JSON.parse(text)
  } catch {
    const stripped = text
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')
      .replace(/,(\s*[}\]])/g, '$1')
    try {
      return JSON.parse(stripped)
    } catch {
      return null
    }
  }
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`)
}

function isOurInstruction(value) {
  const normalized = String(value ?? '')
    .trim()
    .replace(/^\.\//, '')
  return normalized === OPENCODE_INSTRUCTION_REL
}

function withInstruction(list) {
  const next = Array.isArray(list) ? [...list] : []
  if (!next.some(isOurInstruction)) next.push(OPENCODE_INSTRUCTION_REL)
  return next
}

function withoutInstruction(list) {
  if (!Array.isArray(list)) return list
  return list.filter((item) => !isOurInstruction(item))
}

function isPermissionMap(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function allowPattern(value, pattern) {
  if (value === 'allow') return value
  if (typeof value === 'string') {
    return { '*': value, [pattern]: 'allow' }
  }
  const next = isPermissionMap(value) ? { ...value } : {}
  next[pattern] = 'allow'
  return next
}

function withInbasePermissions(permission) {
  if (permission === 'allow') return permission
  if (typeof permission === 'string') {
    return {
      '*': permission,
      bash: { [OPENCODE_INBASE_BASH_PATTERN]: 'allow' },
      skill: { [OPENCODE_INBASE_SKILL]: 'allow' },
    }
  }
  if (permission != null && !isPermissionMap(permission)) return permission
  const next = isPermissionMap(permission) ? { ...permission } : {}
  next.bash = allowPattern(next.bash, OPENCODE_INBASE_BASH_PATTERN)
  next.skill = allowPattern(next.skill, OPENCODE_INBASE_SKILL)
  return next
}

function stripAllowPattern(value, pattern) {
  if (!isPermissionMap(value) || !(pattern in value)) return value
  const next = { ...value }
  delete next[pattern]
  const keys = Object.keys(next)
  if (keys.length === 0) return undefined
  if (keys.length === 1 && keys[0] === '*') return next['*']
  return next
}

function withoutInbasePermissions(permission) {
  if (!isPermissionMap(permission)) return permission
  const bash = stripAllowPattern(permission.bash, OPENCODE_INBASE_BASH_PATTERN)
  const skill = stripAllowPattern(permission.skill, OPENCODE_INBASE_SKILL)
  if (bash === permission.bash && skill === permission.skill) return permission
  const next = { ...permission }
  if (bash === undefined) delete next.bash
  else next.bash = bash
  if (skill === undefined) delete next.skill
  else next.skill = skill
  const keys = Object.keys(next)
  if (keys.length === 0) return undefined
  if (keys.length === 1 && keys[0] === '*') return next['*']
  return next
}

function isEmptyOpencodeConfig(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return true
  return Object.keys(data).every((key) => key === '$schema')
}

export function installOpencodeConfig(projectRoot) {
  const existing = existingOpencodeConfigFiles(projectRoot)
  const files = existing.length > 0 ? existing.slice(0, 1) : [path.join(projectRoot, 'opencode.json')]
  for (const file of files) {
    const existed = fs.existsSync(file)
    const data = existed ? parseJsoncFile(file) : {}
    if (existed && !data) continue
    const next = { ...data }
    if (!existed) next.$schema = OPENCODE_SCHEMA
    next.permission = withInbasePermissions(next.permission)
    next.instructions = withInstruction(next.instructions)
    writeJson(file, next)
  }
}

export function uninstallOpencodeConfig(projectRoot) {
  let removed = false
  for (const file of existingOpencodeConfigFiles(projectRoot)) {
    const data = parseJsoncFile(file)
    if (!data) {
      if (looksLikeInbaseFile(file)) {
        fs.unlinkSync(file)
        removed = true
      }
      continue
    }
    const next = { ...data }
    let changed = false
    const permission = withoutInbasePermissions(next.permission)
    if (permission !== next.permission) {
      changed = true
      if (permission === undefined) delete next.permission
      else next.permission = permission
    }
    const instructions = withoutInstruction(next.instructions)
    if (Array.isArray(next.instructions) && instructions.length !== next.instructions.length) {
      changed = true
      if (instructions.length > 0) next.instructions = instructions
      else delete next.instructions
    }
    if (!changed) continue
    removed = true
    if (isEmptyOpencodeConfig(next)) {
      fs.unlinkSync(file)
      continue
    }
    writeJson(file, next)
  }
  return removed
}
