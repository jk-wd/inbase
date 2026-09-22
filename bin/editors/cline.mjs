import fs from 'node:fs'
import path from 'node:path'
import { removeEmptyParents } from '../project.mjs'
import {
  copySkillAndCommands,
  removeManagedFile,
  removeSkillAndCommands,
  sweepInbaseRules,
  sweepInbaseSkills,
} from './layout.mjs'

export const id = 'cline'
export const label = 'Cline'
export const openFileKind = 'vscode'

const LAYOUT = {
  id,
  skillRel: '.cline/skills/inbase',
  commandRel: '.cline/workflows',
}

const CLINE_PREAMBLE = `# Inbase visual edits (Cline)

This rule applies **only** when the user invoked \`/inbase\`, \`/connect\`, or a
session color command (\`/coral\`, \`/amber\`, …), or when this chat already
printed \`VISUAL_CODER_SESSION\`. A regular chat does **not** attach. Skip it
for files outside the mapped target from \`inbase.json\` (\`target\`; default \`.\`),
git, lockfiles, \`.inbase\`, editor skill folders, questions with no code
changes, or \`/extract-blueprint\`.

Cline (including Qwen) must **execute** tools. Do not paste \`npx inbase\`
commands as chat text. Use this XML:

<execute_command>
<command>npx inbase attach</command>
<requires_approval>false</requires_approval>
</execute_command>

COLOR is this chat's color from \`VISUAL_CODER_SESSION\` (\`coral\`, \`amber\`, …).

When the user invoked \`/inbase\`, a color command, or \`/connect\`, in this order:
1. Run \`npx inbase attach\` (or \`npx inbase attach --color COLOR\` if the user
   named a color, or \`npx inbase attach --first\` for \`/connect\`). Stop if the output is \`VISUAL_CODER_NOT_RUNNING\`. If the
   files are outside \`target\`, do not attach; edit them as a normal task.
2. Reply: \`Connecting to the <color> session.\`
3. Run \`npx inbase read-blueprint --session COLOR\`
4. Reply: \`I see on the blueprint ...\` (name files, folders, symbols, notes)
5. MUST run \`npx inbase report-deliveries --session COLOR --feature "..." --delivery "..."\`
   with titles only — do not invent implementation steps yet.
6. MUST run \`npx inbase report-plan --session COLOR --feature "..." --steps "..."\`
   for the invoked delivery only before any file edit. Use sequential steps
   (\`1\`, \`2\`, \`3\`). Listing steps in chat is not the plan. Never edit before
   \`report-plan\`. Do not plan later deliveries.
7. Edit files only after \`VISUAL_CODER_EXECUTE\`, for that invoked step only.
   Do not spawn subagents. MUST run \`npx inbase propose-patch --session COLOR\`
   with \`--step <id>\` and
   \`--note "path: one-line goal"\` for each changed file and folder before
   starting the next step. No patch file. Never implement the whole plan then
   record once. If the next step is invoked, implement that step only, then
   propose-patch again. If \`VISUAL_CODER_PLAN_DELIVERY\`, report-plan for that
   delivery only. After the last recorded step, stop. The user clicks
   Done in the session window to keep the files and free the color.

If this chat already printed \`VISUAL_CODER_SESSION\`, skip attach. Stay in
that session. \`/stop\` runs \`npx inbase stop --session COLOR\`.

Slash commands \`/inbase\`, \`/connect\`, \`/coral\`, \`/amber\`, \`/lime\`, \`/orange\`, \`/violet\`,
\`/teal\`, \`/crimson\`, \`/forest\`, \`/grey\`, \`/white\` (and aliases),
\`/explainit\`, \`/extract-blueprint\`, and \`/stop\` are project commands.
Follow them when the user invokes one.

Follow the rest of this rule exactly.
`

export function stripYamlFrontmatter(text) {
  if (!text.startsWith('---\n')) return text
  const end = text.indexOf('\n---\n', 4)
  if (end === -1) return text
  return text.slice(end + 5).replace(/^\n*/, '')
}

export function toClineExecuteCommand(markdown) {
  const withSession = markdown
    .replaceAll('<session-id>', 'COLOR')
    .replaceAll('<color>', 'COLOR')
  return withSession.replace(/```bash\n([\s\S]*?)```/g, (_, body) => {
    const command = escapeXml(body.trim())
    return [
      '<execute_command>',
      `<command>${command}</command>`,
      '<requires_approval>false</requires_approval>',
      '</execute_command>',
    ].join('\n')
  })
}

function escapeXml(text) {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

export function install(projectRoot) {
  const installed = copySkillAndCommands(projectRoot, LAYOUT)
  removeLegacyCommandSkills(path.join(projectRoot, '.cline/skills'))
  rewriteMarkdownDir(installed.commandDir)
  const skillFile = path.join(installed.skillDir, 'SKILL.md')
  let skillMarkdown = ''
  if (fs.existsSync(skillFile)) {
    skillMarkdown = toClineExecuteCommand(fs.readFileSync(skillFile, 'utf8'))
    fs.writeFileSync(skillFile, skillMarkdown)
  }
  writeClineSkillFiles(projectRoot, skillMarkdown)
  writeClineRules(projectRoot, skillMarkdown)
  return { ...installed, label }
}

export function uninstall(projectRoot) {
  const removedLayout = removeSkillAndCommands(projectRoot, LAYOUT)
  let removed = removedLayout.removed
  if (removeManagedFile(path.join(projectRoot, '.cline/SKILL.md'))) removed = true
  if (sweepInbaseSkills(path.join(projectRoot, '.cline/skills'))) removed = true
  if (sweepInbaseRules(path.join(projectRoot, '.cline/rules'))) removed = true
  if (removeClineRulesFile(projectRoot)) removed = true
  removeEmptyParents(path.join(projectRoot, '.cline/rules'), projectRoot)
  removeEmptyParents(path.join(projectRoot, '.cline/skills'), projectRoot)
  removeEmptyParents(path.join(projectRoot, '.cline/workflows'), projectRoot)
  removeEmptyParents(path.join(projectRoot, '.cline'), projectRoot)
  return { ...removedLayout, removed, label }
}

function removeClineRulesFile(projectRoot) {
  const file = path.join(projectRoot, '.clinerules')
  if (!fs.existsSync(file)) return false
  if (fs.statSync(file).isDirectory()) {
    removeLegacyClinerulesDir(projectRoot)
    if (sweepInbaseRules(file)) {
      removeEmptyParents(file, projectRoot)
      return true
    }
    removeEmptyParents(file, projectRoot)
    return !fs.existsSync(file)
  }
  return removeManagedFile(file)
}

function removeLegacyCommandSkills(skillsDir) {
  if (!fs.existsSync(skillsDir)) return
  for (const name of fs.readdirSync(skillsDir)) {
    if (name === 'inbase') continue
    const dir = path.join(skillsDir, name)
    if (fs.existsSync(path.join(dir, 'SKILL.md'))) {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  }
}

function rewriteMarkdownDir(dir) {
  if (!dir || !fs.existsSync(dir)) return
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith('.md')) continue
    const file = path.join(dir, name)
    fs.writeFileSync(file, toClineExecuteCommand(fs.readFileSync(file, 'utf8')))
  }
}

function writeClineSkillFiles(projectRoot, skillMarkdown) {
  if (!skillMarkdown) return
  const file = path.join(projectRoot, '.cline/SKILL.md')
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, skillMarkdown)
}

function removeLegacyClinerulesDir(projectRoot) {
  const root = path.join(projectRoot, '.clinerules')
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) return
  for (const name of ['inbase.md', 'workflows', 'skills']) {
    const target = path.join(root, name)
    if (fs.existsSync(target)) fs.rmSync(target, { recursive: true, force: true })
  }
  if (fs.readdirSync(root).length === 0) fs.rmdirSync(root)
}

function writeClineRules(projectRoot, skillMarkdown) {
  const body = toClineExecuteCommand(stripYamlFrontmatter(skillMarkdown)).trim()
  const text = `${CLINE_PREAMBLE.trim()}\n\n${body}\n`
  const folderFile = path.join(projectRoot, '.cline/rules/inbase.md')
  fs.mkdirSync(path.dirname(folderFile), { recursive: true })
  fs.writeFileSync(folderFile, text)
  removeLegacyClinerulesDir(projectRoot)
  const file = path.join(projectRoot, '.clinerules')
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) return
  fs.writeFileSync(file, text)
}
