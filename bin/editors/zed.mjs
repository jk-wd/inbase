import fs from 'node:fs'
import path from 'node:path'
import { removeEmptyParents } from '../project.mjs'
import { stripYamlFrontmatter } from './cline.mjs'
import {
  copySkillTree,
  looksLikeInbaseFile,
  removeManagedFile,
  removeSkillTree,
} from './layout.mjs'

export const id = 'zed'
export const label = 'Zed'
export const openFileKind = 'zed'

const LAYOUT = { id, skillsRel: '.agents/skills' }

/** Auto-approve Inbase CLI in Zed's terminal tool. */
export const ZED_INBASE_TERMINAL_PATTERN = '^npx\\s+inbase\\b'

/** Auto-approve the project Inbase skill (absolute SKILL.md path). */
export const ZED_INBASE_SKILL_PATTERN = '[/\\\\]inbase[/\\\\]SKILL\\.md$'

const ZED_PREAMBLE = `# Inbase visual edits (Zed)

This rule applies **only** when the user invoked \`/inbase\`, \`/connect\`, or a
session color command (\`/coral\`, \`/amber\`, …), or when this chat already
printed \`VISUAL_CODER_SESSION\`. A regular chat does **not** attach. Skip it
for files outside the mapped target from \`inbase.json\` (\`target\`; default \`.\`),
git, lockfiles, \`.inbase\`, editor skill folders, questions with no code
changes, or \`/extract-blueprint\`.

Zed Agent must **run** \`npx inbase\` with the terminal tool. Do not paste
\`npx inbase\` commands as chat text.

When the user invoked \`/inbase\`, a color command, or \`/connect\`, in this order:
1. Run \`npx inbase attach\` (or \`npx inbase attach --color COLOR\` if the user
   named a color, or \`npx inbase attach --first\` for \`/connect\`). Stop if the output is \`VISUAL_CODER_NOT_RUNNING\`. If the
   files are outside \`target\`, do not attach; edit them as a normal task.
2. Reply: \`Connecting to the <color> session.\`
3. Run \`npx inbase read-blueprint --session COLOR\`
4. Reply: \`I see on the blueprint ...\` (name files, folders, symbols, notes)
5. MUST run \`npx inbase report-plan --session COLOR --feature "..." --steps "..."\`
   with the full list of implementation steps before any file edit. Use sequential
   steps (\`1\`, \`2\`, \`3\`). Listing steps in chat is not the plan. Never edit
   before \`report-plan\`.
6. Edit files only after \`VISUAL_CODER_EXECUTE\`, for that invoked step only.
   Do not spawn subagents. MUST run \`npx inbase propose-patch --session COLOR\`
   with \`--step <id>\` and
   \`--note "path: one-line goal"\` for each changed file and folder before
   starting the next step. No patch file. Never implement the whole plan then
   record once. If the next step is invoked, implement that step only, then
   propose-patch again. After the last recorded step, MUST run
   \`npx inbase finish --session COLOR\`. That marks the session finished, keeps
   the files and the blueprint, and leaves the window until the user clicks Done.

If this chat already printed \`VISUAL_CODER_SESSION\`, skip attach. Stay in
that session. After the last recorded step, run \`npx inbase finish --session COLOR\`.

Slash commands \`/inbase\`, \`/connect\`, \`/coral\`, \`/amber\`, \`/lime\`, \`/orange\`, \`/violet\`,
\`/teal\`, \`/crimson\`, \`/forest\`, \`/grey\`, \`/white\` (and aliases),
\`/explainit\`, and \`/extract-blueprint\` are project skills.
Follow them when the user invokes one.

COLOR is this chat's color from \`VISUAL_CODER_SESSION\` (\`coral\`, \`amber\`, …).

Follow the rest of this rule exactly.
`

export function install(projectRoot) {
  const installed = copySkillTree(projectRoot, LAYOUT)
  const skillFile = path.join(installed.skillDir, 'SKILL.md')
  const skillMarkdown = fs.existsSync(skillFile)
    ? fs.readFileSync(skillFile, 'utf8')
    : ''
  writeZedRules(projectRoot, skillMarkdown)
  installZedSettings(projectRoot)
  return { ...installed, label }
}

export function uninstall(projectRoot) {
  const result = removeSkillTree(projectRoot, LAYOUT)
  let removed = result.removed
  if (removeZedRules(projectRoot)) removed = true
  if (uninstallZedSettings(projectRoot)) removed = true
  removeEmptyParents(path.join(projectRoot, '.zed'), projectRoot)
  return { ...result, removed, label }
}

function zedSettingsFile(projectRoot) {
  return path.join(projectRoot, '.zed', 'settings.json')
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

function allowPatterns(tool) {
  return Array.isArray(tool?.always_allow) ? [...tool.always_allow] : []
}

function hasPattern(list, pattern) {
  return list.some((entry) => entry && entry.pattern === pattern)
}

function withoutPattern(list, pattern) {
  return list.filter((entry) => !entry || entry.pattern !== pattern)
}

function ensureAllowPattern(tool, pattern) {
  const next = { ...(tool && typeof tool === 'object' ? tool : {}) }
  const allow = allowPatterns(next)
  if (!hasPattern(allow, pattern)) {
    allow.push({ pattern })
  }
  next.always_allow = allow
  return next
}

function stripAllowPattern(tool, pattern) {
  if (!tool || typeof tool !== 'object') return tool
  const allow = withoutPattern(allowPatterns(tool), pattern)
  const next = { ...tool }
  if (allow.length > 0) next.always_allow = allow
  else delete next.always_allow
  return next
}

function isEmptyObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0
}

function pruneEmpty(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return data
  for (const [key, value] of Object.entries(data)) {
    const pruned = pruneEmpty(value)
    if (pruned == null || isEmptyObject(pruned)) delete data[key]
    else data[key] = pruned
  }
  return data
}

export function installZedSettings(projectRoot) {
  const file = zedSettingsFile(projectRoot)
  const data = parseJsoncFile(file) ?? {}
  const agent = data.agent && typeof data.agent === 'object' ? { ...data.agent } : {}
  const permissions =
    agent.tool_permissions && typeof agent.tool_permissions === 'object'
      ? { ...agent.tool_permissions }
      : {}
  const tools = permissions.tools && typeof permissions.tools === 'object' ? { ...permissions.tools } : {}
  tools.terminal = ensureAllowPattern(tools.terminal, ZED_INBASE_TERMINAL_PATTERN)
  tools.skill = ensureAllowPattern(tools.skill, ZED_INBASE_SKILL_PATTERN)
  permissions.tools = tools
  agent.tool_permissions = permissions
  data.agent = agent
  writeJson(file, data)
}

export function uninstallZedSettings(projectRoot) {
  const file = zedSettingsFile(projectRoot)
  if (!fs.existsSync(file)) return false
  const data = parseJsoncFile(file)
  if (!data) {
    if (looksLikeInbaseFile(file)) {
      fs.unlinkSync(file)
      return true
    }
    return false
  }
  const tools = data.agent?.tool_permissions?.tools
  if (!tools || typeof tools !== 'object') return false
  let changed = false
  if (hasPattern(allowPatterns(tools.terminal), ZED_INBASE_TERMINAL_PATTERN)) {
    tools.terminal = stripAllowPattern(tools.terminal, ZED_INBASE_TERMINAL_PATTERN)
    changed = true
  }
  if (hasPattern(allowPatterns(tools.skill), ZED_INBASE_SKILL_PATTERN)) {
    tools.skill = stripAllowPattern(tools.skill, ZED_INBASE_SKILL_PATTERN)
    changed = true
  }
  if (!changed) return false
  pruneEmpty(data)
  if (isEmptyObject(data)) {
    fs.unlinkSync(file)
    return true
  }
  writeJson(file, data)
  return true
}

function writeZedRules(projectRoot, skillMarkdown) {
  const body = stripYamlFrontmatter(skillMarkdown).trim()
  const text = `${ZED_PREAMBLE.trim()}\n\n${body}\n`
  const file = path.join(projectRoot, '.rules')
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) return
  if (fs.existsSync(file) && !looksLikeInbaseFile(file)) return
  fs.writeFileSync(file, text)
}

function removeZedRules(projectRoot) {
  const file = path.join(projectRoot, '.rules')
  if (!fs.existsSync(file)) return false
  if (fs.statSync(file).isDirectory()) return false
  return removeManagedFile(file)
}
